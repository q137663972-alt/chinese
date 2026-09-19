#!/usr/bin/env node
/* ===================== tools/gen-pics-zp.mjs · 智谱 CogView-4 批量生字图 =====================
 * 教材路线实测 R1=1.1%（决策门 C），447 张缺口只能靠生图。选 CogView-4 的理由：
 *   · ¥0.01/张，447 张 ≈ ¥4.5，比 Pollinations 串行 35s/张（6 小时）快 20 倍
 *   · 支持并发，中文场景理解比 flux 稳
 *   · 右下角有「AI生成」水印 —— imgpost.py 默认裁底部 12% 正好去掉（已实测）
 *
 * 用法：
 *   node tools/gen-pics-zp.mjs --limit 5              # 先出 5 张看效果
 *   node tools/gen-pics-zp.mjs --chars 雪街镜         # 指定字
 *   node tools/gen-pics-zp.mjs --concurrency 5        # 并发（默认 4）
 *   node tools/gen-pics-zp.mjs --no-gate              # 跳过「含汉字吗」闸门（快一倍，不推荐）
 *   node tools/gen-pics-zp.mjs --out img_ai           # 输出到别的目录（版权分轨用）
 *
 * 优先级队列：①字卡式且无真图（答案泄露最严重）②插画式无真图 ③其余；同级按年级升序
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const IMG = path.join(ROOT, 'img');
const TMP = path.join(ROOT, 'tmp', 'raw');
const SCENES = path.join(ROOT, 'tools', 'scenes.json');
const LOG = path.join(ROOT, 'tmp', 'gen-zp-log.jsonl');
const OUT_SIZE = 384;
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

function opt(k, d) {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
}
const has = (k) => process.argv.includes('--' + k);
const LIMIT = Number(opt('limit', '0')) || 0;
const CHARS = opt('chars', '') ? [...opt('chars', '')] : null;
const CONC = Math.max(1, Math.min(8, Number(opt('concurrency', '4'))));
const GATE = !has('no-gate');
const OUTDIR = path.join(ROOT, opt('out', 'img'));
fs.mkdirSync(OUTDIR, { recursive: true });

const KEY = fs.readFileSync('/root/.keys/zhipu.key', 'utf8').trim();
const { buildPrompt, HAS_TEXT_QUESTION } = await import('./prompt.mjs');

const scenes = JSON.parse(fs.readFileSync(SCENES, 'utf8'));
const hex = (z) => 'u' + z.codePointAt(0).toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── 图库现状 + 年级 ───────────────────────────── */
const win = {};
Object.assign(win, new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'pics.js'), 'utf8') + '\n;return window;')(win));
const PHOTOS = win.PIC_PHOTOS || {};
const CARDS = new Set(win.PIC_CARDS || []);

const gradeOf = (() => {
  const dw = { GRADES: [] };
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
    new Function('window', fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n;return window;')(dw);
  }
  const m = {};
  for (const g of dw.GRADES || []) {
    for (const b of g.books || []) for (const u of b.u || []) for (const it of u.w || []) if (!(it.z in m)) m[it.z] = g.g || 99;
  }
  return (z) => m[z] || 99;
})();

/* ── 排队 ─────────────────────────────────────── */
let list = Object.keys(scenes);
if (CHARS) list = CHARS.filter((z) => scenes[z]);
list = list.filter((z) => {
  const f = path.join(IMG, hex(z) + '.webp');
  return !(fs.existsSync(f) && fs.statSync(f).size >= 3000);
});
list.sort((a, b) => {
  const pa = (CARDS.has(a) ? 0 : 100) + gradeOf(a);
  const pb = (CARDS.has(b) ? 0 : 100) + gradeOf(b);
  return pa - pb;
});
if (LIMIT) list = list.slice(0, LIMIT);

console.log(
  `待生成 ${list.length} 张（并发 ${CONC}，闸门 ${GATE ? '开' : '关'}，输出 ${path.relative(ROOT, OUTDIR)}）` +
    `  预估 ¥${(list.length * 0.01 * (GATE ? 1 : 1)).toFixed(2)}`,
);

/* ── 生图 ─────────────────────────────────────── */
async function cogview(prompt) {
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/images/generations', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'cogview-4', prompt, size: '1024x1024' }),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status + ' ' + (await res.text()).slice(0, 160));
  const d = await res.json();
  const url = d?.data?.[0]?.url;
  if (!url) throw new Error('返回里没有 url: ' + JSON.stringify(d).slice(0, 160));
  const img = await fetch(url);
  if (!img.ok) throw new Error('下载失败 ' + img.status);
  const buf = Buffer.from(await img.arrayBuffer());
  if (buf.length < 5000) throw new Error('图太小 ' + buf.length);
  return buf;
}

/* 文字泄露闸门：图里有清晰汉字/拼音 = 把答案画题干上了，必须废掉重来 */
async function hasText(file) {
  const b64 = fs.readFileSync(file).toString('base64');
  const body = {
    model: 'glm-4v-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
          { type: 'text', text: HAS_TEXT_QUESTION },
        ],
      },
    ],
    max_tokens: 8,
    temperature: 0,
  };
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return false; // 闸门自己出错就放行，别卡住主流程
  const d = await res.json();
  return /yes/i.test(d?.choices?.[0]?.message?.content || '');
}

const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
let ok = 0;
let fail = 0;
let gated = 0;
let spent = 0;
let idx = 0;
const t0 = Date.now();

async function worker() {
  for (;;) {
    const i = idx++;
    if (i >= list.length) return;
    const z = list[i];
    const out = path.join(OUTDIR, hex(z) + '.webp');
    if (fs.existsSync(out)) continue;
    const prompt = buildPrompt(scenes[z].subject);
    let done = false;
    for (let a = 0; a < 3 && !done; a++) {
      try {
        const buf = await cogview(prompt + (a ? ' ' : ''));
        spent += 0.01;
        const raw = path.join(TMP, hex(z) + '.raw');
        fs.writeFileSync(raw, buf);
        if (GATE && (await hasText(raw))) {
          if (a === 2) {
            gated++;
            log({ z, ok: false, why: 'has-text', at: new Date().toISOString() });
          }
          continue; // 换一张重来
        }
        execFileSync('python3', [path.join(ROOT, 'tools', 'imgpost.py'), raw, out, String(OUT_SIZE), '80'], { encoding: 'utf8' });
        ok++;
        done = true;
        log({ z, ok: true, attempt: a + 1, at: new Date().toISOString() });
      } catch (e) {
        if (a === 2) {
          fail++;
          log({ z, ok: false, why: String(e.message || e).slice(0, 80), at: new Date().toISOString() });
        } else await sleep(2000 * (a + 1));
      }
    }
    const el = Math.round((Date.now() - t0) / 1000);
    const n = ok + fail + gated;
    console.log(
      `[${n}/${list.length}] ${z} ${done ? '✅' : '❌'}  成功${ok} 失败${fail} 带字${gated}  已花¥${spent.toFixed(2)}  ${el}s` +
        (n ? `  预计还需${Math.round(((list.length - n) * el) / n / 60)}分钟` : ''),
    );
  }
}

await Promise.all(Array.from({ length: CONC }, () => worker()));

console.log(`\n完成：成功 ${ok} / 失败 ${fail} / 带字作废 ${gated} / 共 ${list.length}，花费 ¥${spent.toFixed(2)}`);
console.log('下一步：node tools/emit-photos.mjs && node tools/check-pics.mjs --quiet');
