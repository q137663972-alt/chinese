#!/usr/bin/env node
/* ===================== 资源包生成器（Hot Pack Generator v3.0） =====================
 * 产出 hot/pack/：
 *   assets.zip   —— 图片 / 音频 / 字体等二进制（大）
 *   code.zip     —— MANIFEST.json + css + js（小，且必须最后装）
 *   manifest.json —— 远程清单，描述这一版有哪些分包、各自的 sha256 和体积
 *
 * 与旧通道（hot/manifest.js + localStorage）的区别：
 *   旧通道只能热更文本、且受 localStorage 5MB 配额限制；
 *   新通道把任意格式的文件打进 zip，由原生桥落到 files/hot/，
 *   再用虚拟域 https://local.hot/ 读取 —— 想多大就多大。
 *
 * 分包顺序很重要：assets.zip 在前、code.zip 在后。
 * MANIFEST.json 放在 code.zip 里 —— 这样 hot/ 目录是「最后一个包装完」才完整的，
 * 中途退出不会让 App 读到一个只有一半的资源包。
 *
 * 玩法热更：任何 js/game-*.js 都会被自动扫描，从文件里的 registerGame({id:"…"})
 * 读出玩法 id，写进 MANIFEST.json 的 games 数组。boot.js 会在 games.js 之后
 * 逐个加载它们 —— 新增玩法不用出 APK。
 *
 * 用法：node tools/gen-pack.mjs [--out hot/pack] [--min-apk 3]
 * ============================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, String(opt("out", "hot/pack")));

const fail = (m) => { console.error("❌ " + m); process.exit(1); };

/* ---------- 配置：全部从 js/boot.js 读，避免两处维护 ---------- */
const bootSrc = (() => {
  const f = path.join(ROOT, "js/boot.js");
  if (!fs.existsSync(f)) fail("找不到 js/boot.js");
  return fs.readFileSync(f, "utf8");
})();
const pick = (name) => {
  const m = bootSrc.match(new RegExp("var\\s+" + name + "\\s*=\\s*\"([^\"]+)\""));
  return m ? m[1] : "";
};
const APP = pick("APP");
const HOT_TOKEN = pick("HOT_TOKEN");
if (!APP || !HOT_TOKEN) fail("js/boot.js 里读不到 APP / HOT_TOKEN");

/* min_apk：默认取壳工程里的 versionCode（老 APK 装不上新包时再手工调低） */
function gradleVersionCode() {
  for (const d of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!d.isDirectory() || !d.name.endsWith("-universal")) continue;
    const g = path.join(ROOT, d.name, "app", "build.gradle");
    if (!fs.existsSync(g)) continue;
    const m = fs.readFileSync(g, "utf8").match(/versionCode\s+(\d+)/);
    if (m) return parseInt(m[1], 10);
  }
  return 0;
}
const MIN_APK = parseInt(opt("min-apk", String(gradleVersionCode())), 10);

/* FNV-1a 双通道 32bit → 16 hex（与旧 gen-hot.mjs 保持一致，方便对照） */
function fnv(s) {
  let a = 0x811c9dc5, b = 0x1000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619);
    b = Math.imul(b ^ c, 2166136261);
  }
  return ("0000000" + (a >>> 0).toString(16)).slice(-8) + ("0000000" + (b >>> 0).toString(16)).slice(-8);
}
const sha256File = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/* ---------- 1. 收集文件 ---------- */
const walk = (dir, exts) => {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p, exts));
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};

/* 代码包：css + js（boot.js 是冻结文件，永远不能进热更包） */
const codeFiles = [
  ...walk(path.join(ROOT, "css"), [".css"]),
  ...walk(path.join(ROOT, "js"), [".js"]).filter((f) => path.basename(f) !== "boot.js"),
];
/* 资源包：图片 / 音频 / 字体
 * ★ 这里必须排除 js/ 与 css/ —— 图片目录里混着的 js/css 会被打进 assets.zip，
 *   而 assets.zip 先装、code.zip 后装，原生侧是「整目录替换」：
 *   后装的 code.zip 会把先前解压出来的 js/*.js、css/*.css 一起覆盖掉（等于白装）。
 *   boot.js 是冻结文件，白装它更糟 —— 热更包里的这份会盖掉内置版。
 *   2026-09-20 修：原先 img/ 用了 .svg 扩展名白名单，图库里的 js/css 会漏进来。 */
const BANNED_IN_ASSETS = /\.(js|css|html|htm)$/i;
const assetFiles = [
  ...walk(path.join(ROOT, "img"), [".webp", ".png", ".jpg", ".svg"]),
  ...walk(path.join(ROOT, "audio"), [".mp3", ".m4a", ".ogg"]),
  ...walk(path.join(ROOT, "font"), [".woff2", ".woff", ".ttf"]),
].filter((f) => !BANNED_IN_ASSETS.test(path.relative(ROOT, f).split(path.sep).join("/")));

const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");
const codePaths = codeFiles.map(rel).sort();
const assetPaths = assetFiles.map(rel).sort();

if (!codePaths.length && !assetPaths.length) fail("没有任何可打包的文件");

/* ---------- 2. 扫描玩法（js/game-*.js 里 registerGame 的 id） ---------- */
const games = [];
for (const p of codePaths) {
  if (!/^js\/game-.+\.js$/.test(p)) continue;
  const src = fs.readFileSync(path.join(ROOT, p), "utf8");
  const ids = [...src.matchAll(/registerGame\(\s*\{[^}]*?id\s*:\s*["']([^"']+)["']/g)]
    .map((m) => m[1]);
  if (ids.length) games.push({ id: ids[0], file: p });
  else console.warn("⚠️  " + p + " 里没找到 registerGame({id:…})，跳过（首页不会出现入口）");
}

/* ---------- 3. 生成 MANIFEST.json（打进 code.zip，与文件原子同源） ---------- */
const entries = [];
for (const p of [...codePaths, ...assetPaths]) {
  const abs = path.join(ROOT, p);
  const buf = fs.readFileSync(abs);
  const isText = /\.(js|css|json|svg)$/.test(p);
  entries.push({ p, h: fnv(buf.toString("utf8")), n: isText ? buf.toString("utf8").length : buf.length, bytes: buf.length });
}
/* build = 所有文件内容的指纹，内容不变则 build 不变（客户端据此跳过重复下载） */
const build = crypto.createHash("sha256")
  .update(entries.map((e) => e.p + ":" + e.h).join("|"))
  .digest("hex").slice(0, 16);

const manifest = {
  app: APP,
  sig: HOT_TOKEN,
  build,
  min_apk: MIN_APK,
  ts: Date.now(),
  files: entries,
  games,
};

/* ---------- 4. 打 zip ---------- */
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const TMP = path.join(ROOT, "tmp/packstage");
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

/* code.zip 的内容：MANIFEST.json + css + js */
fs.writeFileSync(path.join(TMP, "MANIFEST.json"), JSON.stringify(manifest));
for (const p of codePaths) {
  const dst = path.join(TMP, p);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(ROOT, p), dst);
}

const packs = [];

/* ★ zip 文件名必须带 build 指纹（手册硬约束）：
   固定名 + CDN 缓存 = 灾难 —— 边缘节点拿到旧清单、却下载到新 zip，
   sha256 对不上直接拒装；另一部分边缘是新清单 + 新 zip 又能装。
   表现为「同一时间、不同设备，有的更新了有的没有，还伴随装机失败」。
   文件名带指纹后，每个 build 都是独立 URL：旧清单只会去取它自己那份，
   新清单取新的那份，互不干扰，也顺便破了 CDN 缓存。 */
if (assetPaths.length) {
  const zip = path.join(OUT, "assets." + build + ".zip");
  /* 大资源直接从仓库目录打包，不复制一份，省一次 3MB 的读写 */
  execFileSync("zip", ["-q", "-X", "-r", zip,
    ...assetPaths.map((p) => p)], { cwd: ROOT });
  packs.push({ name: path.basename(zip), sha256: sha256File(zip), size: fs.statSync(zip).size,
               count: assetPaths.length });
}

const codeZip = path.join(OUT, "code." + build + ".zip");
/* -X 去掉扩展属性；MANIFEST.json 必须在里面 */
execFileSync("zip", ["-q", "-X", "-r", codeZip, "MANIFEST.json", "css", "js"], { cwd: TMP });
/* code.zip 里不该出现 boot.js（冻结文件），兜底删掉 */
try { execFileSync("zip", ["-q", "-d", codeZip, "js/boot.js"], { cwd: TMP }); } catch (e) {}
packs.push({ name: path.basename(codeZip), sha256: sha256File(codeZip), size: fs.statSync(codeZip).size,
             count: codePaths.length + 1 });

/* ---------- 5. 远程清单 ---------- */
const remote = {
  app: APP,
  sig: HOT_TOKEN,
  build,
  min_apk: MIN_APK,
  ts: manifest.ts,
  /* 顺序即安装顺序：assets 在前、code（含 MANIFEST）在后 */
  packs: packs.map((p) => ({ name: p.name, sha256: p.sha256, size: p.size })),
};
fs.writeFileSync(path.join(OUT, "manifest.json"), JSON.stringify(remote, null, 2));

fs.rmSync(TMP, { recursive: true, force: true });

const kb = (n) => (n / 1024).toFixed(1) + "KB";
console.log("✅ 资源包已生成 → " + path.relative(ROOT, OUT) + "   (app=" + APP + " min_apk=" + MIN_APK + ")");
console.log("   build     " + build);
console.log("   代码文件  " + codePaths.length + " 个  → code.zip   " + kb(packs[packs.length - 1].size));
if (packs.length > 1) console.log("   资源文件  " + assetPaths.length + " 个  → assets.zip " + kb(packs[0].size));
console.log("   玩法      " + (games.length ? games.map((g) => g.id).join(", ") : "（无 js/game-*.js，玩法都在 games.js 里，改它照样能热更）"));
console.log("   分包      " + packs.map((p) => p.name + " " + kb(p.size)).join("  |  "));
console.log("   总计      " + kb(packs.reduce((s, p) => s + p.size, 0)));
