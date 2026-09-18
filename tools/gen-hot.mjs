#!/usr/bin/env node
/* ===================== 热更包生成器（Hot Pack Generator） =====================
 * 产出 hot/ 目录：manifest.js + shell.html + css/ + js/*
 * 唯一事实来源：
 *   - js/boot.js 里的 BUILTIN / BIG / APP / HOT_TOKEN（顺序与配置的唯一来源）
 *   - index.html 里 <!-- shell:begin --> ~ <!-- shell:end --> 之间的 body 片段
 * 所以不需要手工维护第二份 shell，也不会和源码漂移。
 *
 * 用法：node tools/gen-hot.mjs [--out hot] [--base https://…/hot/]
 * ========================================================================= */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, String(opt("out", "hot")));
const BASE = String(opt("base", "")).replace(/\/+$/, "");

const fail = (m) => { console.error("❌ " + m); process.exit(1); };

/* ---------- FNV-1a 双通道 32bit → 16 hex ----------
 * 必须与 js/boot.js 里的 fnv() 逐字一致，否则校验永远对不上。 */
function fnv(s) {
  let a = 0x811c9dc5, b = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2166136261);
  }
  return ("0000000" + (a >>> 0).toString(16)).slice(-8) + ("0000000" + (b >>> 0).toString(16)).slice(-8);
}
const sha256 = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");

/* ---------- 1. 从 boot.js 读配置 ---------- */
const bootPath = path.join(ROOT, "js/boot.js");
if (!fs.existsSync(bootPath)) fail("找不到 js/boot.js");
const boot = fs.readFileSync(bootPath, "utf8");

const pick = (re, name) => {
  const m = boot.match(re);
  if (!m) fail(`boot.js 里读不到 ${name}`);
  return m[1];
};
const APP = pick(/var\s+APP\s*=\s*"([^"]+)"/, "APP");
const HOT_TOKEN = pick(/var\s+HOT_TOKEN\s*=\s*"([^"]+)"/, "HOT_TOKEN");
const BUILTIN = JSON.parse(pick(/var\s+BUILTIN\s*=\s*(\[[\s\S]*?\])\s*;/, "BUILTIN"));
const BIG = (boot.match(/var\s+BIG\s*=\s*(\[[\s\S]*?\])\s*;/)
  ? JSON.parse(boot.match(/var\s+BIG\s*=\s*(\[[\s\S]*?\])\s*;/)[1]) : []);

if (!Array.isArray(BUILTIN) || !BUILTIN.length) fail("BUILTIN 必须是非空数组");
if (BUILTIN.indexOf("js/boot.js") >= 0) fail("BUILTIN 不能包含 js/boot.js（它不能热更自己）");
if (BUILTIN.indexOf("js/update.js") < 0) console.warn("⚠️  BUILTIN 里没有 js/update.js，升级提示条将不会加载");
BIG.forEach((f) => { if (BUILTIN.indexOf(f) < 0) fail(`BIG 里的 ${f} 不在 BUILTIN 中`); });

/* ---------- 2. 从 index.html 抽 shell ---------- */
const htmlPath = path.join(ROOT, "index.html");
if (!fs.existsSync(htmlPath)) fail("找不到 index.html");
const html = fs.readFileSync(htmlPath, "utf8");
const shellM = html.match(/<!--\s*shell:begin\b[\s\S]*?-->([\s\S]*?)<!--\s*shell:end\b[\s\S]*?-->/);
if (!shellM) fail("index.html 里找不到 <!-- shell:begin --> / <!-- shell:end --> 标记");
const shell = shellM[1].trim();
if (shell.indexOf("js/boot.js") >= 0) fail("shell 片段里不能引用 js/boot.js（boot 在 shell 之外）");
if (shell.indexOf("<script") >= 0) fail("shell 片段里不能有 <script>（脚本全部由 boot.js 按 BUILTIN 顺序注入）");

/* ---------- 3. 生成 ---------- */
fs.rmSync(OUT, { recursive: true, force: true });

const put = (rel, text) => {
  const dst = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, text);
  /* n 必须等于 JS 侧的 text.length（UTF-16 码元数），不能是 UTF-8 字节数 ——
     否则带中文注释的文件会被 boot.js 判成「下载损坏」 */
  return { p: rel, h: fnv(text), s: sha256(text), n: text.length, bytes: Buffer.byteLength(text) };
};

const cssRel = "css/style.css";
if (!fs.existsSync(path.join(ROOT, cssRel))) fail("找不到 css/style.css");
const cssMeta = put(cssRel, fs.readFileSync(path.join(ROOT, cssRel), "utf8"));
const shellMeta = put("shell.html", shell);

const files = BUILTIN.map((p) => {
  const f = path.join(ROOT, p);
  if (!fs.existsSync(f)) fail(`BUILTIN 里的 ${p} 不存在`);
  return put(p, fs.readFileSync(f, "utf8"));
});

/* build = sha256(所有文件 path:hash 拼接).slice(0,16)
 * → 内容不变则 build 不变，天然幂等 */
const all = files.concat([shellMeta, cssMeta]);
const build = sha256(all.map((f) => f.p + ":" + f.h).join("|")).slice(0, 16);

/* ts 取源文件里最新的 mtime —— 保证同样的输入产出字节一致（幂等） */
let tsMs = 0;
all.forEach((f) => {
  const src = f.p === "shell.html" ? htmlPath : path.join(ROOT, f.p);
  tsMs = Math.max(tsMs, fs.statSync(src).mtimeMs);
});

const man = {
  v: 1,
  app: APP,
  ts: new Date(tsMs).toISOString(),
  build,
  sig: HOT_TOKEN,
  base: BASE || undefined,
  big: BIG,
  shellH: shellMeta.h, shellN: shellMeta.n,
  cssH: cssMeta.h, cssN: cssMeta.n,
  files: files.map((f) => ({ p: f.p, h: f.h, s: f.s, n: f.n }))
};
fs.writeFileSync(path.join(OUT, "manifest.js"), "window.HOT_MANIFEST=" + JSON.stringify(man) + ";\n");

/* update.json → hot/update.js（手写、入库） */
const upPath = path.join(ROOT, "update.json");
if (fs.existsSync(upPath)) {
  const raw = fs.readFileSync(upPath, "utf8").trim();
  JSON.parse(raw); // 格式不对就报错，别把坏 JSON 发上去
  fs.writeFileSync(path.join(OUT, "update.js"), "window.APP_UPDATE=" + raw + ";\n");
}

/* ---------- 4. 报告 ---------- */
const bytes = all.reduce((a, f) => a + f.bytes, 0);
const bigBytes = files.filter((f) => BIG.indexOf(f.p) >= 0).reduce((a, f) => a + f.bytes, 0);
const coreBytes = bytes - bigBytes;
console.log(`✅ ${APP}   build=${build}`);
console.log(`   文件 ${all.length} 个  合计 ${(bytes / 1024).toFixed(1)} KB`);
console.log(`   核心 ${((coreBytes * 2) / 1024 / 1024).toFixed(2)} MB / 大文件 ${((bigBytes * 2) / 1024 / 1024).toFixed(2)} MB  ← localStorage 占用(UTF-16)估算`);
if (coreBytes * 2 > 3 * 1024 * 1024) console.warn("⚠️  核心文件超过 3MB，localStorage 可能装不下，考虑把大文件挪进 BIG");
console.log(`   输出 ${path.relative(ROOT, OUT)}/`);
