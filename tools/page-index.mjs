#!/usr/bin/env node
/* ===================== tools/page-index.mjs · 教材页面视觉索引 =====================
 * 人教社教材站没有任何文本层（config.xml 是加密 CDATA，search.xml 全软 404），
 * 沙箱里又装不了 tesseract 的 chi_sim（npm/pypi 不可达）。所以「这一页讲了什么、
 * 画了什么、图在哪」只能靠视觉模型读图 —— 它一步替代 OCR，还顺带给出裁剪框 bbox。
 *
 * 用法：
 *   node tools/page-index.mjs --book 1211001101241
 *   node tools/page-index.mjs --book 1211001101241 --limit 20      # 先试 20 页
 *   node tools/page-index.mjs --book 1211001101241 --pages 12,15,20
 *   node tools/page-index.mjs --book 1211001101241 --concurrency 5
 *
 * 产物：tmp/pep/<bookId>/pages.json
 *   [{ page, lesson, has_illustration, illustration_bbox, objects:[{zh,en,bbox,salience}],
 *      is_xiangxing, text_density, _raw }]
 *   断点续传：已解析成功的页不会重跑（除非 --force）。
 *
 * 成本：glm-4v-flash 免费档。一册 120 页约 120 次调用。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const has = (name) => process.argv.includes('--' + name);

const BOOK = opt('book', '');
const KIND = opt('kind', 'thumb');
const LIMIT = Number(opt('limit', '0'));
const CONC = Math.max(1, Math.min(8, Number(opt('concurrency', '3'))));
const FORCE = has('force');
const ONLY = opt('pages', '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

if (!BOOK) {
  console.error('用法: node tools/page-index.mjs --book <bookId> [--limit N] [--pages 12,15] [--concurrency 3] [--force]');
  process.exit(1);
}

/* ── Key ── */
const KEYFILE = '/root/.keys/zhipu.key';
if (!fs.existsSync(KEYFILE)) {
  console.error('缺少 ' + KEYFILE);
  process.exit(2);
}
const KEY = fs.readFileSync(KEYFILE, 'utf8').trim();

/* ── 提示词 ──
 * 三条硬要求都是踩过坑才加的：
 *   1. bbox 必须归一化到 0-1000（否则模型爱给像素值，尺寸一变就废）
 *   2. objects 只收「能单独裁出来当识字卡」的 concrete 物体 —— 抽象概念/整页场景不要
 *   3. zh 必须是「小学低年级识字表里的单字或双字词」—— 否则一堆「小朋友」「教室」没法对上字表
 */
const PROMPT = `这是中国小学《语文》教材的一页扫描图。请仔细观察，只输出一个 JSON 对象，不要任何解释文字、不要 markdown 代码块。
格式：
{"lesson":"课号+课题，如 识字3 口耳目；封面/目录/生字表/练习册页填 null",
 "has_illustration":true,
 "illustration_bbox":[x,y,w,h],
 "objects":[{"zh":"物体中文名","en":"english","bbox":[x,y,w,h],"salience":0.9}],
 "is_xiangxing":false,
 "text_density":0.2}
说明：
- bbox 格式 [x, y, w, h]，用 0-1000 归一化坐标（相对整页宽高），必须是整数。
- objects 只列画面中**能单独裁出来当识字卡片**的具体物体（动物、植物、日用品、自然物、身体部位等），最多 6 个，按显著程度降序。
- zh 尽量用**单个汉字或双字词语**，优先选小学识字表里会出现的说法（如 "日"、"月"、"山"、"水"、"火"、"鸟"、"马"、"云"、"雨"、"竹"、"太阳"、"月亮"）。
- 不要列抽象概念（如"快乐""春天"）、不要列整页场景、不要列人物整体（"小朋友"不要，"手""眼睛"可以）。
- is_xiangxing 表示本页是否含甲骨文/金文/小篆到楷书的字理演变图。
- text_density 是本页文字占画面的比例，0~1。`;

const API = 'https://open.bigmodel.cn/api/paas/v4/chat/completions';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 模型偶尔会在 JSON 外面裹 ```json 或前后加话，这里兜住 */
function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/* 输出被 max_tokens 砍断时的补救：扫一遍括号栈，把没闭合的按栈序补回去。
   实测第 4 页就是列到第 4 个物体时被截断，靠这个捞回 6 成内容。 */
function salvageJSON(s) {
  const a = s.indexOf('{');
  if (a < 0) return null;
  const stack = [];
  let inStr = false;
  let esc = false;
  let lastSafe = a;
  for (let i = a; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '{' || ch === '[') stack.push(ch);
    else if (ch === '}' || ch === ']') {
      stack.pop();
      if (stack.length === 0) return tryParse(s.slice(a, i + 1)); // 正常闭合
    }
    if (!inStr) lastSafe = i;
  }
  // 截断多半停在半截 key 上（…,"bbox" 或 …,"bbox":），直接补括号会拼出 "bbox":] 这种畸形
  let core = s.slice(a, lastSafe + 1);
  core = core.replace(/,\s*"[^"]*"\s*:\s*$/, ',').replace(/"[^"]*"\s*:\s*$/, '').replace(/[,:\s]+$/, '');
  let closes = '';
  for (let i = stack.length - 1; i >= 0; i--) closes += stack[i] === '{' ? '}' : ']';
  return tryParse(core + closes);
}

function parseJSON(text) {
  let s = String(text || '').trim();
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (!s.includes('{')) return null;
  return tryParse(s.slice(s.indexOf('{'))) || salvageJSON(s);
}

/* 模型返回的 JSON 结构经常跑偏，这里统一洗一遍，别让脏数据一路带到 coverage */
function sanitize(p) {
  if (!p || typeof p !== 'object') return null;
  const lesson =
    typeof p.lesson === 'string' && p.lesson && p.lesson !== 'null' ? p.lesson.slice(0, 60) : null;
  const bboxOk = (b) =>
    Array.isArray(b) &&
    b.length === 4 &&
    b.every((v) => Number.isFinite(Number(v))) &&
    Number(b[2]) > 0 &&
    Number(b[3]) > 0;
  const objects = (Array.isArray(p.objects) ? p.objects : [])
    .filter((o) => o && String(o.zh || '').trim() && bboxOk(o.bbox))
    .slice(0, 6)
    .map((o) => ({
      zh: String(o.zh).trim().slice(0, 12),
      en: String(o.en || '').trim().slice(0, 40),
      bbox: o.bbox.map((v) => Math.max(0, Math.min(1000, Math.round(Number(v))))),
      salience: Number.isFinite(Number(o.salience)) ? Number(o.salience) : 0.5,
    }));
  return {
    lesson,
    has_illustration: p.has_illustration === true || objects.length > 0,
    illustration_bbox: bboxOk(p.illustration_bbox) ? p.illustration_bbox.map(Number) : null,
    objects,
    is_xiangxing: p.is_xiangxing === true,
    text_density: Number.isFinite(Number(p.text_density)) ? Number(p.text_density) : null,
  };
}

async function askVLM(jpgPath) {
  const b64 = fs.readFileSync(jpgPath).toString('base64');
  const body = {
    model: 'glm-4v-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
          { type: 'text', text: PROMPT },
        ],
      },
    ],
    max_tokens: 1024, // 智谱硬上限 1024；8192 会报 400。列 6 个物体再长也够，截断靠 salvageJSON 兜
    temperature: 0.1,
  };
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error('HTTP ' + res.status + ' ' + t.slice(0, 200));
  }
  const d = await res.json();
  const raw = d?.choices?.[0]?.message?.content || '';
  return { raw, parsed: parseJSON(raw) };
}

/* ── 主流程 ── */
const bookDir = path.join(ROOT, 'tmp', 'pep', String(BOOK));
const imgDir = path.join(bookDir, KIND);
const outFile = path.join(bookDir, `pages.${KIND}.json`);

if (!fs.existsSync(imgDir)) {
  console.error('没有 ' + imgDir + '，先跑 tools/fetch-book.mjs');
  process.exit(3);
}

const all = fs
  .readdirSync(imgDir)
  .filter((f) => f.endsWith('.jpg'))
  .map((f) => Number(path.basename(f, '.jpg')))
  .filter((n) => Number.isFinite(n))
  .sort((a, b) => a - b);

let pages = ONLY.length ? ONLY.filter((n) => all.includes(n)) : all;
if (LIMIT > 0) pages = pages.slice(0, LIMIT);

/* 断点续传。注意：--force 只表示「重跑这几页」，绝不能把已有的页冲掉 ——
   第一版把 existing 的载入也放进 !FORCE 分支里，结果 --force 单页重试时把已索引的页全删了。 */
let existing = [];
if (fs.existsSync(outFile)) {
  try {
    existing = JSON.parse(fs.readFileSync(outFile, 'utf8'));
    if (!Array.isArray(existing)) existing = [];
  } catch {
    existing = [];
  }
}
const doneMap = new Map(existing.filter((p) => p && p.page != null).map((p) => [p.page, p]));
if (!FORCE) pages = pages.filter((n) => !doneMap.has(n));

console.log(
  `书 ${BOOK} · ${KIND} · 共 ${all.length} 页，已完成 ${doneMap.size}，待处理 ${pages.length}，并发 ${CONC}`,
);
if (!pages.length) {
  console.log('没有待处理的页。加 --force 可重跑。');
  process.exit(0);
}

const results = [];
let ok = 0;
let bad = 0;
let idx = 0;

async function worker(id) {
  for (;;) {
    const i = idx++;
    if (i >= pages.length) return;
    const n = pages[i];
    const f = path.join(imgDir, `${n}.jpg`);
    let rec = null;
    let lastErr = '';
    for (let attempt = 1; attempt <= 3 && !rec; attempt++) {
      try {
        const { raw, parsed } = await askVLM(f);
        const clean = sanitize(parsed);
        if (clean) {
          rec = { page: n, ...clean, _raw: raw };
        } else {
          lastErr = 'JSON 解析失败: ' + String(raw).slice(0, 120);
        }
      } catch (e) {
        lastErr = String(e.message || e);
        await sleep(1500 * attempt);
      }
    }
    if (rec) {
      ok++;
      results.push(rec);
      const objs = Array.isArray(rec.objects) ? rec.objects : [];
      const names = objs
        .slice(0, 6)
        .map((o) => o && o.zh)
        .filter(Boolean)
        .join(' ');
      console.log(`  [${ok + bad}/${pages.length}] p${n} ${rec.lesson || '-'} | ${names || '(无物体)'}`);
    } else {
      bad++;
      console.log(`  [${ok + bad}/${pages.length}] p${n} ✗ ${lastErr}`);
    }
    await sleep(300);
  }
}

await Promise.all(Array.from({ length: CONC }, (_, i) => worker(i)));

const merged = new Map(doneMap);
for (const r of results) merged.set(r.page, r);
const final = [...merged.values()].sort((a, b) => a.page - b.page);
fs.writeFileSync(outFile, JSON.stringify(final, null, 2));

const totalObj = final.reduce((s, p) => s + (Array.isArray(p.objects) ? p.objects.length : 0), 0);
console.log(
  `\n完成：成功 ${ok} 失败 ${bad}；pages.json 现有 ${final.length} 页，物体 ${totalObj} 个 → ${outFile}`,
);
