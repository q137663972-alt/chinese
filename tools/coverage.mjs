#!/usr/bin/env node
/* ===================== tools/coverage.mjs · 教材图覆盖率统计 + 决策门 =====================
 * 这是整个教材路线的「刹车踏板」：先把两册教材能补多少字算清楚，再决定要不要投力气。
 * **本脚本不产出任何 img/ 文件，只产出数字。**
 *
 * 用法：
 *   node tools/coverage.mjs                       # 扫 tmp/pep 下所有册的 pages.thumb.json
 *   node tools/coverage.mjs --books 1211001101241 # 只算指定册
 *   node tools/coverage.mjs --review 60           # 抽样 60 张生成人工过审页
 *
 * 命中优先级（conf）：
 *   直接命中  object.zh === 字            w = 1.0
 *   组词命中  object.zh 含该字（2~3 字）   w = 0.70
 *   英文模糊  object.en 与 subject/gloss 同词 w = 0.45  → 一律 WEAK，必须人工过审
 *
 * 同一 (book,page) 内 bbox IoU > 0.5 视为同一张图，聚成一簇：
 *   EXCLUSIVE  簇只被 1 个字命中且 conf ≥ 0.7 → 可直接落地
 *   CONTESTED  簇被 ≥2 个字命中             → 只给 1 个 owner，其余进 AI 队列
 *   WEAK       conf < 0.7                  → 人工过审
 *   MISS       没有任何簇
 *
 * 产物：
 *   tools/pep/coverage.json   { metrics, chars:{z:{status,book,page,bbox,conf,kind,obj}}, clusters:[…] }
 *   tmp/pep/review.html       抽样页，画红框，人工打勾
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS = path.join(ROOT, 'js');
const PEP = path.join(ROOT, 'tmp', 'pep');
const OUTDIR = path.join(ROOT, 'tools', 'pep');

function opt(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const ONLY_BOOKS = opt('books', '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const REVIEW_N = Number(opt('review', '60'));

/* ── 1. 图库现状 ──────────────────────────────── */
const win = {};
{
  const src = fs.readFileSync(path.join(JS, 'pics.js'), 'utf8');
  Object.assign(win, new Function('window', src + '\n;return window;')(win));
}
const PICS = win.PICS || {};
const PHOTOS = win.PIC_PHOTOS || {};
const CARDS = new Set(win.PIC_CARDS || []);
const ALLZ = Object.keys(PICS);

/* ── 2. 单元数据 → 字所属年级 ─────────────────── */
const dataWin = { GRADES: [] };
for (const f of fs.readdirSync(JS).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
  Object.assign(dataWin, new Function('window', fs.readFileSync(path.join(JS, f), 'utf8') + '\n;return window;')(dataWin));
}
const grades = dataWin.GRADES || [];
const zGrade = new Map();
const zSeen = new Set();
for (const g of grades) {
  for (const b of g.books || []) {
    for (const u of b.u || []) {
      for (const it of u.w || []) {
        if (!zGrade.has(it.z)) zGrade.set(it.z, g.g);
        zSeen.add(it.z);
      }
    }
  }
}

/* ── 3. 情境描述（英文 subject / gloss）───────── */
const SCENES = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'scenes.json'), 'utf8'));

const STOP = new Set(
  ('a an the and or of in on at to with is are be this that it its small big one two three ' +
    'some many little very child children person people boy girl kids kid cartoon style drawing ' +
    'illustration picture image white background simple flat vector').split(' '),
);
function toks(s) {
  return String(s || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));
}
const zEnTokens = new Map();
for (const z of ALLZ) {
  const sc = SCENES[z] || {};
  zEnTokens.set(z, new Set([...toks(sc.subject), ...(sc.gloss || []).flatMap(toks)]));
}

/* ── 4. 读页面索引 ────────────────────────────── */
const bookIds = fs
  .existsSync(PEP)
  ? fs.readdirSync(PEP).filter((d) => fs.statSync(path.join(PEP, d)).isDirectory())
  : [];
const books = ONLY_BOOKS.length ? bookIds.filter((b) => ONLY_BOOKS.includes(b)) : bookIds;

const hits = []; // {z, book, page, bbox, conf, kind, objZh, objEn, area}
let pageCount = 0;
let noisePages = 0;
let keptPages = 0;

/* 判定「这一页的 objects 其实是 OCR 读出来的文字，不是插画里的物体」 */
function isOcrNoisePage(objs, lesson) {
  if (objs.length < 3) return false;
  const box = (o) => (Array.isArray(o.bbox) && o.bbox.length === 4 ? o.bbox.map(Number) : null);
  const bs = objs.map(box).filter(Boolean);
  if (bs.length < 3) return false;
  // ① 尺寸全一样 + 顶部对齐成 1~2 行 → 一排字
  const sizes = new Set(bs.map((b) => `${b[2]}x${b[3]}`));
  const rows = new Set(bs.map((b) => Math.round(b[1] / 20)));
  if (sizes.size === 1 && rows.size <= 2) return true;
  // ② 每个框的面积都 < 0.4% 页面（≈63×63）→ 全是字形级别的小框
  if (bs.every((b) => b[2] * b[3] < 4000)) return true;
  // ③ 物体的名字几乎都被 lesson 标题包含 → 这就是生字表页在念字
  if (lesson && typeof lesson === 'string') {
    const inLesson = objs.filter((o) => o.zh && lesson.includes(String(o.zh))).length;
    if (inLesson >= objs.length * 0.8) return true;
  }
  return false;
}
for (const book of books) {
  const pf = path.join(PEP, book, 'pages.thumb.json');
  if (!fs.existsSync(pf)) {
    console.log(`  ⚠️ ${book} 没有 pages.thumb.json，跳过（先跑 page-index.mjs）`);
    continue;
  }
  const pages = JSON.parse(fs.readFileSync(pf, 'utf8'));
  pageCount += pages.length;
  for (const p of pages) {
    /* ---------- 页级噪声闸门 ----------
     * 免费档 VLM 很容易把「生字表 / 笔画名称表 / 偏旁表 / 课文正文」当物体清单读出来：
     *   p111 识字1 天地人你我他 → objects 天/地/人/你/我/他，bbox 全 30×30 排在同一行
     *   p116 常用偏旁名称表    → 单人旁/八字头…，全 100×100 同尺寸
     *   p104 乌鸦把石子…       → 乌鸦/瓶子/石子/水/喝/口，全是从正文里读的字
     * 这些裁出来就是「一张字的照片」，比字卡式 SVG 还糟（等于放大版答案）。必须整页丢掉。 */
    const objs = Array.isArray(p.objects) ? p.objects : [];
    if (isOcrNoisePage(objs, p.lesson)) {
      noisePages++;
      continue;
    }
    keptPages++;
    for (const o of objs) {
      if (!o || !Array.isArray(o.bbox) || o.bbox.length !== 4) continue;
      const zh = String(o.zh || '').trim();
      const en = String(o.en || '').trim();
      const bbox = o.bbox.map((v) => Number(v)).map((v) => (Number.isFinite(v) ? v : 0));
      if (bbox[2] <= 0 || bbox[3] <= 0) continue;
      if (!zh && !en) continue;

      for (const z of ALLZ) {
        let conf = 0;
        let kind = '';
        if (zh === z) {
          conf = 1.0;
          kind = 'direct';
        } else if (zh.length >= 2 && zh.length <= 3 && zh.includes(z)) {
          conf = 0.7;
          kind = 'word';
        } else if (en) {
          const et = new Set(toks(en));
          let inter = 0;
          for (const t of et) if (zEnTokens.get(z).has(t)) inter++;
          if (inter >= 1 && (inter >= 2 || et.size <= 2)) {
            conf = 0.45;
            kind = 'en';
          }
        }
        if (conf > 0) {
          /* 噪声闸门：版权页/目录页的"人民""主编""编辑委员会"这类只有中文名、没有英文名的
             OCR 式条目，会污染「组词命中」（"人民"→人）。没有 en 时只允许单字精确命中。 */
          if (!en && kind !== 'direct') continue;
          hits.push({ z, book, page: p.page, bbox, conf, kind, objZh: zh, objEn: en, area: bbox[2] * bbox[3] });
        }
      }
    }
  }
}

/* ── 5. 按「页」聚簇（不是按 bbox）─────────────
 * 原计划用 bbox 的 IoU>0.5 聚簇，实测作废：GLM-4V-Flash 免费档给的框又小又飘
 * （一页整幅插画它只给 60×60，占页面 0.4%），框与框之间谈不上 IoU。
 * 诚实做法是承认我们只知道「这一页大概画了什么」，所以一页 = 一簇 = 最多产出一张图。
 * bbox 只留着给裁图当提示，真正裁图一律用 imgpost.py --auto 兜底。 */
function iou(a, b) {
  const ax = a[0], ay = a[1], aw = a[2], ah = a[3];
  const bx = b[0], by = b[1], bw = b[2], bh = b[3];
  const x1 = Math.max(ax, bx), y1 = Math.max(ay, by);
  const x2 = Math.min(ax + aw, bx + bw), y2 = Math.min(ay + ah, by + bh);
  const iw = Math.max(0, x2 - x1), ih = Math.max(0, y2 - y1);
  const inter = iw * ih;
  const uni = aw * ah + bw * bh - inter;
  return uni > 0 ? inter / uni : 0;
}

const byPage = new Map();
for (const h of hits) {
  const k = h.book + '#' + h.page;
  if (!byPage.has(k)) byPage.set(k, []);
  byPage.get(k).push(h);
}

const clusters = [];
for (const [k, list] of byPage) {
  const [book, page] = k.split('#');
  // 簇代表 = 置信度最高的那条，同分时取框大的（框大 = 更像插画而不是字形）
  const best = list.reduce(
    (a, b) => (b.conf > a.conf || (b.conf === a.conf && b.area > a.area) ? b : a),
  );
  const zs = [...new Set(list.map((h) => h.z))];
  clusters.push({
    key: `${book}#${page}`,
    book,
    page: Number(page),
    bbox: best.bbox,
    best,
    zs,
    maxConf: Math.max(...list.map((h) => h.conf)),
    hits: list.length,
  });
}

/* ── 6. 定 owner（CONTESTED 才需要）：字卡式优先 > 年级低 > 还没真图 ── */
function ownerScore(z) {
  return (
    (CARDS.has(z) ? 1000 : 0) +
    (zGrade.has(z) ? (7 - zGrade.get(z)) * 100 : 0) +
    (PHOTOS[z] ? 0 : 10)
  );
}
for (const c of clusters) {
  if (c.zs.length === 1) {
    c.owner = c.zs[0];
    c.status = c.maxConf >= 0.7 ? 'EXCLUSIVE' : 'WEAK';
  } else {
    c.owner = [...c.zs].sort((a, b) => ownerScore(b) - ownerScore(a))[0];
    c.status = 'CONTESTED';
  }
  c.conf = c.maxConf;
}

/* ── 7. 每个字的最佳簇 ────────────────────────── */
const char = new Map();
for (const c of clusters) {
  const prev = char.get(c.owner);
  if (!prev || c.maxConf > prev.maxConf) char.set(c.owner, c);
}
const statusOf = (z) => {
  const c = char.get(z);
  return c ? c.status : 'MISS';
};

/* ── 8. 指标 ──────────────────────────────────── */
const gap = ALLZ.filter((z) => !PHOTOS[z]);          // 还没有真图的字
const cardGap = gap.filter((z) => CARDS.has(z));     // 其中「字卡式」= 答案泄露最严重
const cnt = (arr, st) => arr.filter((z) => statusOf(z) === st).length;

const R1 = cnt(ALLZ, 'EXCLUSIVE') / ALLZ.length;
const R1b = cnt(gap, 'EXCLUSIVE') / gap.length;
const R1c = cnt(cardGap, 'EXCLUSIVE') / cardGap.length;
const R2 = (cnt(ALLZ, 'EXCLUSIVE') + cnt(ALLZ, 'CONTESTED')) / ALLZ.length;
const R2b = (cnt(gap, 'EXCLUSIVE') + cnt(gap, 'CONTESTED')) / gap.length;

const byGradeAll = {};
const byGradeHit = {};
for (const z of ALLZ) {
  const g = zGrade.get(z) || '?';
  byGradeAll[g] = (byGradeAll[g] || 0) + 1;
  if (statusOf(z) !== 'MISS') byGradeHit[g] = (byGradeHit[g] || 0) + 1;
}
const gapByGrade = {};
const gapHitByGrade = {};
for (const z of gap) {
  const g = zGrade.get(z) || '?';
  gapByGrade[g] = (gapByGrade[g] || 0) + 1;
  if (statusOf(z) !== 'MISS') gapHitByGrade[g] = (gapHitByGrade[g] || 0) + 1;
}
const g36Gap = gap.filter((z) => (zGrade.get(z) || 0) >= 3).length;
const g36Hit = gap.filter((z) => (zGrade.get(z) || 0) >= 3 && statusOf(z) !== 'MISS').length;
const R4 = g36Gap ? g36Hit / g36Gap : 0;

const weakN = cnt(ALLZ, 'WEAK');

const metrics = {
  books,
  pagesIndexed: pageCount,
  pagesDroppedAsOcrNoise: noisePages,
  pagesKept: keptPages,
  objectsMatched: hits.length,
  clusters: clusters.length,
  charsTotal: ALLZ.length,
  gapTotal: gap.length,
  gapCardStyle: cardGap.length,
  R1_exclusive_all: +R1.toFixed(4),
  R1b_exclusive_gap: +R1b.toFixed(4),
  R1c_exclusive_cardGap: +R1c.toFixed(4),
  R2_exclusive_plus_contested_all: +R2.toFixed(4),
  R2b_exclusive_plus_contested_gap: +R2b.toFixed(4),
  R4_g36_gap_hit_rate: +R4.toFixed(4),
  breakdown: {
    all: { EXCLUSIVE: cnt(ALLZ, 'EXCLUSIVE'), CONTESTED: cnt(ALLZ, 'CONTESTED'), WEAK: weakN, MISS: cnt(ALLZ, 'MISS') },
    gap: { EXCLUSIVE: cnt(gap, 'EXCLUSIVE'), CONTESTED: cnt(gap, 'CONTESTED'), WEAK: cnt(gap, 'WEAK'), MISS: cnt(gap, 'MISS') },
    cardGap: { EXCLUSIVE: cnt(cardGap, 'EXCLUSIVE'), CONTESTED: cnt(cardGap, 'CONTESTED'), WEAK: cnt(cardGap, 'WEAK'), MISS: cnt(cardGap, 'MISS') },
  },
  hitRateByGrade_all: Object.fromEntries(
    Object.keys(byGradeAll).sort().map((g) => [g, `${byGradeHit[g] || 0}/${byGradeAll[g]}`]),
  ),
  hitRateByGrade_gap: Object.fromEntries(
    Object.keys(gapByGrade).sort().map((g) => [g, `${gapHitByGrade[g] || 0}/${gapByGrade[g]}`]),
  ),
};

/* ── 9. 输出 ──────────────────────────────────── */
fs.mkdirSync(OUTDIR, { recursive: true });
fs.writeFileSync(
  path.join(OUTDIR, 'coverage.json'),
  JSON.stringify(
    {
      metrics,
      chars: Object.fromEntries(
        ALLZ.map((z) => {
          const c = char.get(z);
          return [
            z,
            c
              ? { status: c.status, book: c.book, page: c.page, bbox: c.bbox, conf: c.maxConf, kind: c.best.kind, obj: c.best.objZh || c.best.objEn, grade: zGrade.get(z) || null, hasPhoto: !!PHOTOS[z] }
              : { status: 'MISS', grade: zGrade.get(z) || null, hasPhoto: !!PHOTOS[z] },
          ];
        }),
      ),
      clusters: clusters.map((c) => ({ key: c.key, book: c.book, page: c.page, bbox: c.bbox, status: c.status, owner: c.owner, zs: c.zs, maxConf: c.maxConf })),
    },
    null,
    2,
  ),
);

console.log('════ 教材图覆盖率 coverage ════');
console.log(`册        : ${books.join(', ') || '(无)'}  索引页 ${pageCount}丢弃文字噪声页 ${noisePages}，保留 ${keptPages}`);
console.log(`匹配到    : ${hits.length} 条字-物体命中 → ${clusters.length} 页可出图`);
console.log(`字库      : ${ALLZ.length} 字，缺真图 ${gap.length}（其中字卡式 ${cardGap.length}）`);
console.log('');
console.log(`R1  EXCLUSIVE/全部      : ${(R1 * 100).toFixed(1)}%  (${metrics.breakdown.all.EXCLUSIVE}/${ALLZ.length})`);
console.log(`R1b EXCLUSIVE/缺真图    : ${(R1b * 100).toFixed(1)}%  (${metrics.breakdown.gap.EXCLUSIVE}/${gap.length})`);
console.log(`R1c EXCLUSIVE/字卡式缺口: ${(R1c * 100).toFixed(1)}%  (${metrics.breakdown.cardGap.EXCLUSIVE}/${cardGap.length})`);
console.log(`R2  +CONTESTED/全部     : ${(R2 * 100).toFixed(1)}%`);
console.log(`R2b +CONTESTED/缺真图   : ${(R2b * 100).toFixed(1)}%`);
console.log(`R4  G3–G6 缺口命中率     : ${(R4 * 100).toFixed(1)}%  (${g36Hit}/${g36Gap})`);
console.log('');
console.log('分级      全部: ' + JSON.stringify(metrics.breakdown.all));
console.log('分级      缺口: ' + JSON.stringify(metrics.breakdown.gap));
console.log('分级  字卡缺口: ' + JSON.stringify(metrics.breakdown.cardGap));
console.log('按年级(全部): ' + Object.entries(metrics.hitRateByGrade_all).map(([g, v]) => `G${g} ${v}`).join('  '));
console.log('按年级(缺口): ' + Object.entries(metrics.hitRateByGrade_gap).map(([g, v]) => `G${g} ${v}`).join('  '));
console.log('');
console.log('── 决策门 ──');
const gate =
  R1 >= 0.4 ? 'A：≥40% → 全 12 册都做教材图' :
  R1 >= 0.2 ? 'B：20%~40% → 只做 G1–G2 四册' :
              'C：<20% → 教材图只做单元封面，主图全走 AI';
console.log(`  R1=${(R1 * 100).toFixed(1)}% → ${gate}`);
if (R4 < 0.1) console.log(`  ⚠️ R4=${(R4 * 100).toFixed(1)}% <10% → 教材路线对最痛的 G3–G6 缺口基本无用`);
console.log(`  WEAK ${weakN} 字需人工过审（tmp/pep/review.html）`);

/* ── 10. 人工过审页 ───────────────────────────── */
{
  const samples = clusters
    .filter((c) => c.status !== 'MISS')
    .sort((a, b) => b.maxConf - a.maxConf || a.page - b.page)
    .slice(0, REVIEW_N);
  const rows = samples
    .map((c) => {
      const [x, y, w, h] = c.bbox.map((v) => (v / 1000) * 100);
      return `<div class="card">
  <div class="imgwrap"><img src="${c.book}/thumb/${c.page}.jpg" loading="lazy">
    <div class="box" style="left:${x}%;top:${y}%;width:${w}%;height:${h}%"></div></div>
  <div class="meta">
    <b>${c.owner}</b> <span class="s ${c.status}">${c.status}</span>
    <div class="k">${c.best.objZh || ''} ${c.best.objEn || ''} · conf ${c.maxConf} · ${c.best.kind}</div>
    <div class="k">p${c.page} · 竞争字 ${c.zs.join(' ') || '-'}</div>
    <label><input type="checkbox"> 图对得上</label>
  </div></div>`;
    })
    .join('\n');
  fs.writeFileSync(
    path.join(PEP, 'review.html'),
    `<!doctype html><meta charset="utf-8"><title>教材图人工过审 ${samples.length} 张</title>
<style>body{font-family:system-ui;margin:16px;background:#f6f6f6}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:8px}
.imgwrap{position:relative;line-height:0}
.imgwrap img{width:100%;border:1px solid #eee}
.box{position:absolute;border:3px solid #e33;pointer-events:none}
.meta{margin-top:6px;font-size:13px}.k{color:#666;font-size:12px}
.s{font-size:11px;padding:1px 5px;border-radius:4px;color:#fff}
.EXCLUSIVE{background:#2a9}.CONTESTED{background:#e93}.WEAK{background:#888}</style>
<h3>教材图人工过审 · ${samples.length} 张（红框 = 模型给的物体位置）</h3>
<p>勾掉「图对得上」的不要。统计勾选比例 = R5 precision，&lt;0.7 就要改 prompt 或全降 WEAK。</p>
<div class="grid">\n${rows}\n</div>`,
  );
  console.log(`\n人工过审页 → ${path.join(PEP, 'review.html')}（${samples.length} 张）`);
}
console.log(`覆盖率数据 → ${path.join(OUTDIR, 'coverage.json')}`);
