/* ===================== js/boot.js · 通用热更引导器（v3.0） =====================
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
 * 铁律不变：
 *   · **启动路径零网络** —— 启动时只读本地（内置或已装好的资源包），
 *     网络只发生在启动成功 3 秒后的后台更新里。
 *   · **绝不白屏** —— 1.5s 哨兵没渲染出 #app 就判失败：标记坏包 → 回滚 → 重载。
 *     熔断状态存在原生 SharedPreferences 里，热更的 js 再怎么坏也毁不掉逃生通道。
 *
 * 调试：index.html#hotlog 看启动日志（不用 adb、不用改 Java）
 * 逃生：index.html?safe=1 或 #nohot 强制走内置版本
 * 测试：index.html#hotbase=http://127.0.0.1:8899/hot/ 指定热更源
 * ============================================================================ */
(function () {
  "use strict";

  /* ---------- 配置（每个项目不同） ---------- */
  var APP       = "chinese";
  var HOT_BASE  = "https://q137663972-alt.github.io/chinese/hot/";
  var HOT_TOKEN = "chinese-2026";
  /* 内置兜底清单：顺序即注入顺序。热更包里有的文件会顶掉同路径的内置文件，
     热更包里新增的文件（玩法 js）会插入在 js/games.js 之后。 */
  var BUILTIN   = [
    "js/cp.js",
    "js/data-c1.js", "js/data-c2.js", "js/data-c3.js",
    "js/data-c4.js", "js/data-c5.js", "js/data-c6.js",
    "js/strokes.js",
    "js/data-poem.js",
    "js/data-word.js",
    "js/tts.js",
    "js/pics.js",
    "js/games.js",
    "js/app.js",
    "js/tv.js",
    "js/update.js"
  ];
  var CP_BASE = "https://q137663972-alt.github.io/chinese/content/";

  var T_SENTINEL = 1500;              // 等启动哨兵
  var BG_DELAY   = 3000;              // 启动成功后多久开始后台更新

  /* ---------- 调试开关：#hotbase= / ?safe=1 / #nohot / #hotlog ---------- */
  var HASH = String(location.hash || "");
  function hashArg(name) {
    var m = HASH.match(new RegExp("(?:^|[#&])" + name + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  var hb = hashArg("hotbase");
  if (hb) HOT_BASE = hb.replace(/([^/])$/, "$1/");
  var SEARCH = String(location.search || "");
  var NO_HOT  = HASH.indexOf("nohot") >= 0 || /[?&]safe=1\b/.test(SEARCH);
  var HOT_LOG = HASH.indexOf("hotlog") >= 0;

  window.CP_BASE = CP_BASE;           // 必须在 cp.js 之前
  /* 调试入口：设置面板点标题 5 次 → 打开 #hotlog 看启动日志 */
  var __taps = 0;
  window.__hotLog = function () {
    __taps++;
    if (__taps < 5) return;
    try { location.hash = "hotlog"; location.reload(); } catch (e) {}
  };
  window.HOT_BASE = HOT_BASE;
  window.HOT_APP = APP;

  var LOG = [];
  function log(s) { LOG.push(s); try { console.log("[boot] " + s); } catch (e) {} }
  window.__HOT_LOG = LOG;
  log("start base=" + HOT_BASE);

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
      "HOT " + APP + "  apk=" + DEV.apk + "  base=" + HOT_BASE + "\n" +
      "native=" + DEV.native + "  dev=" + JSON.stringify(DEV) + "\n" +
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

  /* ---------- 排出最终要注入的文件序列 ---------- */
  function planFiles(m) {
    var out = [], i, p, hotMap = {};
    if (m) for (i = 0; i < m.files.length; i++) hotMap[m.files[i].p] = 1;
    for (i = 0; i < BUILTIN.length; i++) {
      p = BUILTIN[i];
      out.push({ name: p, url: hotMap[p] ? ("https://local.hot/" + p) : p, hot: !!hotMap[p] });
      /* 玩法 js 插在 games.js 之后：这样 app.js 首次渲染就能看到全部已注册玩法 */
      if (p === "js/games.js" && m && m.games && m.games.length) {
        for (var g = 0; g < m.games.length; g++) {
          var gp = m.games[g].file || m.games[g];
          if (typeof gp === "string" && gp) {
            out.push({ name: gp, url: "https://local.hot/" + gp, hot: true, game: true });
          }
        }
        log("games from pack: " + m.games.length);
      }
    }
    /* 资源包里新增的、BUILTIN 没有的非玩法文件（例如新的工具模块）追加到末尾 */
    if (m) for (i = 0; i < m.files.length; i++) {
      p = m.files[i].p;
      if (BUILTIN.indexOf(p) < 0 && p !== "MANIFEST.json" && p !== "css/style.css" && p.indexOf("img/") !== 0) {
        out.push({ name: p, url: "https://local.hot/" + p, hot: true });
      }
    }
    return out;
  }

  /* ---------- 样式：资源包里有 css 就顶掉内置的 ---------- */
  function applyHotCss(m) {
    if (!m) return;
    var has = false, i;
    for (i = 0; i < m.files.length; i++) if (m.files[i].p === "css/style.css") has = true;
    if (!has) return;
    var l = document.getElementById("css0");
    if (l && l.parentNode) l.parentNode.removeChild(l);
    var s = document.createElement("link");
    s.rel = "stylesheet";
    s.href = "https://local.hot/css/style.css?b=" + m.build;
    s.id = "css0";
    /* 万一资源包里的 css 取不到，退回内置的，绝不能让页面裸奔 */
    s.onerror = function () {
      log("hot css failed → builtin");
      var b = document.createElement("link");
      b.rel = "stylesheet"; b.href = "css/style.css";
      document.head.appendChild(b);
    };
    document.head.appendChild(s);
    log("css from pack");
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

  /* ---------- 启动哨兵：app.js 把 #app 渲染出来了就算成功 ---------- */
  function bootOk() {
    try {
      return typeof window.render === "function" && window.app && window.app.childNodes.length > 0;
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
  function bgUpdate() {
    if (!H) { log("bg: no bridge"); return; }
    try { if (H.isDisabled()) { log("bg: disabled"); return; } } catch (e) {}
    var url = HOT_BASE + "pack/manifest.json?t=" + Date.now();
    log("bg: check " + url);
    H.httpGet(url, "__hotPackManifest");
  }

  var PENDING = [], PENDING_NAME = "";

  window.__hotPackManifest = function (txt) {
    if (txt == null) { log("bg: no manifest"); return; }
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
    H.installPack(HOT_BASE + pk.name + "?b=" + PENDING_NAME, pk.sha256 || "");
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
  if (NO_HOT) { log("nohot → builtin"); run(planFiles(null), watch); return; }

  MAN = readManifest();
  if (MAN) log("use pack build=" + MAN.build + " files=" + MAN.files.length);
  else log("use builtin");

  applyHotCss(MAN);
  run(planFiles(MAN), watch);
})();
