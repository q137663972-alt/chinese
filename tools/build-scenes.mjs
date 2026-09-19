#!/usr/bin/env node
/**
 * build-scenes.mjs —— 为 567 个生字生成「课本插画风」生图用的英文情境描述
 *
 * 数据来源（全部来自仓库本地，无需联网就能拿到主体线索）：
 *   · data-c{N}.js 里每个词条的 k 字段 = 一个 emoji（576/576 条都有）
 *     → python emoji.demojize() 反解出英文短码（:snowflake: → snowflake）
 *   · 词条的 w 字段 = 词语（中文）→ myMemory 免费翻译翻成英文（带本地缓存）
 *
 * 产出：tools/scenes.json  { "雪": { emo, gloss, subject }, ... }
 *
 * 用法：
 *   node tools/build-scenes.mjs            # 生成（缺的才去翻译，结果缓存在 tmp/words.en.json）
 *   node tools/build-scenes.mjs --no-net   # 只用已有缓存，不联网
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JS = path.join(ROOT, 'js');
const TMP = path.join(ROOT, 'tmp');
const CACHE = path.join(TMP, 'words.en.json');
const OUT = path.join(ROOT, 'tools', 'scenes.json');
const ARGV = process.argv.slice(2);
const NO_NET = ARGV.includes('--no-net');

fs.mkdirSync(TMP, { recursive: true });

/* ── 1. 载入词条 ─────────────────────────────── */
const win = { GRADES: [] };
for (const f of fs.readdirSync(JS).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
  new Function('window', fs.readFileSync(path.join(JS, f), 'utf8') + '\n;return window;')(win);
}
const items = new Map();
for (const g of win.GRADES) {
  for (const b of g.books || []) {
    for (const u of b.u || []) {
      for (const it of u.w || []) if (!items.has(it.z)) items.set(it.z, it);
    }
  }
}

/* ── 2. emoji → 英文短语（python emoji 库） ───── */
const emos = [...new Set([...items.values()].map((x) => x.k).filter(Boolean))];
const emojiMap = {};
{
  const py = `
import json, emoji, sys
emos = json.loads(sys.argv[1])
print(json.dumps({e: emoji.demojize(e).strip(':').replace('_',' ') for e in emos}, ensure_ascii=False))
`;
  const out = execFileSync('python3', ['-c', py, JSON.stringify(emos)], { encoding: 'utf8' });
  Object.assign(emojiMap, JSON.parse(out.trim().split('\n').pop()));
}

/* ── 3. 词语 → 英文（myMemory，带缓存） ──────── */
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, 'utf8')) : {};
const words = [...new Set([...items.values()].flatMap((x) => x.w || []))];
const need = words.filter((w) => !cache[w]);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function translate(q) {
  const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(q)}&langpair=zh-CN|en`;
  const res = await fetch(url);
  const js = await res.json();
  const t = js?.responseData?.translatedText || '';
  if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT|ARE YOU HAPPY/i.test(t)) return '';
  return String(t).replace(/&#\d+;/g, '').trim().toLowerCase();
}

if (need.length && !NO_NET) {
  console.log(`需要翻译 ${need.length} 个词语（缓存已有 ${words.length - need.length} 个）`);
  let done = 0, fail = 0;
  for (const w of need) {
    try {
      const t = await translate(w);
      if (t) { cache[w] = t; done++; } else { fail++; }
    } catch (e) { fail++; }
    if ((done + fail) % 50 === 0) {
      fs.writeFileSync(CACHE, JSON.stringify(cache, null, 0));
      console.log(`  进度 ${done + fail}/${need.length}（成功 ${done} 失败 ${fail}）`);
    }
    await sleep(120);
  }
  fs.writeFileSync(CACHE, JSON.stringify(cache, null, 0));
  console.log(`翻译完成：成功 ${done} 失败 ${fail}`);
} else if (need.length) {
  console.log(`⚠️ --no-net：还有 ${need.length} 个词语没翻译，先用缓存里的`);
}

/* ── 4. 手工覆盖：emoji 和词语都表达不了的字 ─── */
const OVERRIDE = {
  /* 人称代词：图必须能一眼看出是谁 */
  你: 'two children standing face to face, one child pointing at the other',
  我: 'one single happy child alone, pointing at their own chest with one hand',
  他: 'a boy standing a little far away, seen from the side',
  人: 'a smiling child standing with arms slightly open',
  /* 数字：用气球数量来表达，课本里最好认 */
  零: 'an empty plate with nothing on it, zero items',
  一: 'one red balloon',
  二: 'two balloons, one red one yellow',
  三: 'three balloons in a row',
  四: 'four balloons in a row',
  五: 'five balloons in a row',
  六: 'six balloons in a row',
  七: 'seven balloons in a row',
  八: 'eight balloons in a row',
  九: 'nine balloons in a row',
  十: 'ten balloons together',
  /* 机器翻译翻坏了的字 */
  雪: 'snowflakes falling and a snowman in a snowy yard',
  街: 'a small busy street with shops, trees and people walking',
  镜: 'a round mirror on a stand reflecting light',
  金: 'gold coins and a gold medal',
  耳: 'a big cute ear with a small earring',
  妹: 'a little girl with twin ponytails wearing a dress',
  校: 'a school building with a flag, children walking through the gate',
  枣: 'red jujube dates growing on a branch',
  穿: 'a child putting on a warm jacket',
  助: 'two children helping each other, holding hands',
  均: 'a balance scale with equal weights on both sides',
  牢: 'a strong iron cage with a padlock',
  控: 'a child holding a game controller',
  骗: 'a boy with a long nose like pinocchio telling a lie',
  举: 'a child raising one hand high in class',
  止: 'a red octagonal stop sign',

  /* 单名词太抽象，生图会乱来：补成课本里认得出的具体画面 */
  地: 'green ground with grass, soil and a small hill',
  木: 'a wooden log and a wooden board',
  石: 'a grey rock on the ground',
  牙: 'a big white tooth',
  眉: 'a child face with clearly drawn eyebrows',
  舌: 'a child sticking out their tongue',
  鸟: 'a little bird perched on a branch',
  笔: 'a pencil and a coloured pen',
  冰: 'ice cubes and a clear ice block',
  米: 'a bowl of white rice',
  豆: 'green beans in a pod',
  梨: 'a yellow pear fruit',
  糖: 'colourful candies in a glass jar',
  跑: 'a child running on a playground track',
  说: 'a child cupping hands around mouth and calling out',
  哭: 'a child crying with big tears',
  红: 'a bright red apple',
  黄: 'a yellow banana',
  绿: 'a green leaf',
  白: 'a white cup of milk',
  黑: 'a black cat silhouette',
  方: 'a square wooden block',
  静: 'a child reading quietly in a library, finger on lips',
  冷: 'a child shivering in a scarf with snowflakes around',
  震: 'the ground cracking with houses shaking, earthquake',
  魔: 'a wizard with a magic wand and sparkling stars',
  爱: 'a mother and child hugging each other',
  美: 'a butterfly resting on a blooming flower',
  水: 'a clear stream of water and a glass of clean water',
  火: 'a warm campfire with orange flames',
  土: 'a mound of brown soil with a small green sprout growing out',
  岩: 'a rocky cliff',
  龙: 'a chinese dragon dancing with a dragon head',
};

/* ── 5. 组装 subject ─────────────────────────── */
/* 机器翻译和 emoji 短码里都会混进脏东西（metar.sn、keycap 1、html 标签、&help…），
   一律丢掉，宁可只用另一路线索，也不能把垃圾写进 prompt */
const DIRTY = /[.&:<>"'\t\d]|metar|www|http|avg|f6/i;
const clean = (s) => {
  if (!s) return '';
  let t = String(s).replace(/[.,;:!?"'\t]+$/g, '').trim();
  if (DIRTY.test(t) || t.length > 40) return '';
  return t;
};
/* 这些 emoji 短码对生图没帮助，直接丢弃 */
const EMOJI_BAD = /\bkeycap\b|without snow|showing (europe|africa|americas)|relieved face|f6/i;

const scenes = {};
for (const [z, it] of items) {
  let emo = (emojiMap[it.k] || '').replace(/-/g, ' ').trim();
  if (EMOJI_BAD.test(emo)) emo = '';
  const gloss = (it.w || []).map((w) => clean(cache[w])).filter(Boolean);
  let subject = OVERRIDE[z] || '';
  if (!subject) {
    const parts = [];
    if (gloss[0]) parts.push(gloss[0]);
    if (emo && !parts.some((p) => p.includes(emo) || emo.includes(p))) parts.push(emo);
    subject = parts.join(', ') || emo || '';
  }
  scenes[z] = { z, p: it.p, emo, gloss, subject };
}
const fallback = Object.values(scenes).filter((s) => !s.subject);
if (fallback.length) console.log(`⚠️ ${fallback.length} 个字没有可用描述：${fallback.map((s) => s.z).join('')}`);

fs.writeFileSync(OUT, JSON.stringify(scenes, null, 0));
console.log(`\n已写出 ${Object.keys(scenes).length} 条 → ${path.relative(ROOT, OUT)}`);
const sample = ['天', '地', '人', '你', '我', '他', '雪', '街', '镜', '爱', '静', '美', '猫'];
for (const z of sample) if (scenes[z]) console.log(`  ${z} [${scenes[z].p}] → ${scenes[z].subject}`);
