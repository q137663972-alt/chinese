#!/usr/bin/env node
/* ===================== tools/audit-pics.mjs · 已有图的画风复查 =====================
 * 第一批图出来后反馈「有些画风成恐怖元素、背景太杂」。改 prompt 只能管住以后生成的，
 * 已经入库的得单独挑出来重做 —— 这个脚本就是干这个的。
 *
 * 判据与生成器共用 tools/style-gate.mjs 的 4 道二元题（写实? / 背景纯? / 无恐怖? / 无文字?），
 * 保证「老图复查」和「新图入库」是同一把尺子。
 *
 * 用法：
 *   node tools/audit-pics.mjs                 # 复查全部已入库图 → tmp/style-audit.json
 *   node tools/audit-pics.mjs --only 悲崩祭   # 只审指定字
 *   node tools/audit-pics.mjs --delete        # 【分级】只删致命项（写实/恐怖/图里有字）
 *   node tools/audit-pics.mjs --delete --all  # 连「只是背景杂」的一起删
 *   node tools/audit-pics.mjs --concurrency 6
 *
 * 为什么默认分级删：一张图从删到补出来要 40 秒，一次性删光 150 张 = 孩子这几天打开
 * 全是字卡。背景杂但主体清楚的那批还能认，等新图补出来再逐张换；只有孩子真会被吓到
 * 或被误导的三类（写实照片脸 / 恐怖 / 图里带字）必须立刻下架。
 *
 * ⚠️ 删图后必须跑 node tools/emit-photos.mjs —— 否则 PIC_PHOTOS 还指着已删文件，孩子看到 404。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { gateImage, GATE_ENABLED, FATAL_KEYS, GATE_ITEMS } from './style-gate.mjs';

const ROOT = path.resolve(import.meta.dirname, '..');
const IMG = path.join(ROOT, 'img');

function opt(k, d) {
  const i = process.argv.indexOf('--' + k);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : d;
}
const has = (k) => process.argv.includes('--' + k);
const ONLY = opt('only', '') ? [...opt('only', '')] : null;
const CONC = Math.max(1, Math.min(8, Number(opt('concurrency', '4'))));
const DEL = has('delete');
const ALL = has('all'); // 连「只是背景杂」的也删
const FROM_JSON = has('from-json'); // 不重跑模型，直接按 tmp/style-audit.json 里已有的清单删

const hex = (z) => 'u' + z.codePointAt(0).toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 待审清单：PIC_PHOTOS 里有、且 img/ 里真有文件的字 */
const win = {};
Object.assign(win, new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'pics.js'), 'utf8') + '\n;return window;')(win));
const PHOTOS = win.PIC_PHOTOS || {};

/* --from-json：上一轮结果还在 tmp/style-audit.json，没必要再问一遍模型
   （免费档每次答的还不一样，重跑反而会改动删除清单）。 */
if (FROM_JSON) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'tmp', 'style-audit.json'), 'utf8'));
  const kill = ALL ? (j.fatal || []).concat(j.bgOnly || []) : j.fatal || [];
  let n = 0;
  for (const b of kill) {
    const f = path.join(IMG, PHOTOS[b.z] || hex(b.z) + '.webp');
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      n++;
    }
  }
  console.log(`按已有清单删除 ${n} 张${ALL ? '（含背景不纯）' : '（仅致命项）'}`);
  console.log('删完必须跑 node tools/emit-photos.mjs 同步 PIC_PHOTOS');
  process.exit(0);
}

if (!GATE_ENABLED) {
  console.log('⚠️  没有智谱 key，闸门不可用（全部放行）。退出。');
  process.exit(1);
}

let list = Object.keys(PHOTOS).filter((z) => {
  const f = path.join(IMG, PHOTOS[z] || hex(z) + '.webp');
  return fs.existsSync(f) && fs.statSync(f).size >= 3000;
});
if (ONLY) list = list.filter((z) => ONLY.includes(z));
list.sort();

console.log(`待审 ${list.length} 张（并发 ${CONC}，判据 ${GATE_ITEMS.length} 道二元题）`);

const good = [];
const fatal = [];
const bgOnly = [];
let idx = 0;
let done = 0;

async function worker() {
  for (;;) {
    const i = idx++;
    if (i >= list.length) return;
    const z = list[i];
    const f = path.join(IMG, PHOTOS[z] || hex(z) + '.webp');
    let r = null;
    for (let a = 0; a < 3 && !r; a++) {
      try {
        r = await gateImage(f);
      } catch {
        await sleep(1500 * (a + 1));
      }
    }
    done++;
    if (!r) {
      console.log(`  [${done}/${list.length}] ${z} ⚠️ 审查失败，放过`);
      good.push(z);
    } else if (r.ok) {
      good.push(z);
    } else {
      const rec = { z, fails: r.fails, fatal: r.fatal, answers: r.answers };
      (r.fatal ? fatal : bgOnly).push(rec);
      console.log(`  [${done}/${list.length}] ${z} ${r.fatal ? '❌致命' : '⚠️ 背景'} ${r.fails.join('+')}`);
    }
    await sleep(150);
  }
}

await Promise.all(Array.from({ length: CONC }, () => worker()));

fs.writeFileSync(
  path.join(ROOT, 'tmp', 'style-audit.json'),
  JSON.stringify(
    { audited: list.length, good: good.length, goodChars: good, fatal, bgOnly, mode: ALL ? 'all' : 'tiered' },
    null,
    2,
  ),
);

console.log(`\n复查完成（共 ${list.length} 张）：`);
console.log(`  合格            ${good.length}`);
console.log(`  致命（写实/恐怖/带字） ${fatal.length}  ${fatal.map((b) => b.z).join('')}`);
console.log(`  仅背景不纯      ${bgOnly.length}  ${bgOnly.map((b) => b.z).join('')}`);

if (DEL) {
  const kill = ALL ? fatal.concat(bgOnly) : fatal;
  let n = 0;
  for (const b of kill) {
    const f = path.join(IMG, PHOTOS[b.z] || hex(b.z) + '.webp');
    if (fs.existsSync(f)) {
      fs.rmSync(f);
      n++;
    }
  }
  console.log(`\n已删除 ${n} 张${ALL ? '（含背景不纯）' : '（仅致命项）'} → 记得跑 node tools/emit-photos.mjs 同步 PIC_PHOTOS`);
}
console.log('明细 → tmp/style-audit.json');
