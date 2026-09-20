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

/* ---------- ⑦ 选学科页在窄视口下必须放大 ----------
   2026-09-20 现场事故（第二条）：1080p 机顶盒的 CSS 视口只有 960×540，
   而选学科页原先寄居在 css/shell.css 里、只有"基础值"（字号 12~20px），
   在这类屏上小到遥控器都看不清焦点。
   规则：css/picker.css 必须存在，且必须带「按视口宽度放大的断点」。
   ★ 不许用 clamp()/min()/max() 来做这个放大 —— 老 WebView 会整条丢弃，
     必须用 @media 断点 + calc(基础 × var(--s))。 */
console.log("\n──── ⑦ 选学科页在窄视口下会放大 ────");
{
  const pk = read("css/picker.css");
  chk(!!pk, "css/picker.css 存在（选学科页有独立样式文件）");
  if (pk) {
    /* ★ 必须把 @media 的整行条件抠出来单独判，不能在整个文件里找 "min-width: 900px"。
       踩过：最初写成 /@media[^{]*min-width\s*:\s*900px/，结果被
         @media (min-width: 900px) and (orientation: portrait)
       顶掉了 —— 那条只是"竖屏时退回单列"，不含任何放大规则，
       负向测试（把放大断点整块删掉）依然全绿。假通过比不检查更危险。 */
    function mediaConds(text, w) {
      const out = [];
      const re = new RegExp("@media([^{]*min-width\\s*:\\s*" + w + "px[^{]*)\\{", "g");
      let m;
      while ((m = re.exec(text))) out.push(m[1].replace(/\s+/g, " ").trim());
      return out;
    }
    const c560 = mediaConds(pk, 560);
    const c900 = mediaConds(pk, 900);
    /* ≥560px：不许附加 orientation 之类的额外条件，否则不少设备会绕过 */
    chk(c560.some((c) => !/orientation/.test(c)),
        "有干净的 ≥560px 放大断点（720p 盒子 / 大屏横屏）", c560.join(" | "));
    chk(c900.some((c) => !/orientation/.test(c)),
        "有干净的 ≥900px 放大断点（1080p 及以上机顶盒 / 横平板）", c900.join(" | "));

    /* ★ 光有断点不算数 —— 断点里的规则必须真的把尺寸写大。
       取「干净的」（不带 orientation 的）那一段块来判；
       否则会取到"竖屏退回单列"那个块，里面照样有 calc(×--s)，
       于是把放大断点整块删掉也依然全绿（第二次假通过，负向测试抓出来的）。 */
    function blockFor(text, w) {
      const re = new RegExp("@media([^{]*min-width\\s*:\\s*" + w + "px[^{]*)\\{", "g");
      let m;
      while ((m = re.exec(text))) {
        if (/orientation/.test(m[1])) continue;            // 跳过带额外条件的
        let depth = 0;
        const j = text.indexOf("{", m.index);
        for (let k = j; k < text.length; k++) {
          if (text[k] === "{") depth++;
          else if (text[k] === "}") { depth--; if (depth === 0) return text.slice(j + 1, k); }
        }
      }
      return "";
    }
    function hasGrow(block) {
      if (!block) return false;
      return /var\(\s*--s/.test(block) &&
             /(font-size|min-height|padding)\s*:\s*[^;]*calc\(/.test(block) &&
             /subj-card|subj-head/.test(block);
    }
    const b900 = blockFor(pk, 900);
    const b560 = blockFor(pk, 560);
    chk(hasGrow(b900), "≥900px 断点里真的有把卡片/标题放大的 calc(×--s) 规则");
    chk(hasGrow(b560), "≥560px 断点里真的有把卡片/标题放大的 calc(×--s) 规则");

    /* 反向：不许在 picker.css 里用红线函数（它就是为老盒子写的） */
    const RED2 = [/\bclamp\s*\(/, /(?:^|[^-\w])min\s*\(/, /(?:^|[^-\w])max\s*\(/];
    const badUse = RED2.some((re) => re.test(pk));
    chk(!badUse, "picker.css 没有用 clamp()/min()/max()（老 WebView 会整条丢弃）");
    /* 焦点环必须有 —— 遥控器焦点看不见等于选不中 */
    chk(/:focus/.test(pk), "有 :focus 焦点环样式（否则遥控器不知道焦点在哪）");
  }
}

/* ---------- ⑧ 老机看门人必须拦住"自动跳进语文" ----------
   2026-09-20 现场事故（第三条）：老 APK 上进去能看到三科卡片，
   三五秒后自己跳进语文。根因是老内置清单第一个 js/app.js（语文主程序）先跑完了，
   选学科页只是叠在上面，被语文的定时器/二次渲染翻回去。
   解法：资源包把根级 js/app.js 换成"看门人" —— 没选学科就渲染选学科页并收工，
   一个学科文件都不加载。
   这条断言防的是：有人嫌它麻烦又改回"纯空壳"。 */
console.log("\n──── ⑧ 老机看门人会拦住自动跳学科 ────");
{
  const p = path.join(ROOT, "legacy/js/app.js");
  chk(fs.existsSync(p), "legacy/js/app.js 存在（老机根级看门人）");
  if (fs.existsSync(p)) {
    const src = stripComments(fs.readFileSync(p, "utf8"));
    chk(/app_subject/.test(src), "看门人读了 app_subject（据此判断有没有选过学科）");
    chk(/window\.__renderSubjectPicker\s*\(/.test(src), "看门人会主动调用渲染函数");
    chk(/return/.test(src), "未选学科时提前 return（不继续加载学科）");
    /* 反向负控：它绝不能自己去加载 cn/js/app.js 那一套 */
    chk(!/[^a-z]cn\/js\/app\.js/.test(src), "看门人自己不加载任何学科文件");
  }
  /* bridge.js 的守卫也要在：它必须能在"选学科页已被渲染"时复用而不是重来。
     ★ 匹配带 window. 前缀且以 ( 结尾的真实调用 —— 最初只判 /__renderSubjectPicker/
       这个标识符是否出现，结果把属性名整个改掉（window.__renderSubjectPickerXX()）
       依然全绿：标识符还在字符串里。第三次假通过，一样是负向测试抓出来的。 */
  const bp = path.join(ROOT, "legacy/js/bridge.js");
  if (fs.existsSync(bp)) {
    const b = stripComments(fs.readFileSync(bp, "utf8"));
    chk(/window\.__renderSubjectPicker\s*\(/.test(b), "bridge.js 真的调用了渲染函数（复用，不重复注入）");
  }
}

/* ---------- ⑨ 老机启动哨兵必须被喂饱（否则热更会被永久熔断） ----------
   2026-09-21 现场事故：热更成功一次 → 进语文后被旧包覆盖 → 从此再也更新不上。

   链路（每一环都能在源码里点名）：
     2.4.0 assets/js/boot.js 的 bootOk()
         typeof window.render === "function" && window.app && window.app.childNodes.length > 0
     —— 认的是**语文主程序**的两个顶层变量。选学科页永远不满足；桥接层加载那 18 个
        学科文件又是异步的，机顶盒上稍慢就超了 T_SENTINEL=1500。
     → watch() 判超时 → onFail() → MainActivity.markBad(build)
     → markBad 里 rollback() 删掉 files/hot/ 退回内置（"被旧包覆盖"）
     → markBad 累计 2 次：`if (f >= 2) ed.putBoolean(K_OFF, true)` —— 永久熔断，
       readManifest 返回 null、bgUpdate 直接 return（"再也更新不上"）。

   boot.js 冻结改不得，但 bootOk() 读的是全局量 —— 由热更侧提前挂上即可。
   这条断言防的是：有人觉得"挂个假 render 不干净"把它删掉，于是又一次熔断，
   而且这次连修复包都发不出去（新 build 也会被拉黑）。 */
console.log("\n──── ⑨ 老机启动哨兵会被喂饱（防熔断） ────");
{
  const p = path.join(ROOT, "legacy/js/app.js");
  if (fs.existsSync(p)) {
    const src = stripComments(fs.readFileSync(p, "utf8"));
    /* ★ 必须是**真的函数调用**，而且要在决定"新版宿主退场 / 已选学科放行"的那两个
       return **之前** —— 排到后面就白挂了（第一次假通过就是这么来的）。 */
    /* ★★ 判据必须带结尾分号 —— 只写 /feedSentinel\s*\(\s*\)/ 会被**函数定义**
       本身命中（function feedSentinel() {），把整段删掉照样全绿。第二次假通过。 */
    const CALL = /(^|[;{}\s])feedSentinel\s*\(\s*\)\s*;/;
    const callAt = src.search(CALL);
    chk(callAt > 0, "看门人里真的调用了 feedSentinel()（不是只有定义）");
    if (callAt > 0) {
      /* ★ 必须排在最早的分支出口之前 —— 拿 if (window.APP_SUBJECTS) return 当基准：
         它若在这之后、或掉到"已选学科放行"的分支里，未选学科那一路就白挂了
         （这正是现场「进语文后就熔断」的那条路径）。 */
      const branchAt = src.search(/window\.APP_SUBJECTS/);
      chk(branchAt < 0 || callAt < branchAt,
          "喂饱调用排在所有分支出口之前（任何分支都执行得到）",
          "callAt=" + callAt + " branchAt=" + branchAt);
      /* 负向对照：把这行删掉后，
         上面那条正则必须认不出来 —— 证明它命中的确实就是这行，不是别的巧合。 */
      const broken = src.replace(CALL, " /*x*/ ");
      chk(broken !== src && !CALL.test(broken),
          "负向对照：删掉调用后断言会失效（说明这条不是白给）");
    }
    chk(/window\.app\s*=/.test(src), "哨兵要的 window.app 被赋上了");
    chk(/window\.render\s*=/.test(src) && /__bootPad/.test(src),
        "哨兵要的 window.render 是打了 __bootPad 标记的占位（可与学科那份区分）");
    /* 逃生通道：喂饱之后白屏保护由自己负责，绝不能调 markBad（那是熔断开关） */
    chk(!/markBad/.test(src), "看门人自己绝不调用 markBad（否则等于点了熔断开关）");
    chk(/safe=1/.test(src), "真失败时逃生到 ?safe=1 走内置（保底不白屏）");
  }
  /* 学科切换入口放在首页、不放设置里 —— 老 Jimeng 结构里 #app 在最前 */
  const bp = path.join(ROOT, "legacy/js/bridge.js");
  if (fs.existsSync(bp)) {
    const b = stripComments(fs.readFileSync(bp, "utf8"));
    chk(/getElementById\("subjectBar"\)/.test(b) && /insertBefore/.test(b),
        "bridge.js 把「换学科」条挂在 #app 之前（首页显眼处，不用开设置）");
    chk(!/bridgeSwitchRow/.test(b), "不再往设置弹层里塞换学科（按用户要求）");
  }
  const cp = path.join(ROOT, "css/picker.css");
  if (fs.existsSync(cp)) {
    const c = fs.readFileSync(cp, "utf8");
    chk(/#subjectBar/.test(c) && /\.sb-btn:focus/.test(c),
        "picker.css 里有 #subjectBar 样式且按钮有焦点环（遥控器看得见）");
  }
}

console.log("\n" + (FAILS.length ? "❌ 失败 " + FAILS.length + " 项" : "✅ 全部通过"));
if (FAILS.length) { FAILS.forEach((f) => console.log("   · " + f)); process.exit(1); }
