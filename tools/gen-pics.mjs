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

const ARGV = process.argv.slice(2);
const arg = (k, d) => {
  const i = ARGV.indexOf(k);
  return i >= 0 ? ARGV[i + 1] : d;
};
const LIMIT = Number(arg('--limit', '0')) || 0;
const CHARS = arg('--chars', '') ? [...arg('--chars', '')] : null;
const REQ = Number(arg('--size', '512'));
const MODEL = arg('--model', 'flux');

/* 画风（用户已确认 v1 写实插画）。可用环境变量 PIC_STYLE 覆盖做试验 */
const STYLE = process.env.PIC_STYLE ||
  "children's primary school Chinese textbook illustration style, cute flat cartoon, simple lovely shapes, soft bright colors, flat with slight shading, clean light background";
const COMP = 'square composition, single clear subject centered, filling over 60 percent of the frame, uncluttered';
const BAN = 'absolutely no text, no chinese characters, no pinyin, no letters, no numbers, no watermark, no caption, no speech bubble';

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
if (!CHARS) list.sort((a, b) => gradeOf(a) - gradeOf(b));
if (LIMIT) list = list.slice(0, LIMIT);

/* 断点续传：已存在且体积 >= 3KB 视为完成 */
const todo = list.filter((z) => {
  const f = path.join(IMG, hex(z) + '.webp');
  return !(fs.existsSync(f) && fs.statSync(f).size >= 3000);
});
console.log(`待生成 ${todo.length} 张（已完成 ${list.length - todo.length} 张，共 ${list.length}）`);

async function fetchOne(z, seed) {
  const subject = scenes[z].subject;
  const prompt = `${STYLE}. Scene: ${subject}. ${COMP}. ${BAN}`;
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

const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
let ok = 0, fail = 0;
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
    const r = await fetchOne(z, 1000 + i * 7 + a);
    if (r.ok) {
      const raw = path.join(TMP, hex(z) + '.raw');
      fs.writeFileSync(raw, r.buf);
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
      else await sleep([2000, 5000, 10000][a]);
    }
  }
  const el = Math.round((Date.now() - t0) / 1000);
  const eta = ok + fail ? Math.round((todo.length - ok - fail) * el / (ok + fail) / 60) : '?';
  console.log(`[${i + 1}/${todo.length}] ${z} ${done ? '✅' : '❌'}  成功${ok} 失败${fail}  用时${el}s  预计还需${eta}分钟`);
  await sleep(500);
}

console.log(`\n完成：成功 ${ok} / 失败 ${fail} / 共 ${todo.length}`);
if (fail) console.log(`失败的字：${todo.filter((z) => !fs.existsSync(path.join(IMG, hex(z) + '.webp'))).join('')}`);
