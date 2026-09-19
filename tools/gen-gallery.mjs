#!/usr/bin/env node
/* ===================== tools/gen-gallery.mjs · 重新生成 pics.html 素材画廊 =====================
 * 旧 pics.html 是一次性产物：只嵌 SVG、写死「576 个字」，图库换成 webp 真图后就对不上了。
 * 现在改成每次生成：PICS 里有 SVG 用 SVG，PIC_PHOTOS 里有真图优先用真图，
 * 一眼能看出「哪些字还是字卡、哪些已经有真图」。
 *
 * 用法：node tools/gen-gallery.mjs          # 产出 pics.html（仓库根）
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS = path.join(ROOT, 'js');
const IMG = path.join(ROOT, 'img');

/* ── 图库 ── */
const win = {};
Object.assign(win, new Function('window', fs.readFileSync(path.join(JS, 'pics.js'), 'utf8') + '\n;return window;')(win));
const PICS = win.PICS || {};
const CARDS = new Set(win.PIC_CARDS || []);
const PHOTOS = win.PIC_PHOTOS || {};

/* ── 单元结构 ── */
const dw = { GRADES: [] };
for (const f of fs.readdirSync(JS).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
  Object.assign(dw, new Function('window', fs.readFileSync(path.join(JS, f), 'utf8') + '\n;return window;')(dw));
}

const hex = (z) => 'u' + z.codePointAt(0).toString(16);
const all = new Set(Object.keys(PICS));
let photoN = 0;
let cardN = 0;
let body = '';

for (const g of dw.GRADES || []) {
  body += `<section class="grade"><h2>${g.n || '年级' + g.g}</h2>`;
  for (const b of g.books || []) {
    body += `<div class="unit">${b.n || ''}</div><div class="grid">`;
    for (const u of b.u || []) {
      const ws = (u.w || []).filter((it) => all.has(it.z));
      if (!ws.length) continue;
      body += `<div class="unit">${u.n || ''}（${ws.length}）</div><div class="grid">`;
      for (const it of ws) {
        const z = it.z;
        const photo = PHOTOS[z] && fs.existsSync(path.join(IMG, PHOTOS[z]));
        if (photo) photoN++;
        else if (CARDS.has(z)) cardN++;
        const thumb = photo
          ? `<img src="img/${PHOTOS[z]}" loading="lazy" alt="${z}">`
          : PICS[z] || '';
        const tag = photo ? '<span class="tag ok">真图</span>' : CARDS.has(z) ? '<span class="tag">文字卡</span>' : '';
        body += `<div class="pc${photo ? ' ok' : CARDS.has(z) ? ' card' : ''}">
  <div class="thumb">${thumb}</div>
  <div class="zi">${z}</div>
  <div class="py">${it.p || ''}</div>
  ${tag}
</div>`;
      }
      body += '</div>';
    }
    body += '</div>';
  }
  body += '</section>';
}

const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>看图识字 · 素材画廊</title>
<style>
  :root{--ink:#37474f;--acc:#ff7043;--ok:#2e9e6b;--line:#e3e8ee;--bg:#f5f7fa}
  *{box-sizing:border-box}
  body{margin:0;font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;background:var(--bg);color:var(--ink)}
  header{padding:20px 16px 8px;max-width:1100px;margin:0 auto}
  h1{margin:0 0 4px;font-size:22px}
  .sub{color:#607d8b;font-size:13px;line-height:1.6}
  .legend{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0 4px;font-size:13px}
  .legend span{display:inline-flex;align-items:center;gap:6px}
  .sw{width:14px;height:14px;border-radius:4px;display:inline-block}
  .sw.ill{border:2px solid #cfd8dc;background:#fff}
  .sw.cd{border:2px solid var(--acc);background:#fff7f2}
  .sw.ph{border:2px solid var(--ok);background:#f2fbf6}
  main{max-width:1100px;margin:0 auto;padding:8px 16px 40px}
  .grade{margin-top:22px}
  .grade h2{font-size:18px;margin:0 0 2px}
  .unit{margin:14px 0 6px;font-size:14px;color:#455a64;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:10px}
  .pc{position:relative;background:#fff;border:2px solid #cfd8dc;border-radius:14px;padding:8px 4px 6px;text-align:center;box-shadow:0 2px 6px rgba(0,0,0,.05)}
  .pc.card{border-color:var(--acc);background:#fff7f2}
  .pc.ok{border-color:var(--ok);background:#f2fbf6}
  .thumb{width:72px;height:72px;margin:0 auto;display:flex;align-items:center;justify-content:center}
  .thumb svg{width:100%;height:100%;display:block}
  .thumb img{width:100%;height:100%;object-fit:cover;border-radius:8px;display:block}
  .zi{font-size:22px;font-weight:800;margin-top:2px;font-family:"KaiTi","STKaiti","楷体",serif}
  .py{font-size:11px;color:#78909c;margin-top:1px}
  .tag{position:absolute;top:-8px;right:-6px;background:var(--acc);color:#fff;font-size:10px;padding:1px 6px;border-radius:999px}
  .tag.ok{background:var(--ok)}
  footer{max-width:1100px;margin:0 auto;padding:0 16px 40px;color:#90a4ae;font-size:12px;line-height:1.7}
</style></head><body>
<header>
  <h1>看图识字 · 素材画廊</h1>
  <div class="sub">共 ${all.size} 个字。真图（CogView-4 生成 / 教材裁图）${photoN} 张；其余回退内联 SVG，其中「文字卡」${cardN} 张（颜色/数字/方向/时间等抽象字，大字+拼音呈现）。</div>
  <div class="legend">
    <span><i class="sw ph"></i> 真图 ${photoN}</span>
    <span><i class="sw ill"></i> 手绘插画 SVG</span>
    <span><i class="sw cd"></i> 文字卡（大字+拼音）</span>
  </div>
</header>
<main>${body}</main>
<footer>由 <code>tools/gen-gallery.mjs</code> 生成 · 数据源 js/pics.js + img/ · 改完图库重跑一次即可</footer>
</body></html>`;

fs.writeFileSync(path.join(ROOT, 'pics.html'), html);
console.log(
  `pics.html 已重生成：${all.size} 字 / 真图 ${photoN} / 文字卡 ${cardN} / SVG ${all.size - photoN - cardN}（${html.length}B）`,
);
