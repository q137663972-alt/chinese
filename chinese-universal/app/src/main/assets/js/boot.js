/* ===================== js/boot.js · 通用热更引导器（v4.0 · 三合一） =====================
 * 【冻结文件】本文件在 APK 里，永不参与热更 —— 改它必须出新 APK。
 *
 * 架构（v3.0 起，内容不再受格式和体积限制）：
 *   第 1 层 内置 assets      ← APK 里的完整可玩版本，永远可用（无网也不白屏）
 *   第 2 层 files/hot/       ← 上次后台装好的资源包（任意格式：js/css/图片/音频/字体）
 *   第 3 层 远程 hot/pack/   ← GitHub Pages 上的最新资源包（zip）
 *
 * 与旧版最大的不同：内容不再塞 localStorage（配额只有 5MB），而是由原生桥
 * AndroidHot 把 zip 落到 files/hot/，再用虚拟域 https://local.hot/ 读取。
 * 于是图片、音频、字体、新增玩法的 js 全都能热更，想多大就多大。
 *
 * ----------------------------------------------------------------------------
 * v4.0：一个 APK 装三科（语文 / 数学 / 英语）
 * ----------------------------------------------------------------------------
 * 三科的 js 是从三个独立项目搬来的，全都没有 IIFE 包裹，顶层变量大面积同名：
 *   MODES / state / render / $ / speak / GAMES / GRADES / DATA / app / toast …
 * 同一页面里注入两科 = 后者把前者的 state/render 整个覆盖掉，
 * 而前者残留的 setInterval 还在跑 —— 表现就是"退出玩法自动跳回去"这类鬼故事。
 *
 * 所以定为：**一次只加载一科**，切换 = 写标记 + location.reload()。
 * 一次 reload 约 200ms，用户感知不到；比给三套代码做 IIFE 重构的风险低两个数量级。
 *
 * 目录约定（改动会被写进这里的 BUILTIN，别手滑）：
 *   js/boot.js          宿主自己（冻结）
 *   js/subject.js       选学科页（可热更）
 *   css/shell.css       壳样式（可热更）
 *   css/tv.css          电视样式，三科共用一份（可热更）
 *   cn/   math/   en/   三科各自的子目录，互不干涉
 *
 * 铁律不变：
 *   · **启动路径零网络** —— 启动时只读本地（内置或已装好的资源包），
 *     网络只发生在启动成功 3 秒后的后台更新里。
 *   · **绝不白屏** —— 1.5s 哨兵没渲染出内容就判失败：标记坏包 → 回滚 → 重载。
 *     熔断状态存在原生 SharedPreferences 里，热更的 js 再怎么坏也毁不掉逃生通道。
 *
 * 调试：index.html#hotlog 看启动日志（不用 adb、不用改 Java）
 * 逃生：index.html?safe=1 或 #nohot 强制走内置版本
 * 测试：index.html#hotbase=http://127.0.0.1:8899/hot/ 指定热更源
 *        index.html#subj=math 临时指定学科（优先级高于 localStorage）
 * ============================================================================ */
(function () {
  "use strict";

  /* ---------- 配置 ---------- */
  var APP       = "chinese";
  var HOT_BASE  = "https://q137663972-alt.github.io/chinese/hot/";   // github.io 兜底
  var HOT_BASE_ALT = "https://cdn.jsdelivr.net/gh/q137663972-alt/chinese@gh-pages/hot/"; // 大陆优先
  var HOT_BASES = [HOT_BASE_ALT, HOT_BASE];   // 顺序即优先级（jsdelivr 优先，github.io 兜底）
  var HOT_TOKEN = "chinese-2026";
  var CP_BASE = "https://q137663972-alt.github.io/chinese/content/";

  /* ------------------------------------------------------------------------
   * 三科注册表。
   * 这里只放"改了就得出新 APK"的事实：目录名 + 样式路径。
   * 学科名称、图标、顺序、简介这些随时可能改的东西一律不写在这儿 ——
   * 它们放在 js/subject.js（可热更），改一行一行就是一次热更，不用重新出包。
   *
   * 想加第 4 科：在这里加一项 + 把文件放进子目录 + 出新 APK。
   * 只有列出 SUBJS 的学科才会被注入 —— 目录里有文件没登记的，一律不加载。
   * ---------------------------------------------------------------------- */
  var SUBJS = {
    cn:   { key: "cn",   dir: "cn",   css: "cn/css/style.css"   },
    math: { key: "math", dir: "math", css: "math/css/style.css" },
    en:   { key: "en",   dir: "en",   css: "en/css/style.css"   }
  };
  var SUBJ_KEY_NAME = "app_subject";      // localStorage 键名，别改（改了老用户会回退到选学科页）

  /* 内置兜底清单：顺序即注入顺序。热更包里有的文件会顶掉同路径的内置文件，
     热更包里新增的文件（玩法 js）会插在本学科 games.js 之后。
     ★ 每一条都必须带学科前缀 —— 少了前缀就变成宿主层的 js/xxx.js，加载必然 404 →
       启动失败 → 回滚重载，表现为"装了新包就白屏"。 */
  var BUILTIN_CN = [
    "cn/js/cp.js",
    "cn/js/data-c1.js", "cn/js/data-c2.js", "cn/js/data-c3.js",
    "cn/js/data-c4.js", "cn/js/data-c5.js", "cn/js/data-c6.js",
    "cn/js/strokes.js",
    "cn/js/data-poem.js",
    "cn/js/data-word.js",
    "cn/js/tts.js",
    "cn/js/praise.js",
    "cn/js/pics.js",
    "cn/js/games.js",
    "cn/js/game-battle.js",
    "cn/js/app.js",
    "cn/js/update.js"
  ];
  var BUILTIN_MATH = [
    "math/js/cp.js",
    "math/js/data-m1.js", "math/js/data-m2.js", "math/js/data-m3.js",
    "math/js/data-m4.js", "math/js/data-m5.js", "math/js/data-m6.js",
    "math/js/data-extra.js",
    "math/js/gen.js",
    "math/js/tts.js",
    "math/js/praise.js",
    "math/js/games.js",
    "math/js/app.js",
    "math/js/update.js"
  ];
  var BUILTIN_EN = [
    "en/js/cp.js",
    "en/js/data-g1.js", "en/js/data-g2.js", "en/js/data-g3.js",
    "en/js/data-g4.js", "en/js/data-g5.js", "en/js/data-g6.js",
    "en/js/tts.js",
    "en/js/praise.js",
    "en/js/games.js",
    "en/js/app.js",
    "en/js/update.js"
  ];
  var BUILTIN = { cn: BUILTIN_CN, math: BUILTIN_MATH, en: BUILTIN_EN };

  /* 共享层：三科都要用、且内容完全相同的一组文件，放在学科自己的文件**之后**加载。
     为什么不在各科目录里各放一份：遥控器逻辑一旦三分叉，就会出现
     「语文修好了、数学还是坏的」这种鬼故事，而过几个月没人记得当初分了几份。
     为什么必须排最后：js/tv.js 启动时会包装 window.render ——
     那是各学科 app.js 的顶层变量，tv.js 得先看见它才包得住。
     ★ tv-tune.js 必须在 tv.js 之前：applyScale 要从 window.TV_TUNE 读调参表。 */
  var SHARED_JS = ["js/tv-tune.js", "js/tv.js"];

  /* 宿主层自己的可热更 js：选学科页用它，学科页用不到。 */
  var HOST_JS = ["js/subject.js"];

  var T_SENTINEL = 1500;              // 等启动哨兵
  var BG_DELAY   = 3000;              // 启动成功后多久开始后台更新

  /* ---------- 调试开关：#hotbase= / ?safe=1 / #nohot / #hotlog / #subj= ---------- */
  var HASH = String(location.hash || "");
  function hashArg(name) {
    var m = HASH.match(new RegExp("(?:^|[#&])" + name + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  /* 改/删 hash 参数时不能动其它开关（#tv / #hotlog / #hotbase=…）：
     把整个 hash 重写成 "subj=cn" 会把调试开关一起抹掉，浏览器里预览就再也出不来 TV 样式。 */
  function setHashArg(name, val) {
    var parts = HASH.replace(/^#/, "").split("&"), hit = false, out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (parts[i] === name || parts[i].indexOf(name + "=") === 0) { parts[i] = name + "=" + val; hit = true; }
      out.push(parts[i]);
    }
    if (!hit) out.push(name + "=" + val);
    return "#" + out.join("&");
  }
  function delHashArg(name) {
    var parts = HASH.replace(/^#/, "").split("&"), out = [];
    for (var i = 0; i < parts.length; i++) {
      if (!parts[i]) continue;
      if (parts[i] === name || parts[i].indexOf(name + "=") === 0) continue;
      out.push(parts[i]);
    }
    return out.length ? ("#" + out.join("&")) : "";
  }
  var hb = hashArg("hotbase");
  if (hb) HOT_BASES = [hb.replace(/([^/])$/, "$1/")];
  var SEARCH = String(location.search || "");
  var NO_HOT  = HASH.indexOf("nohot") >= 0 || /[?&]safe=1\b/.test(SEARCH);
  var HOT_LOG = HASH.indexOf("hotlog") >= 0;

  /* ---------- 本次加载哪一科 ----------
   * 优先 hash（调试用），其次 localStorage（用户上次选的）。
   * 都没选 → SUBJ 为空 → 进入选学科页。 */
  var SUBJ_KEY = "";
  (function () {
    var h = hashArg("subj");
    if (h && SUBJS[h]) { SUBJ_KEY = h; return; }
    var s = "";
    try { s = localStorage.getItem(SUBJ_KEY_NAME) || ""; } catch (e) {}
    if (s && SUBJS[s]) { SUBJ_KEY = s; return; }
    /* 脏数据（老版本的学科名 / 手滑写错）不进学科页 —— 直接当没选过，
       顺手清掉，避免每次启动都做一次无效判断。 */
    if (s) { try { localStorage.setItem(SUBJ_KEY_NAME, ""); } catch (e) {} }
  })();
  var SUBJ = SUBJ_KEY ? SUBJS[SUBJ_KEY] : null;
  window.APP_SUBJECT = SUBJ_KEY;          // "" = 选学科页
  window.APP_SUBJECTS = SUBJS;

  window.CP_BASE = CP_BASE;           // 必须在 cp.js 之前
  /* 调试入口：设置面板点标题 5 次 → 打开 #hotlog 看启动日志 */
  var __taps = 0;
  window.__hotLog = function () {
    __taps++;
    if (__taps < 5) return;
    try { location.hash = "hotlog"; location.reload(); } catch (e) {}
  };
  window.HOT_BASE = (HOT_BASES[0] || HOT_BASE);
  window.HOT_APP = APP;

  var LOG = [];
  function log(s) { LOG.push(s); try { console.log("[boot] " + s); } catch (e) {} }
  window.__HOT_LOG = LOG;
  /* 打真实生效的源（HOT_BASES[0]），不要打 HOT_BASE 兜底常量 ——
     常量永远显示 github.io，会让人误判成「源被锁死」（踩过）。 */
  log("start subj=" + (SUBJ_KEY || "(picker)") +
      " base=" + (HOT_BASES[0] || HOT_BASE) +
      (HOT_BASES.length > 1 ? "  (fallback=" + HOT_BASES[HOT_BASES.length - 1] + ")" : "  (single source)"));

  /* ---------- 换学科 / 选学科的入口三件套 ----------
   * index.html 设置面板里的「🔄 换学科」按钮调 __pickSubject；
   * 选学科页的卡片调 __setSubject。两个都会 reload —— 见文件头部的说明。 */
  window.__setSubject = function (k) {
    if (!SUBJS[k]) { log("bad subject: " + k); return; }
    try { localStorage.setItem(SUBJ_KEY_NAME, k); } catch (e) {}
    try { location.hash = setHashArg("subj", k); } catch (e) {}
    try { location.reload(); } catch (e) {}
  };
  window.__pickSubject = function () {
    try { localStorage.setItem(SUBJ_KEY_NAME, ""); } catch (e) {}
    try { location.hash = delHashArg("subj"); } catch (e) {}
    try { location.reload(); } catch (e) {}
  };

  /* ============================================================
   * 1. 设备判定 —— 越早越好，CSS 断点和 tv.js 都依赖它
   * ============================================================ */
  var D = window.AndroidDevice || null;
  var DEV = { tv: false, sw: 0, touch: true, mic: false, apk: 0, native: !!D };
  try {
    if (D) {
      DEV.tv = !!D.isTV();
      DEV.sw = D.swDp() || 0;
      DEV.touch = !!D.hasTouch();
      DEV.mic = !!D.hasMic();
      DEV.apk = D.versionCode() || 0;
    }
  } catch (e) { log("device bridge fail: " + e); }
  if (!DEV.sw) {
    try { DEV.sw = Math.round(Math.min(window.screen.width, window.screen.height)); } catch (e) { DEV.sw = 360; }
  }
  window.__dev = DEV;
  try {
    /* #tv 调试开关：无 TV 设备时在浏览器里模拟 TV（tv.js 里同样判了 hash，
       这里必须同步判，否则 body.tv 加不上、TV 断点样式整块失效）。 */
    var forceTV = /tv/.test(String(location.hash || ""));
    document.body.classList.add((DEV.tv || forceTV) ? "tv" : (DEV.sw >= 600 ? "tablet" : "phone"));
  } catch (e) {}
  log("dev tv=" + DEV.tv + " sw=" + DEV.sw + " touch=" + DEV.touch + " apk=" + DEV.apk);

  /* ---------- 热更桥（不存在就是浏览器/老壳，自动走内置） ---------- */
  var H = window.AndroidHot || null;
  if (!H) log("no AndroidHot bridge → builtin only");

  /* 页面加载完成后把日志画出来（#hotlog） */
  window.addEventListener("load", function () {
    if (!HOT_LOG) return;
    var d = document.createElement("pre");
    d.style.cssText = "position:fixed;left:0;right:0;top:0;bottom:0;z-index:9999;background:rgba(0,0,0,.88);" +
      "color:#0f0;font:12px/1.5 monospace;overflow:auto;padding:12px;white-space:pre-wrap;margin:0";
    d.textContent =
      "HOT " + APP + "  apk=" + DEV.apk + "  base=" + (HOT_BASES[0] || HOT_BASE) +
      "  bases=" + HOT_BASES.length + "\n" +
      "subj=" + (SUBJ_KEY || "(picker)") + "  native=" + DEV.native + "  dev=" + JSON.stringify(DEV) + "\n" +
      "build=" + (MAN ? MAN.build : "-") + "  files=" + (MAN ? MAN.files.length : 0) + "\n\n" +
      LOG.join("\n");
    document.body.appendChild(d);
  });

  /* ============================================================
   * 2. 读已装好的资源包清单（纯本地，零网络）
   * ============================================================ */
  var MAN = null;
  function readManifest() {
    if (!H) return null;
    var t = "";
    try { t = H.manifest(); } catch (e) { log("manifest read fail: " + e); return null; }
    if (!t) { log("no hot pack"); return null; }
    var m = null;
    try { m = JSON.parse(t); } catch (e) { log("manifest broken"); return null; }
    if (!m || !m.build || !m.files || !m.files.length) { log("manifest invalid"); return null; }
    if (m.app && m.app !== APP) { log("manifest app mismatch"); return null; }
    if (m.sig && m.sig !== HOT_TOKEN) { log("manifest sig mismatch"); return null; }
    if (m.min_apk && DEV.apk && DEV.apk < m.min_apk) { log("manifest needs newer apk"); return null; }
    try { if (H.isBad(m.build)) { log("build marked bad: " + m.build); return null; } } catch (e) {}
    try { if (H.isDisabled()) { log("hot disabled"); return null; } } catch (e) {}
    return m;
  }

  /* ---------- 选学科页：只注入宿主的 js/subject.js ----------
   * 一个学科的 js 都不许进来 —— 三科顶层同名变量一大把，混进来必炸。 */
  function planPicker(m) {
    var out = [], seen = {}, hotMap = {}, i, p;
    if (m) for (i = 0; i < m.files.length; i++) hotMap[m.files[i].p] = 1;
    for (i = 0; i < HOST_JS.length; i++) {
      p = HOST_JS[i]; seen[p] = 1;
      out.push({ name: p, url: hotMap[p] ? ("https://local.hot/" + p) : p, hot: !!hotMap[p] });
    }
    /* 这里**故意不放开**"资源包里新增的根目录 js"这条口子 ——
       试想过 `/^js\/xxx\.js$/` 的写法，但它没法区分「以后新加的宿主工具模块」和
       「2.4 时代遗留的 js/app.js」。老格式的资源包一旦装上，选学科页就会把语文的
       app.js 注进来：顶层变量又开始打架，而且 picker 没有任何一科的 UI 兜底。
       宿主层只有 HOST_JS 里登记的这些 —— 真要加新的，改这里 + 出新 APK，一步到位。 */
    return out;
  }

  /* ---------- 排出最终要注入的文件序列 ---------- */
  function planFiles(m) {
    if (!SUBJ) return planPicker(m);
    var out = [], seen = {}, hotMap = {}, i, p;
    if (m) for (i = 0; i < m.files.length; i++) hotMap[m.files[i].p] = 1;
    var list = BUILTIN[SUBJ_KEY] || [];
    for (i = 0; i < list.length; i++) {
      p = list[i]; seen[p] = 1;
      out.push({ name: p, url: hotMap[p] ? ("https://local.hot/" + p) : p, hot: !!hotMap[p] });
      /* 玩法 js 插在本学科 games.js 之后：这样 app.js 首次渲染就能看到全部已注册玩法。
         ★ 锚点必须是正则 —— 三科都有 games.js（cn/js/games.js、math/js/games.js…），
         v3.0 那句 `p === "js/games.js"` 只认得学科在根目录时的老路径，三科一迁移就全漏。 */
      if (/js\/games\.js$/.test(p) && m && m.games && m.games.length) {
        for (var g = 0; g < m.games.length; g++) {
          var gp = m.games[g].file || m.games[g];
          if (typeof gp !== "string" || !gp) continue;
          if (seen[gp]) continue;
          if (gp.indexOf(SUBJ.dir + "/js/") !== 0) continue;       // 别的学科的玩法不注入
          seen[gp] = 1;
          out.push({ name: gp, url: "https://local.hot/" + gp, hot: true, game: true });
        }
        log("games from pack: " + m.games.length);
      }
    }
    /* 然后接共享层（遥控器 + 电视调参）：同样的 hot 替换逻辑 */
    for (i = 0; i < SHARED_JS.length; i++) {
      p = SHARED_JS[i];
      if (seen[p]) continue;
      seen[p] = 1;
      out.push({ name: p, url: hotMap[p] ? ("https://local.hot/" + p) : p, hot: !!hotMap[p] });
    }

    /* 资源包里新增的、BUILTIN 没有的非玩法文件（例如新的工具模块）追加到末尾。
       ★ 只认本学科目录 + 只认 js ——
         - css 由 applyHotCss 走 <link> 注入；图片/音频/字体是二进制。
           这里手一松把 css 或 webp 当成 <script> 加载，会立刻语法错误 → onerror →
           整轮启动判失败 → 回滚重载，表现为「装了热更包就白屏」。踩过，别再放进来。
         - 同理必须排除其它学科目录：一个装着三科的热更包，数学模式下把 cn/js/app.js
           注进来，就是两套 state/render 打架。 */
    if (m) for (i = 0; i < m.files.length; i++) {
      p = m.files[i].p;
      if (seen[p]) continue;
      if (p.indexOf(SUBJ.dir + "/js/") !== 0) continue;
      if (!/\.js$/.test(p)) continue;
      seen[p] = 1;
      out.push({ name: p, url: "https://local.hot/" + p, hot: true });
    }
    return out;
  }

  /* ---------- 样式：资源包里的 css 逐个顶掉内置的 ----------
   * 三个要点：
   *   1. 顺序必须保住 —— css/tv.css 排在学科 style.css 之后才有最高优先级，
   *      电视版规则全靠它盖住手机版。所以替换时插回「原节点的下一个兄弟」前面，
   *      不能无脑 appendChild（一 append 就排到 tv.css 后面，电视样式整个失效）。
   *   2. 取不到就退回内置 —— 绝不让页面裸奔。
   *   3. #cssSub 是 boot.js 动态建的 —— index.html 里没有它，
   *      因为学科要等读到 localStorage 才知道，写死就会先闪一下某一科的配色。
   */
  var CSS_MAP = { "css/shell.css": "cssShell", "css/tv.css": "cssTV" };
  if (SUBJ) CSS_MAP[SUBJ.css] = "cssSub";
  function swapCss(path, id, build) {
    var old = document.getElementById(id);
    var anchor = old ? old.nextSibling : null;
    function place(node) {
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(node, anchor);
      else document.head.appendChild(node);
    }
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.id = id;
    l.href = "https://local.hot/" + path + "?b=" + build;
    l.onerror = function () {
      log("hot css failed → builtin: " + path);
      if (l.parentNode) l.parentNode.removeChild(l);
      var b = document.createElement("link");
      b.rel = "stylesheet"; b.id = id; b.href = path;
      place(b);
    };
    if (old && old.parentNode) old.parentNode.removeChild(old);
    place(l);
  }
  /* 把学科样式插到 #cssTV 之前 —— 顺序：shell → 学科 → tv */
  function mountSubCss() {
    if (!SUBJ) return;
    if (document.getElementById("cssSub")) return;
    var l = document.createElement("link");
    l.rel = "stylesheet"; l.id = "cssSub"; l.href = SUBJ.css;
    var anchor = document.getElementById("cssTV");
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(l, anchor);
    else document.head.appendChild(l);
  }
  function applyHotCss(m) {
    if (!m) return;
    var i, n = 0;
    /* 按 m.files 的顺序处理（style.css 在前、tv.css 在后），顺序才不会错位 */
    for (i = 0; i < m.files.length; i++) {
      var p = m.files[i].p;
      var id = CSS_MAP[p];
      if (!id) continue;
      swapCss(p, id, m.build);
      n++;
    }
    if (n) log("css from pack ×" + n);
  }

  /* ============================================================
   * 3. 注入（内联 <script> 同步执行；外链靠 async=false 保证顺序）
   * ============================================================ */
  function run(files, cb) {
    var i = 0;
    (function next() {
      if (i >= files.length) { cb(true); return; }
      var f = files[i++], s = document.createElement("script");
      /* 只有热更文件才加 ?b= 破缓存。内置的相对路径绝不能带 query ——
         WebView 的 android_asset 会把 "js/games.js?b=0" 整个当文件名去 AssetManager 找，必然失败 */
      s.src = f.url + (f.hot ? "?b=" + (MAN ? MAN.build : 0) : "");
      s.async = false;
      s.onload = function () { next(); };
      s.onerror = function () { log("load fail " + f.url); cb(false); };
      document.body.appendChild(s);
    })();
  }

  /* ---------- 启动哨兵 ----------
   * 学科模式沿用旧判据：app.js 把 #app 渲染出来了就算成功。
   * 选学科页没有 window.render（那是各科 app.js 的顶层变量），
   * 改成检查 #app 里有没有选学科页的卡片网格（.subj-grid）。 */
  function bootOk() {
    try {
      if (SUBJ) {
        return typeof window.render === "function" && window.app && window.app.childNodes.length > 0;
      }
      var el = document.getElementById("app");
      return !!(el && el.querySelector(".subj-grid"));
    } catch (e) { return false; }
  }
  function watch(loadOk) {
    var t0 = Date.now();
    (function spin() {
      if (bootOk()) {
        log("BOOT OK");
        if (H && MAN) { try { H.markOk(MAN.build); } catch (e) {} }
        setTimeout(bgUpdate, BG_DELAY);
        return;
      }
      if (Date.now() - t0 > T_SENTINEL) { onFail("sentinel timeout"); return; }
      setTimeout(spin, 60);
    })();
    if (!loadOk) onFail("script load error");
  }

  /* ---------- 失败回退：标记坏包 → 回滚 → 重载，绝不白屏 ---------- */
  function onFail(why) {
    log("FAIL " + why);
    if (!MAN) { log("builtin failed, nothing to roll back"); return; }
    try { H && H.markBad(MAN.build); } catch (e) {}
    try {
      if (H && H.isDisabled()) { log("hot disabled permanently"); return; }
    } catch (e) {}
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 30);
  }

  /* ============================================================
   * 4. 后台更新（启动成功后才跑，绝不抢启动）
   * ============================================================ */
  var __baseIdx = 0, __usedBase = "";
  function bgUpdate() {
    if (!H) { log("bg: no bridge"); return; }
    try { if (H.isDisabled()) { log("bg: disabled"); return; } } catch (e) {}
    __baseIdx = 0;
    __fetchManifest();
  }
  function __fetchManifest() {
    if (__baseIdx >= HOT_BASES.length) { log("bg: all hot bases failed"); return; }
    var url = HOT_BASES[__baseIdx] + "pack/manifest.json?t=" + Date.now();
    log("bg: check " + url);
    H.httpGet(url, "__hotPackManifest");
  }

  var PENDING = [], PENDING_NAME = "";

  window.__hotPackManifest = function (txt) {
    if (txt == null) {                 // 当前热更源失败 → 试下一个
      if (__baseIdx < HOT_BASES.length - 1) { __baseIdx++; log("bg: try next base"); __fetchManifest(); return; }
      log("bg: no manifest (all bases failed)"); return;
    }
    __usedBase = HOT_BASES[__baseIdx] || HOT_BASE;
    var m = null;
    try { m = JSON.parse(txt); } catch (e) { log("bg: manifest bad"); return; }
    if (!m || !m.build) { log("bg: manifest shape bad"); return; }
    if (!(m.packs && m.packs.length) && !m.zip) { log("bg: no packs"); return; }
    if (m.app && m.app !== APP) return;
    if (m.sig && m.sig !== HOT_TOKEN) return;
    if (m.min_apk && DEV.apk && DEV.apk < m.min_apk) { log("bg: needs newer apk"); return; }
    try { if (H.isBad(m.build)) { log("bg: build is bad"); return; } } catch (e) {}
    if (MAN && MAN.build === m.build) { log("bg: up to date"); return; }
    log("bg: install " + m.build);

    /* 分包：manifest 里 packs 是一个数组（大资源包在前、带 MANIFEST.json 的
       代码包在最后），逐个装完才算完成。老格式只有 zip 字段，也能兼容。 */
    PENDING = (m.packs && m.packs.length) ? m.packs.slice()
            : [{ name: m.zip, sha256: m.sha256 || "", size: m.size || 0 }];
    PENDING_NAME = m.build;
    installNext();
  };

  function installNext() {
    if (!PENDING.length) {
      log("bg: all packs installed");
      try {
        if (typeof window.toast === "function") window.toast("新内容已就绪，下次打开生效");
      } catch (e) {}
      return;
    }
    var pk = PENDING.shift();
    log("bg: pack " + pk.name + " (" + (pk.size || "?") + "B)");
    H.installPack((__usedBase || HOT_BASES[0] || HOT_BASE) + pk.name + "?b=" + PENDING_NAME, pk.sha256 || "");
  }

  window.__onHotProgress = function (done) { log("bg: " + done + "B"); };

  window.__onHotPack = function (st, msg) {
    log("bg: pack " + st + (msg ? " " + msg : ""));
    if (st !== "ok") { PENDING = []; return; }   // 装失败就整轮放弃，下次启动再试
    installNext();
  };

  /* ============================================================
   * 5. 启动
   * ============================================================ */
  if (NO_HOT) { log("nohot → builtin"); mountSubCss(); run(planFiles(null), watch); return; }

  MAN = readManifest();
  /* 把生效中的资源包版本号暴露出去：热更自检页和 tv.js 都要用它拼 URL 破缓存 */
  window.__HOT_BUILD = MAN ? MAN.build : "";
  if (MAN) log("use pack build=" + MAN.build + " files=" + MAN.files.length);
  else log("use builtin");

  mountSubCss();
  applyHotCss(MAN);
  run(planFiles(MAN), watch);
})();
