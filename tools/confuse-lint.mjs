#!/usr/bin/env node
/* ===================== tools/confuse-lint.mjs · 同类字查漏 =====================
 * 看图识字题的题干是图、选项是字。两个意思相近的字摆进同一题，图做得再像孩子也分不清
 * （天和云，配图都是天空）。`js/games.js` 里 CONFUSE_GROUPS 是手工维护的分组表，
 * 漏配必然发生 —— 2026-09-19 实测漏了整族：天-云、天-月、日-星、雷-雨 全都判不出来，
 * 因为表上只有「天-日」「月-星」「云-雾」这种两两小对。
 *
 * 手工补一个族容易，难的是知道**还漏了哪些族**。所以这个脚本从 scenes.json 的
 * emo / subject 描述里抽关键词，把「描述撞车但没被分组表覆盖」的字对全列出来，
 * 人工审一遍再补进 CONFUSE_GROUPS —— 先穷举再拍板，比拍脑袋补一组靠谱。
 *
 * 用法：
 *   node tools/confuse-lint.mjs            # 列全部疑似漏配 → tmp/confuse-lint.json
 *   node tools/confuse-lint.mjs --top 30   # 只看前 30 组
 *   node tools/confuse-lint.mjs --min 3    # 只报 3 个字以上的关键词组
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const ROOT = path.resolve(import.meta.dirname, '..');
const JS = path.join(ROOT, 'js');

const arg = (k, d) => {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 ? process.argv[i + 1] : d;
};
const TOP = Number(arg('top', '40'));
const MIN = Math.max(2, Number(arg('min', '2')));

/* 词表 + units（ games.js 里的 CONFUSE_GROUPS 校验要用） */
const win = {};
for (const f of fs.readdirSync(JS).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
  new Function('window', fs.readFileSync(path.join(JS, f), 'utf8') + '\n;return window;')(win);
}
const grades = win.GRADES || [];

/* 取 games.js 的 confuseWith —— 和 check-pics.mjs 同一套 vm 加载法：
   window 必须就是全局对象本身，否则 registerGame 的赋值和裸调用对不上。 */
const ctx = { console, DATA: { grades }, state: { gi: 0 }, PICS: {} };
ctx.window = ctx;
vm.createContext(ctx);
const shuf = (fs.readFileSync(path.join(JS, 'app.js'), 'utf8').match(/function shuffle\(a\)\{[\s\S]*?\n\}/) || [''])[0];
vm.runInContext(
  shuf + '\n' + fs.readFileSync(path.join(JS, 'games.js'), 'utf8') +
    '\n;var __out = { confuseWith, CONFUSE_GROUPS, CONFUSE_MAP };',
  ctx,
);
const { confuseWith, CONFUSE_GROUPS } = ctx.__out;

const scenes = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'scenes.json'), 'utf8'));

/* 只认内容词，去掉修饰词 —— 否则「white cloud」会把所有白色的东西串成一组 */
const STOP = new Set(
  ('with and small big little young old behind front side top bottom one two three the a an of in on to from up down at by for is are very some many new good red? ')
    .split(/\s+/)
    .filter(Boolean),
);
const tok = (s) =>
  String(s || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((t) => t.length > 2 && !STOP.has(t));

/* 关键词 → 字集 */
const idx = new Map();
for (const z of Object.keys(scenes)) {
  const s = scenes[z];
  const words = new Set([...tok(s.emo), ...tok(s.subject)]);
  for (const w of words) {
    if (!idx.has(w)) idx.set(w, new Set());
    idx.get(w).add(z);
  }
}

/* 同一个 emoji 也算同源信号（字项里的 k 字段） */
const emoji = new Map();
for (const g of grades) {
  for (const b of g.books || []) {
    for (const u of b.u || []) {
      for (const it of u.w || []) {
        if (!it.k) continue;
        if (!emoji.has(it.k)) emoji.set(it.k, new Set());
        emoji.get(it.k).add(it.z);
      }
    }
  }
}

/* 哪些字有机会出现在同一道题里：看图题的干扰项先在本单元找，凑不满会向【同年级】
   其它单元借（picDistractors → gradeAll）。所以只有同年级内的字对才可能撞车，
   跨年级的字对永远同不了题 —— 不过滤的话，「举」和「箴」这种八竿子打不着的也会报上来，
   实测 385 组噪音直接淹掉真正的漏配。 */
const gradeOf = new Map(); // z → Set(年级下标)
const unitOf = new Map();  // z → [{g, n}]
grades.forEach((g, gi) => {
  for (const b of g.books || []) {
    for (const u of b.u || []) {
      for (const it of u.w || []) {
        if (!gradeOf.has(it.z)) gradeOf.set(it.z, new Set());
        gradeOf.get(it.z).add(gi);
        if (!unitOf.has(it.z)) unitOf.set(it.z, []);
        unitOf.get(it.z).push({ g: g.g, n: u.n || '' });
      }
    }
  }
});
const canCooccur = (a, b) => {
  const A = gradeOf.get(a), B = gradeOf.get(b);
  if (!A || !B) return null;
  for (const g of A) if (B.has(g)) return g;
  return null;
};

const out = [];
const consider = (label, set) => {
  if (set.size < MIN || set.size > 15) return; // 太小的组没意义，太大的关键词太泛
  const zs = [...set].sort();
  const pairs = [];
  for (let i = 0; i < zs.length; i++) {
    for (let j = i + 1; j < zs.length; j++) {
      if (confuseWith(zs[i], zs[j])) continue;
      const g = canCooccur(zs[i], zs[j]);
      if (g === null) continue; // 不同年级 → 永远不可能同题，噪音
      const sameUnit = (unitOf.get(zs[i]) || []).some((x) => (unitOf.get(zs[j]) || []).some((y) => y.n === x.n && y.n));
      pairs.push({ p: zs[i] + zs[j], g, sameUnit });
    }
  }
  if (pairs.length) {
    out.push({
      label,
      n: zs.length,
      chars: zs.join(''),
      miss: pairs.length,
      inUnit: pairs.filter((x) => x.sameUnit).length,
      pairs: pairs.map((x) => x.p + (x.sameUnit ? '*' : '')),
    });
  }
};
for (const [w, set] of idx) consider(w, set);
for (const [k, set] of emoji) consider('emoji:' + k, set);

const star = (a, b) => b - a || 0;
out.sort((a, b) => star(a.inUnit, b.inUnit) || star(a.miss, b.miss) || b.n - a.n);

fs.writeFileSync(path.join(ROOT, 'tmp', 'confuse-lint.json'), JSON.stringify(out, null, 2));

console.log(
  `CONFUSE_GROUPS ${CONFUSE_GROUPS.length} 组 / 疑似漏配 ${out.length} 组` +
    `（先按「同单元会撞车」数、再按同年级字数排序，显示前 ${TOP}；带 * = 同一单元内就会同题）\n`,
);
for (const o of out.slice(0, TOP)) {
  console.log(`  ${String(o.inUnit).padStart(2)}同单元/${String(o.miss).padStart(2)}同年级  [${o.label}]  ${o.chars}`);
  console.log(`        漏配: ${o.pairs.slice(0, 14).join(' ')}${o.pairs.length > 14 ? ' …' : ''}`);
}
console.log(`\n完整清单 → tmp/confuse-lint.json`);
console.log('用法：人工审一遍，确认是「看图分不出」的才补进 js/games.js 的 CONFUSE_GROUPS，');
console.log('      补完跑 node tools/check-pics.mjs --quiet 验证（凑不满干扰项会让验收变红）。');
