#!/usr/bin/env node
/**
 * gen-pics.mjs —— 批量生成「人教版课本插画风」生字图（Pollinations 免费通道）
 *
 * 通道限制（实测）：单 IP 队列上限 1，只能串行；平均约 35s/张；偶发 429/500 必须重试。
 * 策略：串行 + 退避重试 + 断点续传（已存在且体积正常的直接跳过）+ 进度日志。
 *
 * 用法：
 *   node tools/gen-pics.mjs                 # 全量 567 字（后台跑，约 6 小时）
 *   node tools/gen-pics.mjs --limit 10      # 只跑前 10 个
 *   node tools/gen-pics.mjs --chars 雪街镜  # 只跑指定字
 *   node tools/gen-pics.mjs --size 512      # 请求尺寸（后处理统一缩到 384）
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMG = path.join(ROOT, 'img');
const TMP = path.join(ROOT, 'tmp', 'raw');
const SCENES = path.join(ROOT, 'tools', 'scenes.json');
const LOG = path.join(ROOT, 'tmp', 'gen-log.jsonl');
const OUT_SIZE = 384;
fs.mkdirSync(IMG, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

import { buildPrompt } from './prompt.mjs';
import { gateImage, GATE_ENABLED } from './style-gate.mjs';

const ARGV = process.argv.slice(2);
const arg = (k, d) => {
  const i = ARGV.indexOf(k);
  return i >= 0 ? ARGV[i + 1] : d;
};
const LIMIT = Number(arg('--limit', '0')) || 0;
const CHARS = arg('--chars', '') ? [...arg('--chars', '')] : null;
const REQ = Number(arg('--size', '512'));
const MODEL = arg('--model', 'flux');

/* 画风模板统一放在 tools/prompt.mjs，和智谱那条路共用一份，避免两批图风格分裂。
   试验新画风：PIC_STYLE="..." node tools/gen-pics.mjs --chars 雪街镜 */

const scenes = JSON.parse(fs.readFileSync(SCENES, 'utf8'));
const hex = (z) => 'u' + z.codePointAt(0).toString(16);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 按年级排序：低年级优先（孩子正在学的先出完，中途中断也不影响使用） */
const gradeOf = (() => {
  const win = { GRADES: [] };
  for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
    new Function('window', fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n;return window;')(win);
  }
  const m = {};
  for (const g of win.GRADES || []) {
    for (const b of g.books || []) {
      for (const u of b.u || []) for (const it of u.w || []) if (!(it.z in m)) m[it.z] = g.g || 99;
    }
  }
  return (z) => m[z] || 99;
})();

let list = Object.keys(scenes);
if (CHARS) list = CHARS.filter((z) => scenes[z]);
/* 排队优先级：①字卡式且无真图（答案直接印在图上，最致命）②其余无真图；同级按年级升序。
   之前只按年级排，结果「插画式缺图」和「字卡式缺图」混在一起出 —— 而后者才是孩子
   一眼就能看到答案、等于题白出的那种。 */
const CARDS_SET = new Set(
  (new Function('window', fs.readFileSync(path.join(ROOT, 'js', 'pics.js'), 'utf8') + '\n;return window.PIC_CARDS || [];')({})) || [],
);
if (!CHARS) list.sort((a, b) => {
  const pa = (CARDS_SET.has(a) ? 0 : 100) + gradeOf(a);
  const pb = (CARDS_SET.has(b) ? 0 : 100) + gradeOf(b);
  return pa - pb;
});
if (LIMIT) list = list.slice(0, LIMIT);

/* 断点续传：已存在且体积 >= 3KB 视为完成 */
const todo = list.filter((z) => {
  const f = path.join(IMG, hex(z) + '.webp');
  return !(fs.existsSync(f) && fs.statSync(f).size >= 3000);
});
console.log(`待生成 ${todo.length} 张（已完成 ${list.length - todo.length} 张，共 ${list.length}）`);

async function fetchOne(z, seed) {
  const subject = scenes[z].subject;
  const prompt = buildPrompt(scenes[z].subject, z);
  const url = 'https://image.pollinations.ai/prompt/' + encodeURIComponent(prompt) +
    `?width=${REQ}&height=${REQ}&nologo=true&enhance=false&model=${MODEL}&seed=${seed}`;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 120000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (!res.ok) return { ok: false, code: res.status };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 2000) return { ok: false, code: 'tiny' };
    return { ok: true, buf };
  } catch (e) {
    clearTimeout(timer);
    return { ok: false, code: String(e.message || e).slice(0, 40) };
  }
}

const NO_GATE = process.argv.includes('--no-gate') || !GATE_ENABLED;

/* 画风闸门：图出来后让免费档视觉模型判 4 道二元题（写实? / 背景纯? / 无恐怖? / 无文字?），
   跑偏的直接废掉重出。生成一张要 40 秒，判一轮只要几秒 —— 这点代价完全值得。
   判据与 audit-pics 存量复查共用 tools/style-gate.mjs，保证新老图同一把尺子。
   返回 false（放行）或不合格原因串。 */
async function styleBad(file) {
  const r = await gateImage(file);
  /* 分级口径（与「分级替换」决策对齐）：只因「图里有字 / 恐怖元素 / 写实照片」废图，
     「背景不纯」单独命中不算废 —— 背景杂但主体能认的图要留着，等新图逐步替换。
     以前用的是 r.ok（任意一项不达标就整张作废），把这类图全废了，
     实测连废 12 张、产出 0 张 —— 闸门一上线整条通道就归零了。 */
  const hard = r.fails.filter((f) => f !== '背景不纯');
  return hard.length ? hard.join('+') : false;
}

const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
let ok = 0, fail = 0, rejected = 0;
const t0 = Date.now();

for (let i = 0; i < todo.length; i++) {
  const z = todo[i];
  /* 每次生成前重新检查：内置生图那路可能已经把这张图写好了，别重复劳动 */
  if (fs.existsSync(path.join(IMG, hex(z) + '.webp'))) {
    console.log(`[${i + 1}/${todo.length}] ${z} ⏭ 已有图，跳过`);
    continue;
  }
  let done = false;
  for (let a = 0; a < 4 && !done; a++) {
    /* 种子必须随机：Pollinations 按 seed 出缓存，固定种子会把同一张废图反复吐回来 */
    const r = await fetchOne(z, Math.floor(Math.random() * 999983));
    if (r.ok) {
      const raw = path.join(TMP, hex(z) + '.raw');
      fs.writeFileSync(raw, r.buf);
      /* 画风不过关就换一张重出，别把写实脸/阴森图塞进孩子的识字卡 */
      if (!NO_GATE) {
        const bad = await styleBad(raw);
        if (bad) {
          if (a === 3) {
            rejected++;
            log({ z, ok: false, why: 'style:' + bad, at: new Date().toISOString() });
          }
          continue;
        }
      }
      try {
        execFileSync('python3', [path.join(ROOT, 'tools', 'imgpost.py'), raw,
          path.join(IMG, hex(z) + '.webp'), String(OUT_SIZE), '80'], { encoding: 'utf8' });
        ok++; done = true;
        log({ z, ok: true, at: new Date().toISOString() });
      } catch (e) {
        log({ z, ok: false, why: 'post', at: new Date().toISOString() });
      }
    } else {
      if (a === 3) { fail++; log({ z, ok: false, why: r.code, at: new Date().toISOString() }); }
      /* 429 是限流不是故障：退避要给足时间。实测两条进程并行时会连着吃 429，
         2s/5s/10s 根本不够，改成 5s/15s/40s 才拉得回来。 */
      else await sleep(r.code === 429 ? [5000, 15000, 40000][a] : [2000, 5000, 10000][a]);
    }
  }
  const el = Math.round((Date.now() - t0) / 1000);
  const eta = ok + fail ? Math.round((todo.length - ok - fail) * el / (ok + fail) / 60) : '?';
  console.log(`[${i + 1}/${todo.length}] ${z} ${done ? '✅' : '❌'}  成功${ok} 失败${fail} 画风不合格${rejected}  用时${el}s  预计还需${eta}分钟`);
  await sleep(500);
}

console.log(`\n完成：成功 ${ok} / 失败 ${fail} / 画风不合格 ${rejected} / 共 ${todo.length}`);
if (fail) console.log(`失败的字：${todo.filter((z) => !fs.existsSync(path.join(IMG, hex(z) + '.webp'))).join('')}`);
