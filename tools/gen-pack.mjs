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
 * 玩法热更：任何 <学科>/js/game-*.js 都会被自动扫描，从文件里的 registerGame({id:"…"})
 * 读出玩法 id，写进 MANIFEST.json 的 games 数组。boot.js 会在本学科 games.js 之后
 * 逐个加载它们 —— 新增玩法不用出 APK。
 *
 * 用法：node tools/gen-pack.mjs [--out hot/pack] [--min-apk 3]
 * ============================================================================== */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readBootManifest } from "./lib/boot-manifest.mjs";

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf("--" + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : d;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, String(opt("out", "hot/pack")));

const fail = (m) => { console.error("❌ " + m); process.exit(1); };

/* ---------- 配置：全部从 js/boot.js 读，避免两处维护 ----------
   抽取规则统一放在 tools/lib/boot-manifest.mjs —— gen-pack / build-apk / smoke
   三处共用同一份解读，改格式只需改一处。 */
const MANIFEST = readBootManifest(ROOT);
const APP = MANIFEST.APP;
const HOT_TOKEN = MANIFEST.HOT_TOKEN;
const bootSrc = fs.readFileSync(path.join(ROOT, "js", "boot.js"), "utf8");
if (!APP || !HOT_TOKEN) fail("js/boot.js 里读不到 APP / HOT_TOKEN");

/* min_apk：门槛。boot.js 判据是 DEV.apk < m.min_apk 就直接作废整份包 ——
   ★★ 历史事故（2026-09-20）★★
   这里原先写死「默认取壳工程 versionCode」。三合一把 versionCode 提到 12，
   于是下一份热更包的门槛自动变成 12，而用户机器上还是 apk=11：
   11 < 12 → boot.js 判 "needs newer apk" → 整份包作废 → 页面停在内置版，
   表现为「更新了却什么都没变」，然后被误判成「必须出新 APK」。
   ★ 教训：热更包的门槛只能往下兼容，绝不能跟着新 APK 的 versionCode 自动抬升。
     真有"低于某个版本必须换壳"的需求时，必须显式写 --min-apk N 并在提交里说明。 */
const DEFAULT_MIN_APK = 3;
const MIN_APK = parseInt(opt("min-apk", String(DEFAULT_MIN_APK)), 10);
if (MIN_APK > DEFAULT_MIN_APK) {
  console.warn(
    "⚠️  min_apk=" + MIN_APK + "：versionCode 低于 " + MIN_APK + " 的设备会整份拒收这份包" +
    "（boot.js：DEV.apk < m.min_apk）。确认这是刻意抬的门槛，别手滑。"
  );
}

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

/* 学科目录。三科各自一个子目录，互不干涉 —— 这里必须和 js/boot.js 的 SUBJS 一致，
   差一个字母就是「热更包装了文件、boot.js 却认不出来」的静默失效。 */
const SUBJ_DIRS = ["cn", "math", "en"];

/* 代码包：css + js（boot.js 是冻结文件，永远不能进热更包）
   ★ 三科迁进子目录后，这里必须连子目录一起收：
     css/         壳 + 电视样式（三科共用）
     js/          宿主层（subject.js）
     cn|math|en/  各科自己的 css 和 js
   漏掉子目录的表现极其隐蔽 —— 资源包看起来是生成成功了（有 build、有 sha256、
   能装进去），但那份学科 App 还是跑的内置版本，改了半天以为没生效。 */
const rel = (f) => path.relative(ROOT, f).split(path.sep).join("/");

const codeFiles = [
  ...walk(path.join(ROOT, "css"), [".css"]),
  ...walk(path.join(ROOT, "js"), [".js"]).filter((f) => path.basename(f) !== "boot.js"),
  ...SUBJ_DIRS.flatMap((d) => [
    ...walk(path.join(ROOT, d, "css"), [".css"]),
    ...walk(path.join(ROOT, d, "js"), [".js"]),
  ]),
];

/* ★ 老 APK 兼容层（2.4.x 及更早）。
   那一批 App 的 boot.js 清单写死是 js/app.js 这样的根级路径，boot.js 又热更不到 ——
   所以只能靠「同路径覆盖 + 追加注入」两条口子把它们接到三科上来：
     · js/app.js —— 覆盖成「选学科看门人」（**不是空壳**）。
       它是老清单的第一个脚本，位置决定了它能抢在所有学科代码之前判断：
       没选过学科就直接渲染选学科页并收工，一个学科文件都不加载。
       ★ 2026-09-20 现场事故：原先这里是纯空壳，结果老清单里的语文 app.js 先跑完了
         —— 用户能看到三科卡片，三五秒后自己跳进语文（语文的定时器/二次渲染翻回来）。
         空壳挡不住"语文已经跑起来"这件事，必须换成看门人。
     · js/games.js / game-battle.js / update.js / data-*.js / cp.js / strokes.js /
       pics.js / tts.js / praise.js —— 纯空壳，挡住老 boot.js 把语文那一整套注进来
       （否则同一份 app.js 跑两遍，监听器挂双份、数据多解析一轮）。
     · js/bridge.js —— 老 boot.js 会无条件追加注入任何符合 ^js/.+\.js$ 的新文件，
       它进来之后自己动态加载真正的那一科。
   目标路径必须落在老布局的根级 js/ 下，写错一个字符这份兼容就静默失效。
   新版 App（2.5.0+）的清单里没有这些路径，对它们无害。
   ★ 唯一的例外是共享层 js/tv.js 与 js/tv-tune.js：三科共用一份，
     必须留在老清单里由 boot.js 加载一次，绝不能让桥接层再加载第二遍。 */
const LEGACY_STUBS = [
  "games.js", "game-battle.js", "update.js",
  "cp.js", "tts.js", "praise.js",
  "data-c1.js", "data-c2.js", "data-c3.js", "data-c4.js", "data-c5.js", "data-c6.js",
  "data-poem.js", "data-word.js", "strokes.js", "pics.js",
];
const LEGACY_MAP = [
  ["legacy/js/bridge.js", "js/bridge.js"],
  /* 看门人：和空壳分开列，免得以后有人顺手把它挪进 STUBS 又变成"纯空壳" */
  ["legacy/js/app.js", "js/app.js"],
  ...LEGACY_STUBS.map((n) => ["legacy/js/" + n, "js/" + n]),
].filter(([src]) => fs.existsSync(path.join(ROOT, src)));

/* 资源包路径 → 实际要打包的仓库路径（正常情况下两者相同，兼容层除外） */
const SRC_OF = new Map(codeFiles.map((f) => [rel(f), rel(f)]));
for (const [src, dst] of LEGACY_MAP) SRC_OF.set(dst, src);
/* 资源包：图片 / 音频 / 字体
 * ★ 这里必须排除 js/ 与 css/ —— 图片目录里混着的 js/css 会被打进 assets.zip，
 *   而 assets.zip 先装、code.zip 后装，原生侧是「整目录替换」：
 *   后装的 code.zip 会把先前解压出来的 js/*.js、css/*.css 一起覆盖掉（等于白装）。
 *   boot.js 是冻结文件，白装它更糟 —— 热更包里的这份会盖掉内置版。
 *   2026-09-20 修：原先 img/ 用了 .svg 扩展名白名单，图库里的 js/css 会漏进来。
 * 改用「只按扩展名白名单收」+ BANNED 二次过滤双保险，避免再一次踩同一种坑。 */
const IMG_EXT = [".webp", ".png", ".jpg", ".jpeg", ".svg"];
const MEDIA_EXT = [".mp3", ".m4a", ".ogg", ".woff2", ".woff", ".ttf"];
const BANNED_IN_ASSETS = /\.(js|css|html|htm)$/i;
const assetFiles = [
  ...walk(path.join(ROOT, "img"), IMG_EXT),
  ...walk(path.join(ROOT, "audio"), MEDIA_EXT),
  ...walk(path.join(ROOT, "font"), MEDIA_EXT),
  ...SUBJ_DIRS.flatMap((d) => [
    ...walk(path.join(ROOT, d, "img"), IMG_EXT),
    ...walk(path.join(ROOT, d, "audio"), MEDIA_EXT),
    ...walk(path.join(ROOT, d, "font"), MEDIA_EXT),
  ]),
].filter((f) => !BANNED_IN_ASSETS.test(path.relative(ROOT, f).split(path.sep).join("/")));

const codePaths = [...SRC_OF.keys()].sort();
const assetPaths = assetFiles.map(rel).sort();

if (!codePaths.length && !assetPaths.length) fail("没有任何可打包的文件");

/* ---------- 1.5 交叉校验：打了包的 js 必须都在 boot.js 的清单里 ----------
 * 这是三科迁移时最容易出的一类静默故障：往子目录里加了个 data-x7.js、
 * 忘了同步 boot.js 的 BUILTIN —— 资源包照样生成、照样装上、sha256 照样对得起，
 * 但那个文件永远不会被注入，表现为「我改的东西怎么没生效」。
 * 这里直接把 boot.js 里所有清单展开，逐个对照，少登记一个就报警。 */
const declared = MANIFEST.allDeclared();
/* 老 APK 兼容层的目标路径不在新版 boot.js 的清单里（那是老布局用的）——豁免，别刷警告 */
for (const [, dst] of LEGACY_MAP) declared.add(dst);
const undeclared = codePaths.filter((p) => /\.js$/.test(p) && !declared.has(p));
if (undeclared.length) {
  console.warn("⚠️  以下文件进了资源包、但不在 boot.js 的任何清单里，上线后不会被加载：");
  undeclared.forEach((p) => console.warn("      " + p));
  console.warn("      → 把它加进 js/boot.js 的 BUILTIN_* / HOST_JS 再打包");
}
const missing = [...declared].filter((p) => !codePaths.includes(p));
if (missing.length) {
  console.warn("⚠️  boot.js 清单里有、但这次没打进包（文件被删了？）—— 内置降级时会 404：");
  missing.forEach((p) => console.warn("      " + p));
}

/* ---------- 2. 扫描玩法（各科 js/game-*.js 里 registerGame 的 id） ----------
 * ★ 匹配必须用路径中间的形式：三科各有自己的 games.js 和 game-*.js，
 *   老写法 /^js\/game-/ 在三合一后一个都匹配不上 —— 新玩法会静默消失，
 *   MANIFEST 里的 games 数组永远是空的。 */
const games = [];
const legacyDst = new Set(LEGACY_MAP.map(([, dst]) => dst));
for (const p of codePaths) {
  if (legacyDst.has(p)) continue;              // 兼容层是空壳，别去扫玩法 id 制造噪音
  if (!/\/js\/game-.+\.js$/.test(p)) continue;
  const src = fs.readFileSync(path.join(ROOT, SRC_OF.get(p) || p), "utf8");
  const ids = [...src.matchAll(/registerGame\(\s*\{[^}]*?id\s*:\s*["']([^"']+)["']/g)]
    .map((m) => m[1]);
  if (ids.length) games.push({ id: ids[0], file: p });
  else console.warn("⚠️  " + p + " 里没找到 registerGame({id:…})，跳过（首页不会出现入口）");
}

/* ---------- 3. 生成 MANIFEST.json（打进 code.zip，与文件原子同源） ---------- */
const entries = [];
for (const p of [...codePaths, ...assetPaths]) {
  const abs = path.join(ROOT, SRC_OF.get(p) || p);
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
  fs.copyFileSync(path.join(ROOT, SRC_OF.get(p) || p), dst);
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
/* -X 去掉扩展属性；MANIFEST.json 必须在里面。
   三个学科子目录也要显式列出来 —— zip -r 只认命令行上给的目录。 */
const zipArgs = ["-q", "-X", "-r", codeZip, "MANIFEST.json"];
for (const d of ["css", "js", ...SUBJ_DIRS]) {
  if (fs.existsSync(path.join(TMP, d))) zipArgs.push(d);
}
execFileSync("zip", zipArgs, { cwd: TMP });
/* code.zip 里不该出现 boot.js（冻结文件），兜底删掉 —— 宿主层和各学科目录都要查一遍 */
for (const d of ["js/boot.js", ...SUBJ_DIRS.map((s) => s + "/js/boot.js")]) {
  try { execFileSync("zip", ["-q", "-d", codeZip, d], { cwd: TMP }); } catch (e) {}
}
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
