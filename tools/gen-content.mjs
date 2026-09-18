#!/usr/bin/env node
/* ===================== 内容包生成器（Content Pack Generator） =====================
 * 零依赖，Node 18+。把项目 js/ 下的全量数据切成可热更新的分片 + manifest。
 *
 *   node tools/gen-content.mjs --out content
 *
 * 产物（发布到 https://<user>.github.io/<repo>/content/）：
 *   manifest.js                 固定名，唯一入口
 *   <id>-<hash>.js              分片；id 见下，hash = sha256(规范化JSON).slice(0,10)
 *
 * 分片 id：
 *   语文  g1-d..g6-d  年级生字   g1-s..g6-s 笔顺子集   g1-p..g6-p 插图子集
 *         x-poem      古诗       x-word    成语/近反义/量词/分类/卡片
 *   数学  all         整包（年级 + SHAPES/SHAPE_SVG/SHAPE_PIC/UNITS/APPQ）
 *   英语  all         整包（年级）
 *
 * 分片正文只有一行，形如：
 *   window.CP.apply("<id>","<hash>",<payload>);window.CP.ok("<id>","<hash>");
 * 语法错 / 数据校验失败 → apply 抛错 → ok 不执行 → 哨兵缺失 → 加载器判为坏包丢弃。
 *
 * 硬约束：内容包只允许改字/拼音/笔画/组词/插图/题库，
 *         不允许增删册或单元（星星进度以 uKey(gi,bi,ui) 为索引，增删会错位）。
 * =========================================================================== */

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const opt = (name, def) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : true) : def;
};
const OUT  = String(opt("out", "content"));
const ROOT = String(opt("root", path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")));
const JSDIR = path.join(ROOT, "js");

/* ---------------- 规范化 & 哈希 ----------------
   对象键按字典序递归排序，保证「同数据必同 hash」，未改动的分片不会被重下。 */
function canon(v) {
  if (Array.isArray(v)) return v.map(canon);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = canon(v[k]);
    return o;
  }
  return v;
}
const sha = (s) => crypto.createHash("sha256").update(s, "utf8").digest("hex");
/* JSON.stringify 不转义 U+2028/2029，直接内联进 <script> 在老 WebView 上会断行 */
const safe = (s) => s.replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

/* ---------------- 在沙箱里执行项目的数据文件 ---------------- */
function loadProject(files) {
  const sb = { console };
  sb.window = sb; sb.globalThis = sb; sb.self = sb;
  vm.createContext(sb);
  for (const f of files) {
    const p = path.join(JSDIR, f);
    vm.runInContext(fs.readFileSync(p, "utf8"), sb, { filename: f });
  }
  return sb;
}

/* ---------------- 项目识别 ---------------- */
const has = (f) => fs.existsSync(path.join(JSDIR, f));
let PROJ;
if (has("strokes.js") && has("data-c1.js"))      PROJ = "chinese";
else if (has("data-m1.js"))                      PROJ = "math";
else if (has("data-g1.js"))                      PROJ = "english";
else { console.error("无法识别项目类型（js/ 下找不到 data-c1 / data-m1 / data-g1）"); process.exit(1); }

const DATA_FILES = {
  chinese: ["cp.js", "data-c1.js", "data-c2.js", "data-c3.js", "data-c4.js", "data-c5.js", "data-c6.js",
            "strokes.js", "pics.js", "data-poem.js", "data-word.js"],
  math:    ["cp.js", "data-m1.js", "data-m2.js", "data-m3.js", "data-m4.js", "data-m5.js", "data-m6.js",
            "data-extra.js"],
  english: ["cp.js", "data-g1.js", "data-g2.js", "data-g3.js", "data-g4.js", "data-g5.js", "data-g6.js"],
}[PROJ];

const W = loadProject(DATA_FILES);
const GRADES = (W.CP && W.CP.list ? W.CP.list() : W.GRADES || [])
  .slice().sort((a, b) => a.g - b.g);

if (GRADES.length !== 6) { console.error("年级数应为 6，实际 " + GRADES.length); process.exit(1); }

/* ---------------- 输出目录 ---------------- */
const outDir = path.isAbsolute(OUT) ? OUT : path.join(ROOT, OUT);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const shards = [];
function emit(id, payload) {
  const json = safe(JSON.stringify(canon(payload)));
  const h10  = sha(json).slice(0, 10);
  const file = `${id}-${h10}.js`;
  const text = `/* 内容包分片 ${id} · hash ${h10} */\n`
             + `window.CP.apply(${JSON.stringify(id)},${JSON.stringify(h10)},${json});`
             + `window.CP.ok(${JSON.stringify(id)},${JSON.stringify(h10)});\n`;
  fs.writeFileSync(path.join(outDir, file), text);
  shards.push({ id, k: payload.t, h: h10, f: file, size: Buffer.byteLength(text) });
  return h10;
}

/* ---------------- 年级结构（单元数不变约束用） ---------------- */
const shape = {};
GRADES.forEach(g => {
  shape[g.g] = { b: g.books.length, u: g.books.map(b => b.u.length) };
});

/* 年级内出现的字（去重） */
function charsOf(g) {
  const s = new Set();
  g.books.forEach(b => b.u.forEach(u => (u.w || []).forEach(w => {
    const z = (w && typeof w === "object") ? w.z : w;
    if (z) s.add(z);
  })));
  return Array.from(s).sort();
}
function pick(map, chars) {
  const m = {};
  chars.forEach(z => { if (map && map[z] !== undefined) m[z] = map[z]; });
  return m;
}

/* ---------------- 按项目生成 ---------------- */
if (PROJ === "chinese") {
  const STROKES = W.STROKES || {}, PICS = W.PICS || {};

  // 断言：字集规模与覆盖率
  let total = 0; const set = new Set(); const dup = new Map();
  GRADES.forEach(g => g.books.forEach(b => b.u.forEach(u => (u.w || []).forEach(w => {
    const z = (w && typeof w === "object") ? w.z : w;
    if (!z) return;
    total++;
    if (set.has(z)) dup.set(z, (dup.get(z) || 1) + 1); else set.add(z);
  }))));
  const missingS = Array.from(set).filter(z => STROKES[z] === undefined);
  const missingP = Array.from(set).filter(z => PICS[z] === undefined);
  console.log(`语文字集：记录 ${total} 条 · 唯一 ${set.size} 字 · 重复 ${dup.size} 字`
            + (dup.size ? `（${Array.from(dup.keys()).join("")}）` : ""));
  console.log(`          笔顺覆盖 ${set.size - missingS.length}/${set.size} · 插图覆盖 ${set.size - missingP.length}/${set.size}`);
  if (set.size !== 567 || total !== 576) { console.error("✗ 字集规模与预期不符（应 576 条 / 567 字）"); process.exit(1); }
  if (missingS.length || missingP.length) {
    console.error("✗ 有字缺笔顺或插图：" + missingS.concat(missingP).slice(0, 10).join(""));
    process.exit(1);
  }

  GRADES.forEach(g => {
    const chars = charsOf(g);
    emit(`g${g.g}-d`, { t: "d", g: g.g, grade: g });
    emit(`g${g.g}-s`, { t: "s", g: g.g, m: pick(STROKES, chars) });
    emit(`g${g.g}-p`, { t: "p", g: g.g, m: pick(PICS, chars) });
  });
  const wordExtras = {
    idioms: W.IDIOMS || [], nearfar: W.NEARFAR || [], liangci: W.LIANGCI || [],
    clazz: W.CLAZZ || [], picCards: W.PIC_CARDS || []
  };
  // 断言：任何一个为空都说明变量名写错或数据文件没加载 —— 静默丢数据不可接受
  const emptyWord = Object.keys(wordExtras).filter(k => !wordExtras[k].length);
  if (emptyWord.length || !(W.POEMS || []).length) {
    console.error("✗ 词语/古诗数据为空：" + emptyWord.concat((W.POEMS || []).length ? [] : ["poems"]).join(","));
    process.exit(1);
  }
  emit("x-poem", { t: "poem", g: 0, poems: W.POEMS || [] });
  emit("x-word", Object.assign({ t: "word", g: 0 }, wordExtras));
} else {
  const extra = {};
  if (PROJ === "math") {
    ["SHAPES", "SHAPE_SVG", "SHAPE_PIC", "UNITS", "APPQ"].forEach(k => {
      if (W[k] !== undefined) extra[k] = W[k];
    });
    const emptyEx = ["SHAPES", "SHAPE_SVG", "SHAPE_PIC", "UNITS", "APPQ"]
      .filter(k => !(extra[k] && (extra[k].length || Object.keys(extra[k]).length)));
    if (emptyEx.length) {
      console.error("✗ 数学附加数据为空：" + emptyEx.join(",")); process.exit(1);
    }
  }
  emit("all", { t: "all", g: 0, grades: GRADES, extra });
}

/* ---------------- manifest ---------------- */
const build = sha(shards.map(s => s.id + ":" + s.h).join("|")).slice(0, 10);
const manifest = { t: "manifest", v: 1, proj: PROJ, build, shape, shards };
const mtext = `/* 内容包 manifest · build ${build} */\n`
            + `window.CONTENT_MANIFEST=${safe(JSON.stringify(canon(manifest)))};`
            + `window.CP.ok("manifest",${JSON.stringify(build)});\n`;
fs.writeFileSync(path.join(outDir, "manifest.js"), mtext);

/* ---------------- 报告 ---------------- */
const kb = (n) => (n / 1024).toFixed(1).padStart(7) + " KB";
console.log(`\n项目 ${PROJ} → ${path.relative(ROOT, outDir) || outDir}`);
console.log("分片清单：");
shards.forEach(s => console.log(`  ${s.id.padEnd(8)} ${s.k.padEnd(5)} ${kb(s.size)}  ${s.h}  ${s.f}`));
console.log(`  manifest         ${kb(Buffer.byteLength(mtext))}  ${build}  manifest.js`);
console.log(`合计 ${shards.length + 1} 个文件，${kb(shards.reduce((a, s) => a + s.size, 0) + Buffer.byteLength(mtext))}`);
console.log(`年级结构（册数/各册单元数）：${Object.keys(shape).map(g => `${g}年级 ${shape[g].b}册[${shape[g].u.join(",")}]`).join(" · ")}`);
