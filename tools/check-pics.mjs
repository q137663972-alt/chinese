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
 *   node tools/check-pics.mjs            # 全套校验（致命项则 exit 1）
 *   node tools/check-pics.mjs --global   # 额外要求全库 567 字两两不同
 *   node tools/check-pics.mjs --quiet    # 只打印结论
 *
 * 新增检查（易混字机制）：
 *   · 字卡式 SVG 统计（带 <text> 的图 = 把答案画出来了，待换插画）
 *   · 易混组幽灵字（组里的字不在词表 = 规则永远命中不了）
 *   · 真实加载 games.js 出题逻辑，48 单元 × 每字 × 3 轮模拟：
 *     断言选项满 4、无重复字、干扰项与正确答案不同图/不同易混组、
 *     任意两项之间也不同图/不同易混组，并统计跨单元借用率
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/* 语文的数据文件在 cn/js/ 下（三科已迁子目录），写成 ROOT/js 会 ENOENT */
const JS = path.join(ROOT, 'cn', 'js');

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
const PHOTOS = win.PIC_PHOTOS || {};
const CARDS = win.PIC_CARDS || [];

/* 孩子实际看到的图：有真图用真图，没有才回退 SVG。
   撞车必须按这个判 —— 两个字 SVG 相同但各自有真图时，屏幕上是两张不同的图，不算死题。 */
const imgKey = (z) => (PHOTOS[z] ? 'p:' + PHOTOS[z] : PICS[z]);

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
    if (!imgKey(z)) { missing.push(`G${u.g} ${u.book}·${u.unit}: ${z}`); continue; }
    const svg = imgKey(z);
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
for (const z of Object.keys(PICS)) {
  const k = imgKey(z);
  if (!groups.has(k)) groups.set(k, []);
  groups.get(k).push(z);
}
const dupGroups = [...groups.values()].filter((a) => a.length > 1);

/* ── 3.5 字卡式 SVG 统计 ──────────────────────
   SVG 里带 <text> = 该图把汉字/拼音直接画了出来。
   看图识字显示这种图 = 把答案摆出来，必须逐步全部换成插画。
   有真图的字不算 —— 屏幕上显示的是照片，SVG 只是兜底。 */
const cardChars = Object.keys(PICS).filter((z) => !PHOTOS[z] && /<text[\s/>]/.test(PICS[z]));
const drawChars = Object.keys(PICS).length - cardChars.length;

/* ── 3.6 载入 games.js 出题逻辑做真实模拟 ──────
   必须跑【完整】games.js：文件顶部 registerGame({…start: startListen})
   引用的函数都定义在文件后部，靠的是函数声明提升 —— 只有整个文件一起执行才成立。
   旧版按 marker 截断源码，把提升链切断了，直接 ReferenceError。 */
const STATE = { gi: 0 };
const GAMES = (() => {
  const gsrc = fs.readFileSync(path.join(JS, 'games.js'), 'utf8');
  const asrc = fs.readFileSync(path.join(JS, 'app.js'), 'utf8');
  const shuf = (asrc.match(/function shuffle\(a\)\{[\s\S]*?\n\}/) || [''])[0];
  if (!shuf) throw new Error('app.js 里找不到 shuffle()');
  /* vm 沙箱里 window 必须就是全局对象本身：
     games.js 里 window.registerGame = … 是属性赋值，而后面是裸调用 registerGame(…)，
     只有 window === globalThis 时这俩才指向同一个东西。 */
  const ctx = { PICS, console, DATA: { grades }, state: STATE };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(
    shuf + '\n' + gsrc + '\n;var __out = { picDistractors, confuseWith, CONFUSE_MAP, CONFUSE_GROUPS, ABSTRACT, buildRoundsPic };',
    ctx,
  );
  return ctx.__out;
})();
const { picDistractors, confuseWith, CONFUSE_MAP, CONFUSE_GROUPS, ABSTRACT } = GAMES;

/* 易混组里的字必须真实存在于词表，否则规则永远命中不了（幽灵字） */
const vocab = new Set();
for (const u of units) for (const it of u.w) vocab.add(it.z);
const ghosts = [];
for (const g of CONFUSE_GROUPS) for (const z of g) if (!vocab.has(z)) ghosts.push(z);

/* 模拟出题：每个单元每个字各出 3 遍 */
const sim = { q: 0, short: 0, dupZ: 0, vsCorrect: 0, pairwise: 0, borrow: 0, opts: 0, badCases: [] };
for (let gi = 0; gi < grades.length; gi++) {
  STATE.gi = gi;
  for (const g of [grades[gi]]) {
    for (const b of g.books || []) {
      for (const u of b.u || []) {
        for (const c of u.w || []) {
          for (let t = 0; t < 3; t++) {
            const opts = picDistractors(u, c, 4);
            const zs = opts.map((o) => o.z);
            sim.q++; sim.opts += zs.length;
            if (zs.length < 4) { sim.short++; if (sim.badCases.length < 10) sim.badCases.push(`G${g.g} ${u.n || ''} ${c.z} 仅 ${zs.length} 项`); }
            if (new Set(zs).size !== zs.length) sim.dupZ++;
            const inUnit = zs.filter((z) => (u.w || []).some((x) => x.z === z)).length;
            sim.borrow += zs.length - inUnit;
            for (const z of zs) {
              if (z !== c.z && (confuseWith(c.z, z) || imgKey(c.z) === imgKey(z))) sim.vsCorrect++;
            }
            for (let i = 0; i < zs.length; i++) {
              for (let j = i + 1; j < zs.length; j++) {
                if (confuseWith(zs[i], zs[j]) || (imgKey(zs[i]) && imgKey(zs[i]) === imgKey(zs[j]))) sim.pairwise++;
              }
            }
          }
        }
      }
    }
  }
}

/* ── 4. 输出 ─────────────────────────────────── */
const line = (s = '') => console.log(s);

line('════ 语文图库校验 check-pics ════');
line(`图库       : ${Object.keys(PICS).length} 字 / PIC_CARDS ${CARDS.length} 项`);
line(`单元       : ${units.length} 个（${grades.length} 个年级）`);
line(`全库重复组 : ${dupGroups.length} 组 / ${dupGroups.reduce((s, a) => s + a.length, 0)} 字`);
line(`同单元撞车 : ${collisions.length} 处 ${collisions.length ? '⚠️ 已被出题逻辑免疫' : '✅'}`);
if (Object.keys(byGrade).length) {
  line('  按年级   : ' + Object.entries(byGrade).sort().map(([g, n]) => `G${g}=${n}`).join('  '));
}
line(`缺图       : ${missing.length} 字 ${missing.length ? '⚠️' : '✅'}`);
line(`字卡式图   : ${cardChars.length} 字 / 纯插画 ${drawChars} 字${cardChars.length ? ' ⚠️ 待换插画' : ' ✅'}`);
line(`易混组     : ${CONFUSE_GROUPS.length} 组 / ${Object.keys(CONFUSE_MAP).length} 字（词表 ${vocab.size} 字）`);
line(`幽灵字     : ${ghosts.length ? ghosts.join(' ') : '无'} ${ghosts.length ? '❌' : '✅'}`);
line(`出题模拟   : ${sim.q} 题`);
line(`  选项不足4    : ${sim.short} ${sim.short ? '❌' : '✅'}`);
line(`  同字重复     : ${sim.dupZ} ${sim.dupZ ? '❌' : '✅'}`);
line(`  正确项被撞   : ${sim.vsCorrect} ${sim.vsCorrect ? '❌' : '✅'}`);
line(`  任意两项撞   : ${sim.pairwise} ${sim.pairwise ? '⚠️' : '✅'}`);
line(`  跨单元借用率 : ${(sim.borrow / sim.opts * 100).toFixed(1)}%`);

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
if (!QUIET && sim.badCases.length) {
  line('');
  line('── 出题异常明细 ──');
  sim.badCases.forEach((c) => line('  ' + c));
}

let bad = false;
if (collisions.length) {
  line('');
  line(`⚠️ 图库里还有 ${collisions.length} 处同单元同图（G3/G4/G5）。`);
  line('   picDistractors() 已强制排除同图干扰项，不会出死题；换完 567 张插画后自动归零。');
}
if (sim.short) { line(''); line(`❌ 出题模拟有 ${sim.short} 题选项凑不满 4 个`); bad = true; }
if (sim.dupZ) { line(''); line(`❌ 出题模拟有 ${sim.dupZ} 题出现重复字`); bad = true; }
if (sim.vsCorrect) { line(''); line(`❌ 出题模拟有 ${sim.vsCorrect} 次「干扰项与正确答案同图或同易混组」= 死题`); bad = true; }
if (ghosts.length) { line(''); line(`❌ 易混组里有 ${ghosts.length} 个字不在词表：${ghosts.join(' ')}`); bad = true; }
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
