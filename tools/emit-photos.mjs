#!/usr/bin/env node
/**
 * emit-photos.mjs —— 扫描 img/ 目录，把「字 → 文件名」写进 js/pics.js 的 window.PIC_PHOTOS
 *
 * pics.js 结构：window.PICS = {...}; window.PIC_CARDS = [...];
 * 本脚本用括号深度定位 PICS 的结束位置，在其后插入/替换 PIC_PHOTOS 一行，
 * PICS 与 PIC_CARDS 内容原样保留（PIC_CARDS 是死数据但必须保留，防止别处引用）。
 *
 * 用法：node tools/emit-photos.mjs [--dry]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'img');
const PICS_FILE = path.join(ROOT, 'js', 'pics.js');
const DRY = process.argv.includes('--dry');

const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'scenes.json'), 'utf8'));
const photos = {};
for (const z of Object.keys(scenes)) {
  const f = path.join(IMG, 'u' + z.codePointAt(0).toString(16) + '.webp');
  if (fs.existsSync(f) && fs.statSync(f).size >= 3000) photos[z] = 'u' + z.codePointAt(0).toString(16) + '.webp';
}
const total = Object.keys(scenes).length;
console.log(`img/ 里已有 ${Object.keys(photos).length} / ${total} 张`);

let src = fs.readFileSync(PICS_FILE, 'utf8');
/* 用括号深度找 window.PICS = {...} 的结束下标 */
const start = src.indexOf('window.PICS');
if (start < 0) throw new Error('pics.js 里找不到 window.PICS');
const braceStart = src.indexOf('{', start);
let depth = 0, end = -1;
for (let i = braceStart; i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
}
if (end < 0) throw new Error('PICS 花括号不配对');

const block = `\n/* 课本插画真图（tools/gen-pics.mjs 生成，assets/img/ 下）；缺图自动回退上面的 SVG */\nwindow.PIC_PHOTOS = ${JSON.stringify(photos)};`;
/* 若已存在 PIC_PHOTOS 则先删掉旧的 */
src = src.replace(/\n\/\* 课本插画真图[^*]*\*\/\nwindow\.PIC_PHOTOS = \{[^}]*\};/, '');
const insertAt = src.indexOf('\n', end);
src = src.slice(0, insertAt) + block + src.slice(insertAt);

if (DRY) { console.log('--dry：不写回'); process.exit(0); }
fs.writeFileSync(PICS_FILE, src);
console.log(`已写入 PIC_PHOTOS（${Object.keys(photos).length} 项）→ ${path.relative(ROOT, PICS_FILE)}（${fs.statSync(PICS_FILE).size}B）`);
