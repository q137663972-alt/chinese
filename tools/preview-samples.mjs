#!/usr/bin/env node
/**
 * preview-samples.mjs —— 拼「现图 vs 新课本风图」对比页，用于确认画风
 *
 * 用法：node tools/preview-samples.mjs 雪街镜笔爱静美我他猫
 *       node tools/preview-samples.mjs --all        # 全部已生成的图
 * 产出：tmp/samples.html
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'img');
const TMP = path.join(ROOT, 'tmp');
const hex = (z) => 'u' + z.codePointAt(0).toString(16);

const win = {};
new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'pics.js'), 'utf8') + '\n;return window;')(win);
const PICS = win.PICS || {};
const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'scenes.json'), 'utf8'));

const ARGV = process.argv.slice(2);
let chars = ARGV.filter((a) => !a.startsWith('--')).flatMap((a) => [...a]);
if (ARGV.includes('--all')) chars = Object.keys(scenes);

const b64 = (f) => 'data:image/webp;base64,' + fs.readFileSync(f).toString('base64');

const rows = chars.map((z) => {
  const f = path.join(IMG, hex(z) + '.webp');
  const f1 = path.join(ROOT, 'img_v1', hex(z) + '.webp');
  const cur = PICS[z] || '';
  const isCard = /<text[\s/>]/.test(cur);
  const hasNew = fs.existsSync(f);
  const src2 = hasNew ? b64(f) : '';
  const src1 = fs.existsSync(f1) ? b64(f1) : '';
  return { z, py: (scenes[z] || {}).p || '', subj: (scenes[z] || {}).subject || '', cur, isCard, hasNew, src1, src2, size: hasNew ? fs.statSync(f).size : 0 };
});

const html = `<!doctype html><meta charset="utf-8"><title>课本风样张对比</title>
<style>
 body{font-family:-apple-system,"PingFang SC",sans-serif;background:#f6f8fa;margin:0;padding:24px;color:#263238}
 h1{font-size:20px;margin:0 0 4px}
 .tip{color:#607d8b;font-size:13px;margin-bottom:20px}
 table{border-collapse:collapse;background:#fff;border-radius:10px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,.07)}
 th,td{border-bottom:1px solid #eceff1;padding:10px 14px;text-align:center;vertical-align:middle}
 th{background:#eceff1;font-size:13px}
 .z{font-size:26px;font-weight:800;font-family:"KaiTi","STKaiti",serif}
 .py{font-size:12px;color:#78909c}
 .box{width:150px;height:150px;display:flex;align-items:center;justify-content:center;background:#fafafa;border:1px solid #e0e0e0;border-radius:8px;margin:0 auto}
 .box svg,.box img{width:100%;height:100%;display:block;object-fit:contain}
 .subj{font-size:11px;color:#90a4ae;max-width:230px;text-align:left}
 .tag{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;background:#e3f2fd;color:#1565c0}
 .tag.card{background:#fff3e0;color:#e65100}
</style>
<h1>人教版课本插画风 · 样张对比（v1 / v2 两种画风）</h1>
<div class="tip">
 <b>现在的图</b>：<span class="tag card">字卡</span>=图里直接画着这个字，等于给答案；<span class="tag">插画</span>=手绘扁平图。<br>
 <b>v1 写实插画</b>：柔和绘本感，偏真实。<b>v2 扁平矢量</b>：粗描边+圆角造型，更接近课本插图、各张之间更统一。150px 预览 ≈ 手机上 140px 实际大小。
</div>
<table>
<tr><th>字</th><th>现在的图</th><th>v1 写实插画</th><th>v2 扁平矢量</th><th>生图用的英文情境</th></tr>
${rows.map((r) => `<tr>
<td><div class="z">${r.z}</div><div class="py">${r.py}</div></td>
<td><div class="box">${r.cur}</div><div style="margin-top:6px"><span class="tag ${r.isCard ? 'card' : ''}">${r.isCard ? '字卡' : '插画'}</span></div></td>
<td><div class="box">${r.src1 ? `<img src="${r.src1}">` : '<span style="color:#b0bec5">无</span>'}</div></td>
<td><div class="box">${r.hasNew ? `<img src="${r.src2}">` : '<span style="color:#b0bec5">未生成</span>'}</div>${r.hasNew ? `<div class="py">${(r.size / 1024).toFixed(0)} KB</div>` : ''}</td>
<td class="subj">${r.subj}</td>
</tr>`).join('\n')}
</table>`;

fs.mkdirSync(TMP, { recursive: true });
const out = path.join(TMP, 'samples.html');
fs.writeFileSync(out, html);
console.log(`已生成 ${out}（${rows.length} 个字，其中新图 ${rows.filter((r) => r.hasNew).length} 张）`);
