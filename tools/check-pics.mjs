#!/usr/bin/env node
/**
 * check-pics.mjs —— 语文「看图识字」图撞车校验（防回归）
 *
 * 背景：看图识字题干是图（PICS[z]），选项是同单元的汉字文本。
 * 出题函数 optsOf()/picDistractors() 只在本单元内取样干扰项，
 * 因此「同一单元内两个字共用同一张 SVG」= 孩子看到两个都对的答案，题无解。
 * 跨单元同图不影响答题，只作提示。
 *
 * 用法：
 *   node tools/check-pics.mjs            # 校验同单元撞车（默认，撞车则 exit 1）
 *   node tools/check-pics.mjs --global   # 额外要求全库 567 字两两不同
 *   node tools/check-pics.mjs --quiet    # 只打印结论
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');

const ARGV = process.argv.slice(2);
const WANT_GLOBAL = ARGV.includes('--global');
const QUIET = ARGV.includes('--quiet');

/* ── 1. 载入图库 ─────────────────────────────── */
const win = {};
{
  const src = fs.readFileSync(path.join(JS, 'pics.js'), 'utf8');
  // pics.js 依赖 window 与全局作用域，用 vm 太重，这里直接构造一个 window 后 eval
  const fn = new Function('window', src + '\n;return window;');
  Object.assign(win, fn(win));
}
const PICS = win.PICS || {};
const CARDS = win.PIC_CARDS || [];

/* ── 2. 载入单元数据 ─────────────────────────── */
// data-c{N}.js 是 IIFE：命中 window.CP.setGrade 就交给它，否则 push 进 window.GRADES
const dataWin = { GRADES: [] };
for (const f of fs.readdirSync(JS).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
  const fn = new Function('window', fs.readFileSync(path.join(JS, f), 'utf8') + '\n;return window;');
  Object.assign(dataWin, fn(dataWin));
}
const grades = dataWin.GRADES || [];

const units = [];
for (const g of grades) {
  for (const b of g.books || []) {
    for (const u of b.u || []) {
      units.push({ g: g.g, book: b.n || '', unit: u.n || '', w: u.w || [] });
    }
  }
}

/* ── 3. 扫描 ─────────────────────────────────── */
const collisions = [];   // 同单元撞车（致命）
const missing = [];      // 单元里的字没有图（会回退成纯字卡）
const byGrade = {};

for (const u of units) {
  const seen = new Map();
  for (const it of u.w) {
    const z = it.z;
    if (!PICS[z]) { missing.push(`G${u.g} ${u.book}·${u.unit}: ${z}`); continue; }
    const svg = PICS[z];
    if (seen.has(svg)) {
      collisions.push(`G${u.g} ${u.book}·${u.unit}: ${seen.get(svg)} = ${z}`);
      byGrade[u.g] = (byGrade[u.g] || 0) + 1;
    } else {
      seen.set(svg, z);
    }
  }
}

/* 全库重复组（跨单元不致命，仅提示） */
const groups = new Map();
for (const [z, svg] of Object.entries(PICS)) {
  if (!groups.has(svg)) groups.set(svg, []);
  groups.get(svg).push(z);
}
const dupGroups = [...groups.values()].filter((a) => a.length > 1);

/* ── 4. 输出 ─────────────────────────────────── */
const line = (s = '') => console.log(s);

line('════ 语文图库校验 check-pics ════');
line(`图库       : ${Object.keys(PICS).length} 字 / PIC_CARDS ${CARDS.length} 项`);
line(`单元       : ${units.length} 个（${grades.length} 个年级）`);
line(`全库重复组 : ${dupGroups.length} 组 / ${dupGroups.reduce((s, a) => s + a.length, 0)} 字`);
line(`同单元撞车 : ${collisions.length} 处 ${collisions.length ? '❌' : '✅'}`);
if (Object.keys(byGrade).length) {
  line('  按年级   : ' + Object.entries(byGrade).sort().map(([g, n]) => `G${g}=${n}`).join('  '));
}
line(`缺图       : ${missing.length} 字 ${missing.length ? '⚠️' : '✅'}`);

if (!QUIET) {
  if (collisions.length) {
    line('');
    line('── 同单元撞车明细（必须清零）──');
    collisions.forEach((c) => line('  ' + c));
  }
  if (missing.length) {
    line('');
    line('── 缺图明细（会回退成纯字卡）──');
    missing.slice(0, 30).forEach((c) => line('  ' + c));
    if (missing.length > 30) line(`  … 另 ${missing.length - 30} 条`);
  }
  if (dupGroups.length) {
    line('');
    line('── 全库重复组（跨单元不致命）──');
    dupGroups.sort((a, b) => b.length - a.length).forEach((a) => line('  ' + a.join(' = ')));
  }
}

/* ── 5. 判定 ─────────────────────────────────── */
let bad = false;
if (collisions.length) {
  line('');
  line(`❌ 存在 ${collisions.length} 处同单元撞车，看图识字会出现「两个选项都对」的死题`);
  bad = true;
}
if (WANT_GLOBAL && dupGroups.length) {
  line(`❌ --global 模式下要求全库唯一，仍有 ${dupGroups.length} 组重复`);
  bad = true;
}
if (CARDS.length === 0) {
  line('❌ PIC_CARDS 丢失（改 pics.js 时必须保留它）');
  bad = true;
}
if (Object.keys(PICS).length === 0) {
  line('❌ PICS 为空');
  bad = true;
}

if (!bad) {
  line('');
  line('✅ 校验通过');
}
process.exit(bad ? 1 : 0);
