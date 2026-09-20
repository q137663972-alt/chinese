#!/usr/bin/env node
/* ===================== tools/check-tv-layout.mjs · 电视布局红线检查 =====================
 * 用法：node tools/check-tv-layout.mjs
 *
 * 【为什么需要这个脚本】
 *   2026-09-20 现场事故：1080p 机顶盒上首页两侧各有一道竖直"接缝"、整页被压扁。
 *   根因不是某一处写错，而是**同一件事有三处各写各的**：
 *     · css/shell.css      #app{max-width:520px}          ← 手机竖屏容器
 *     · cn/css/style.css   body.tv #app{max-width:calc(1000px * var(--s,1))}
 *     · math/ en/          #app{max-width:520px}，靠 (orientation: landscape) 才放宽
 *   机顶盒是横屏 → 三科各走各的分支；而语文那条把 CSS 宽度乘了 --s（1.5），
 *   算出来 1500px，而 1080p 的 CSS 视口只有 960px —— 容器比视口宽 56%，
 *   居中后左右溢出被裁，就成了那两道竖缝。
 *
 *   这类事故靠人眼看代码看不出来（三处分开看每处都"合理"），
 *   只能靠一条机械规则卡住。于是有了这个脚本。
 *
 * ★ 负向纪律：本脚本的每一条断言都验证过"把规则改坏 → 必然报红"。
 * ================================================================================== */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAILS = [];

function chk(cond, label, detail) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label + (detail ? "   " + detail : ""));
  if (!cond) FAILS.push(label + (detail ? " — " + detail : ""));
}

/* 去掉注释，免得注释里引用的历史写法被当成真规则。
   ★ 必须先剥注释再扫规则 —— 本仓库的注释里特意保留了"以前是 xxx"的说明，
     不剥掉就会把自己写的说明判成违规。 */
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/* 把 css 拆成 [选择器, 声明体] 列表（不处理 @media 嵌套，够用即可） */
function rules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css))) out.push([m[1].trim(), m[2].trim()]);
  return out;
}

function read(rel) {
  const p = path.join(ROOT, rel);
  if (!fs.existsSync(p)) return null;
  return stripComments(fs.readFileSync(p, "utf8"));
}

console.log("══════════ 电视布局红线检查 ══════════");

/* ---------- ① #app 的 max-width 只能有一个真源 ----------
   电视下的宽度必须由 css/tv.css 的 body.tv #app 独家决定。
   学科样式里再写一遍，就会"谁最后加载谁赢"，而三科的加载时机/断点各不相同。 */
console.log("\n──── ① #app 宽度的唯一真源 ────");
{
  const tv = read("css/tv.css");
  if (!tv) chk(false, "css/tv.css 存在");
  else {
    const hit = rules(tv).filter(([sel]) => /^body\.tv\s+#app$/.test(sel.replace(/\s+/g, " ")));
    const noneWidth = hit.some(([, body]) => /max-width\s*:\s*none/.test(body));
    chk(hit.length > 0, "css/tv.css 里有 body.tv #app 规则");
    chk(noneWidth, "css/tv.css 的 body.tv #app 声明了 max-width: none");
  }
}

/* ---------- ② 容器宽度不许乘 --s ----------
   --s 是给字号 / 间距 / 控件固定尺寸用的缩放系数（1.25~2.2），
   按钮宽 52px×1.5=78px 完全正确。
   危险的是**决定整页宽度的那条**：#app / 栅格列宽。
   1080p 的 CSS 视口只有 960px，把它乘 1.5 必然溢出 → 左右被裁出竖缝。
   ★ 第一版断言把「所有 width」都拦了，结果把 topbar 按钮的正当缩放也判成违规 ——
     断言太粗 = 假警报 = 迟早被无视。这里只盯容器与栅格。 */
console.log("\n──── ② 容器宽度不许乘 --s ────");
{
  const files = ["css/tv.css", "css/shell.css", "cn/css/style.css", "math/css/style.css", "en/css/style.css"];
  const bad = [];
  for (const f of files) {
    const css = read(f);
    if (!css) continue;
    for (const [sel, body] of rules(css)) {
      const s = sel.replace(/\s+/g, " ").trim();
      /* 只关心「容器本体」与「栅格列宽」；按钮/图标/滑块这些按 --s 缩放是对的 */
      const isContainer = /(^|[\s,>])#app$/.test(s) || /^(body\.tv\s+)?#app$/.test(s);
      const isGrid = /grid-template-columns|grid-auto-columns/.test(body) && /var\(\s*--s/.test(body);
      if (!isContainer && !isGrid) continue;
      for (const decl of body.split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const val = decl.slice(i + 1).trim();
        const isWidthProp = /^(max-|min-)?width$/.test(prop) || /^grid-template-columns$/.test(prop);
        if (isWidthProp && /var\(\s*--s/.test(val)) bad.push(f + " · " + s + " { " + prop + ": " + val + " }");
      }
    }
  }
  chk(bad.length === 0, "容器 / 栅格宽度都没有乘 --s", bad.slice(0, 3).join("  |  "));
}

/* ---------- ③ 学科样式里不许出现 body.tv #app ----------
   三科各写一套正是事故成因。要改就统一改 css/tv.css。 */
console.log("\n──── ③ 学科样式不越权管容器 ────");
{
  const bad = [];
  for (const f of ["cn/css/style.css", "math/css/style.css", "en/css/style.css"]) {
    const css = read(f);
    if (!css) continue;
    for (const [sel] of rules(css)) {
      if (/^body\.tv\s+#app$/.test(sel.replace(/\s+/g, " "))) bad.push(f + " · " + sel);
    }
  }
  chk(bad.length === 0, "三科样式都没有 body.tv #app 规则", bad.join("  |  "));
}

/* ---------- ④ 电视下 #app 必须能滚 ----------
   整页 overflow:hidden（tv.css 的 body.tv），滚动必须由 #app 承担；
   #app 要是也 hidden，内容一多底部按钮就永远够不到。 */
console.log("\n──── ④ 电视下 #app 可滚动 ────");
{
  const tv = read("css/tv.css") || "";
  const body = rules(tv)
    .filter(([sel]) => /^body\.tv\s+#app$/.test(sel.replace(/\s+/g, " ")))
    .map(([, b]) => b)
    .join(";");
  chk(/overflow-y\s*:\s*auto/.test(body), "body.tv #app 有 overflow-y: auto");
  chk(/overflow-x\s*:\s*hidden/.test(body), "body.tv #app 有 overflow-x: hidden");
}

/* ---------- ⑤ 电视样式不许用老 WebView 不认的函数 ----------
   安卓 8 机顶盒的系统 WebView 多为 Chrome 6x：
   clamp() / min() / max() / aspect-ratio / inset:0 / env() 会**整条声明被丢弃**。
   ★ 本仓库的兜底是「两段式、跨规则」的：
        #app{padding:14px 14px 28px}                    ← 固定值兜底（另一条规则）
        #app{padding:calc(14px + env(safe-area-inset-*))} ← 精细值，丢了还有上面那条
     所以不能要求「同一条规则里必须有兜底」—— 那是假警报（第一版就这么误报了）。
     这里改判：同一个属性在整个文件里，必须存在至少一条不含红线函数的写法。
     只查 css/tv.css 与 css/shell.css：这两份是电视必加载的。
     学科样式里的 clamp() 都在 @media (min-width:…) 内、只服务桌面预览，
     不进入老盒子的渲染路径，不在此列。
   ★ 只看 @media 之外的顶层规则 —— 电视上真正生效的断点只有 tv.css 里的固定值。 */
console.log("\n──── ⑤ 不碰老 WebView 红线写法 ────");
{
  const RED = [
    [/\bclamp\s*\(/, "clamp()"],
    [/(?:^|[^-\w])min\s*\(/, "min()"],
    [/(?:^|[^-\w])max\s*\(/, "max()"],
    [/aspect-ratio\s*:/, "aspect-ratio"],
    [/(?:^|[;\s])inset\s*:/, "inset:"],
    [/env\s*\(\s*safe-area/, "env(safe-area-*)"],
  ];
  const hasRed = (v) => RED.some(([re]) => re.test(v));

  const bad = [];
  for (const f of ["css/tv.css", "css/shell.css"]) {
    const css = read(f);
    if (!css) continue;
    /* 顶层（非 @media 内）的规则：@media 块在本仓库里格式规整，这里用深度扫描取出。
       ★ 必须连「选择器 + 声明体」整段一起存。踩过一次：只存了选择器，
         导致 rules() 在去掉花括号的文本上一条也匹配不到 ——
         于是「无兜底的 clamp」这一条静默通过了（负向测试抓出来的假绿）。 */
    const top = [];
    let depth = 0, buf = "", inMedia = false;
    for (let i = 0; i < css.length; i++) {
      const c = css[i];
      if (c === "{") {
        depth++;
        if (depth === 1) {
          if (/@media/.test(buf)) { inMedia = true; buf = ""; continue; }
          buf += c;                                  // 保留 {，否则 rules() 匹配不到
          continue;
        }
      }
      if (c === "}") {
        depth--;
        if (depth === 0) {
          if (inMedia) { inMedia = false; buf = ""; continue; }
          buf += c;                                  // 保留 }，规则才闭合、rules() 才匹配得到
          if (buf.trim()) top.push(buf);
          buf = "";
          continue;
        }
      }
      buf += c;
    }
    const topCss = top.join("\n");

    /* ★ 关键：兜底必须来自「同一条选择器」。
       第一版按「同属性在整文件里有没有无红线写法」判，结果 body.tv .zz{width:clamp(…)}
       被 topbar 的 width:52px 顶掉了 —— 假通过，比不检查更危险（负向测试抓出来的）。
       正确判据：同一个选择器下、同一个属性，另有一条不含红线函数的声明。
       这正是本仓库「两段式兜底」的真实形态：
         #app{padding:14px 14px 28px}  →  #app{padding:calc(14px + env(…))}
       两条挨在一起、选择器完全相同。 */
    const plainBySel = {};
    for (const [sel, body] of rules(topCss)) {
      const key = sel.replace(/\s+/g, " ").trim();
      plainBySel[key] = plainBySel[key] || {};
      for (const decl of body.split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const val = decl.slice(i + 1).trim();
        if (!hasRed(val)) plainBySel[key][prop] = true;
      }
    }
    for (const [sel, body] of rules(topCss)) {
      const key = sel.replace(/\s+/g, " ").trim();
      for (const decl of body.split(";")) {
        const i = decl.indexOf(":");
        if (i < 0) continue;
        const prop = decl.slice(0, i).trim().toLowerCase();
        const val = decl.slice(i + 1).trim();
        if (!hasRed(val)) continue;
        if (plainBySel[key] && plainBySel[key][prop]) continue;   // 同一选择器有固定值兜底，OK
        const name = RED.find(([re]) => re.test(val))[1];
        bad.push(f + " · " + key + " { " + prop + ": " + val + " }（" + name + " 且同一选择器无固定值兜底）");
      }
    }
  }
  chk(bad.length === 0, "红线写法均有固定值兜底", bad.slice(0, 3).join("  |  "));
}

/* ---------- ⑥ 分辨率分档不许双重乘 dpr ----------
   这是"整体偏大"的真主因，比容器宽度那一条更隐蔽：
     var vw = innerWidth * dpr;              ← 已经是物理像素
     var w = max(vw, screen.width * dpr);    ← screen.width 本来就是物理像素，又乘一次
   1080p 电视：vw=1920（对），w=max(1920, 3840)=3840 → 命中 4K 档 s=2.2（本该 1.5）。
   整个 UI 大了 47%，看起来就是"比例失调、撑爆屏幕"。
   ★ 断言方式：applyScale 里 screen.width / screen.height 的取值不得再乘 dpr。
     用真实文件内容做正则检查 —— 这类"纯算术写错"没法靠 jsdom 测出来（它不做布局）。 */
console.log("\n──── ⑥ 分辨率分档不双重乘 dpr ────");
{
  const p = path.join(ROOT, "js/tv.js");
  const src = fs.readFileSync(p, "utf8");
  /* 只取 applyScale 函数体，避免误伤文件里别处的 dpr 用法 */
  const m = src.match(/function applyScale\(\)\s*\{[\s\S]*?\n  \}/);
  const body = m ? m[0] : "";
  chk(!!body, "找得到 applyScale() 函数体");
  if (body) {
    /* screen.width / screen.height 后面紧跟 * dpr 就是双重乘 */
    const bad = [];
    const re = /screen\s*\.\s*(width|height)\s*\)?\s*\|\|\s*0\s*\)?\s*\*\s*dpr/g;
    let mm;
    while ((mm = re.exec(body))) bad.push("screen." + mm[1] + " … * dpr");
    chk(bad.length === 0, "screen.width/height 没有再乘 dpr（量纲与 vw/vh 一致）", bad.join("  |  "));
    /* 同时确认 innerWidth/innerHeight 确实乘了 dpr —— 那一个是必须乘的 */
    chk(/innerWidth[\s\S]{0,40}\*\s*dpr/.test(body), "innerWidth 仍乘 dpr（还原物理分辨率）");
  }
}

console.log("\n" + (FAILS.length ? "❌ 失败 " + FAILS.length + " 项" : "✅ 全部通过"));
if (FAILS.length) { FAILS.forEach((f) => console.log("   · " + f)); process.exit(1); }
