/* ===================== js/boot.js · 热更引导器 =====================
 * 【冻结文件】本文件永不参与热更 —— 改它必须出新 APK。
 *
 * 三层架构：
 *   第 1 层 内置 assets   ← APK 里的原始版本，永远可用
 *   第 2 层 本地缓存      ← 上次后台下载好的新版（localStorage，内容寻址）
 *   第 3 层 远程 hot/     ← GitHub Pages 上的最新版
 *
 * 铁律：**启动路径零网络**。有缓存用缓存（离线也是新版），没缓存用内置，
 * 两者都是纯本地同步执行。网络只发生在启动成功 3 秒后的后台更新里，
 * 失败的最坏结果只是「这次没更新上」，绝不会白屏、绝不会卡启动。
 *
 * 调试：打开 index.html#hotlog 看启动日志（不用 adb、不用改 Java）
 * 逃生：打开 index.html#nohot 强制走内置版本
 * 测试：打开 index.html#hotbase=http://127.0.0.1:8899/hot/ 指定热更源
 * ================================================================== */
(function () {
  "use strict";

  /* ---------- 配置（每个项目不同） ---------- */
  var APP       = "chinese";
  var HOT_BASE  = "https://q137663972-alt.github.io/chinese/hot/";
  var HOT_TOKEN = "chinese-2026";
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
  /* 大文件（笔顺 1.2MB + 图库 260KB）：缓存成功就用新版，
     缓存失败（localStorage 装不下）就继续用内置的，不影响其他文件 */
  var BIG = ["js/strokes.js", "js/pics.js"];
  var CP_BASE = "https://q137663972-alt.github.io/chinese/content/";

  var T_MANIFEST = 6000;              // 拉 manifest 超时
  var T_FILE     = 20000;             // 拉单个文件超时
  var T_SENTINEL = 1500;              // 等启动哨兵
  var BG_DELAY   = 3000;              // 启动成功后多久开始后台更新

  /* ---------- 调试开关：#hotbase= / #nohot / #hotlog ---------- */
  var HASH = String(location.hash || "");
  function hashArg(name) {
    var m = HASH.match(new RegExp("(?:^|[#&])" + name + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : "";
  }
  var hb = hashArg("hotbase");
  if (hb) HOT_BASE = hb.replace(/([^/])$/, "$1/");
  var NO_HOT  = HASH.indexOf("nohot")  >= 0;
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

  /* ---------- 当前 APK 版本（由原生桥提供，没有桥就是 0） ---------- */
  var APK_VER = 0;
  try { if (window.AndroidUpdate) APK_VER = window.AndroidUpdate.getVersionCode() || 0; } catch (e) {}
  window.HOT_VER = APK_VER;

  /* ---------- 存储：localStorage（IndexedDB 在 file:// 下不可靠，不用） ---------- */
  var LS = null;
  try {
    localStorage.setItem("__hot_t", "1"); localStorage.removeItem("__hot_t");
    LS = localStorage;
  } catch (e) { log("no localStorage: " + e); }

  function K(k) { return "hot." + k; }
  function get(k) { try { return LS ? LS.getItem(K(k)) : null; } catch (e) { return null; } }
  function set(k, v) { try { LS.setItem(K(k), v); return true; } catch (e) { log("set fail " + k); return false; } }
  function del(k) { try { LS.removeItem(K(k)); } catch (e) {} }
  function allKeys(pre) {
    var r = [], i, k, p = "hot." + pre;
    if (!LS) return r;
    for (i = 0; i < LS.length; i++) { k = LS.key(i); if (k && k.indexOf(p) === 0) r.push(k.slice(4)); }
    return r;
  }
  function isBig(p) { return BIG.indexOf(p) >= 0; }

  /* ---------- FNV-1a 双通道 32bit → 16 hex
     必须与 tools/gen-hot.mjs 里的 fnv() 逐字一致 ---------- */
  function fnv(s) {
    var a = 0x811c9dc5, b = 0x1000193, i, c;
    for (i = 0; i < s.length; i++) {
      c = s.charCodeAt(i);
      a = Math.imul(a ^ c, 16777619);
      b = Math.imul(b ^ c, 2166136261);
    }
    return ("0000000" + (a >>> 0).toString(16)).slice(-8) + ("0000000" + (b >>> 0).toString(16)).slice(-8);
  }

  /* ---------- 读缓存：核心文件全齐才切版本，大文件缺了就用内置 ---------- */
  function readCache() {
    if (!LS) { log("no storage"); return null; }
    var b = get("build");
    if (!b) { log("no cache"); return null; }
    var idx;
    try { idx = JSON.parse(get("i." + b)); } catch (e) { log("index broken"); return null; }
    if (!idx || idx.app !== APP || !idx.files || !idx.files.length) { log("index invalid"); return null; }

    var out = [], i, p, h, n, t;
    for (i = 0; i < idx.files.length; i++) {
      p = idx.files[i][0]; h = idx.files[i][1]; n = idx.files[i][2];
      t = get("c." + h);
      if (t != null && t.length === n && fnv(t) === h) { out.push({ name: p, text: t }); continue; }
      if (isBig(p)) { log("big miss, use builtin: " + p); out.push({ name: p, url: p, text: null }); continue; }
      log("cache broken: " + p);
      return null;                                  // 核心文件缺失 → 整体回退内置
    }
    var css = get("c." + idx.cssH), shell = get("c." + idx.shellH);
    if (css == null || fnv(css) !== idx.cssH) { log("css cache broken, use builtin"); css = null; }
    if (shell == null || fnv(shell) !== idx.shellH) { log("shell cache broken, use builtin"); shell = null; }
    log("cache hit build=" + b);
    return { build: b, files: out, shell: shell, css: css };
  }

  /* ---------- 注入 ---------- */
  function applyShell(txt) {
    if (txt == null) return;
    try { document.body.innerHTML = txt; } catch (e) { log("shell inject fail " + e); }
  }
  function applyCss(txt) {
    if (txt == null) return;                        // 保留 index.html 里的 <link id="css0">
    var l = document.getElementById("css0");
    if (l && l.parentNode) l.parentNode.removeChild(l);
    var s = document.createElement("style");
    s.textContent = txt;
    document.head.appendChild(s);
  }
  /* 内联 <script> 是同步执行的 → 插入顺序就是执行顺序；外链用串行 onload */
  function run(files, cb) {
    var i = 0;
    (function next() {
      if (i >= files.length) { cb(true); return; }
      var f = files[i++], s = document.createElement("script");
      if (f.text != null) {
        s.textContent = f.text + "\n//# sourceURL=" + HOT_BASE + f.name;
        document.body.appendChild(s);
        next();
      } else {
        s.src = f.url; s.async = false;
        s.onload = function () { next(); };
        s.onerror = function () { log("load fail " + f.url); cb(false); };
        document.body.appendChild(s);
      }
    })();
  }

  /* ---------- 启动哨兵：app.js 已经把 #app 渲染出来了就算成功 ---------- */
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
        del("fails"); del("noboot");
        gc();
        setTimeout(bgUpdate, BG_DELAY);
        return;
      }
      if (Date.now() - t0 > T_SENTINEL) { onFail("sentinel timeout"); return; }
      setTimeout(spin, 60);
    })();
    if (!loadOk) onFail("script load error");
  }

  /* ---------- 失败回退：绝不白屏 ---------- */
  function onFail(why) {
    log("FAIL " + why);
    var f = (parseInt(get("fails"), 10) || 0) + 1;
    set("fails", String(f));
    if (f >= 2) {
      set("disabled", "1");                          // 连续两次 → 永久关闭热更，不再 reload（避免死循环）
      log("hot disabled permanently");
      clearCache();
      return;
    }
    set("noboot", "1");
    clearCache();
    setTimeout(function () { try { location.reload(); } catch (e) {} }, 30);
  }
  function clearCache() {
    var ks = allKeys("c.").concat(allKeys("i.")), i;
    for (i = 0; i < ks.length; i++) del(ks[i]);
    del("build");
  }
  function gc() {
    var b = get("build"), idx, keep = {}, i;
    if (!b) return;
    try { idx = JSON.parse(get("i." + b)); } catch (e) { return; }
    if (!idx || !idx.files) return;
    for (i = 0; i < idx.files.length; i++) keep[idx.files[i][1]] = 1;
    if (idx.shellH) keep[idx.shellH] = 1;
    if (idx.cssH) keep[idx.cssH] = 1;
    allKeys("c.").forEach(function (k) { if (!keep[k.slice(2)]) del(k); });
  }

  /* ---------- 启动 ---------- */
  function useCache(c) {
    log("use cache " + c.build);
    applyShell(c.shell); applyCss(c.css);
    run(c.files, watch);
  }
  function useBuiltin() {
    log("use builtin");
    var files = [], i;
    for (i = 0; i < BUILTIN.length; i++) files.push({ name: BUILTIN[i], url: BUILTIN[i], text: null });
    run(files, watch);
  }

  if (NO_HOT) { log("nohot"); useBuiltin(); return; }
  if (get("apkver") !== String(APK_VER)) {           // 换了 APK → 重置熔断
    del("disabled"); del("fails"); set("apkver", String(APK_VER));
    log("apkver -> " + APK_VER);
  }
  if (get("disabled") === "1") { log("disabled"); useBuiltin(); return; }
  if (get("noboot") === "1") { del("noboot"); log("noboot → builtin"); useBuiltin(); return; }
  var c = readCache();
  if (c) useCache(c); else useBuiltin();

  /* ---------- 后台更新（启动成功后才跑，绝不抢启动） ---------- */
  function bgUpdate() {
    if (get("disabled") === "1") return;
    loadManifest(function (m) {
      if (!m) { log("bg: no manifest"); return; }
      if (m.build === get("build")) { log("bg: up to date"); return; }
      log("bg: new build " + m.build);
      download(m, function (ok) {
        if (!ok) { log("bg: download failed, retry next launch"); return; }
        var files = [], i;
        for (i = 0; i < m.files.length; i++) files.push([m.files[i].p, m.files[i].h, m.files[i].n]);
        if (!set("i." + m.build, JSON.stringify({
          app: APP, ts: m.ts, shellH: m.shellH, cssH: m.cssH, files: files
        }))) { log("bg: commit fail (quota)"); return; }
        set("build", m.build);                       // ← 原子提交：只写这一个 key
        log("bg: committed " + m.build);
      });
    });
  }

  /* manifest 用 <script src> 加载 —— 不依赖 CORS，最稳 */
  function loadManifest(cb) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; log("manifest timeout"); cb(null); } }, T_MANIFEST);
    var s = document.createElement("script");
    s.src = HOT_BASE + "manifest.js?t=" + Date.now();
    s.onload = function () {
      if (done) return; done = true; clearTimeout(to);
      cb(validManifest(window.HOT_MANIFEST) ? window.HOT_MANIFEST : null);
    };
    s.onerror = function () { if (done) return; done = true; clearTimeout(to); log("manifest net fail"); cb(null); };
    document.head.appendChild(s);
  }
  function validManifest(m) {
    if (!(m && m.build && m.files && m.files.length)) { log("manifest shape bad"); return false; }
    if (m.app !== APP) { log("manifest app mismatch: " + m.app); return false; }
    if (m.sig !== HOT_TOKEN) { log("manifest sig mismatch"); return false; }
    if (m.min_apk && APK_VER && APK_VER < m.min_apk) { log("manifest needs newer apk"); return false; }
    return true;
  }

  /* 只下变动文件（内容寻址 → 未变的直接跳过）；大文件失败不影响提交 */
  function download(m, cb) {
    var need = [], big = [], i, f;
    for (i = 0; i < m.files.length; i++) {
      f = m.files[i];
      if (get("c." + f.h) != null) continue;
      (isBig(f.p) ? big : need).push(f);
    }
    if (get("c." + m.shellH) == null) need.push({ p: "shell.html", h: m.shellH, n: m.shellN });
    if (get("c." + m.cssH) == null) need.push({ p: "css/style.css", h: m.cssH, n: m.cssN });

    log("bg: need " + need.length + " + big " + big.length);
    pull(need, false, function (ok) {
      if (!ok) { cb(false); return; }
      pull(big, true, function () { cb(true); });     // 大文件：成功与否都继续
    });
  }
  function pull(list, bestEffort, cb) {
    var i = 0;
    (function next() {
      if (i >= list.length) { cb(true); return; }
      var f = list[i++];
      fetchText(HOT_BASE + f.p + "?b=" + Date.now(), function (txt) {
        if (txt == null || txt.length !== f.n || fnv(txt) !== f.h) {
          log("bad file " + f.p);
          if (bestEffort) { next(); return; }
          cb(false); return;
        }
        if (!set("c." + f.h, txt)) {
          log("QUOTA exceeded at " + f.p);
          if (bestEffort) { next(); return; }
          cb(false); return;
        }
        next();
      });
    })();
  }

  function fetchText(url, cb) {
    var done = false;
    var to = setTimeout(function () { if (!done) { done = true; cb(null); } }, T_FILE);
    function fin(t) { if (done) return; done = true; clearTimeout(to); cb(t); }
    try {
      if (window.fetch) {
        fetch(url, { cache: "no-store" }).then(function (r) {
          return r && r.ok ? r.text() : null;
        }).then(fin)["catch"](function () { fin(null); });
      } else if (window.XMLHttpRequest) {
        var x = new XMLHttpRequest();
        x.open("GET", url, true);
        x.timeout = T_FILE;
        x.onload = function () { fin(x.status === 200 || x.status === 0 ? x.responseText : null); };
        x.onerror = function () { fin(null); };
        x.ontimeout = function () { fin(null); };
        x.send();
      } else { fin(null); }
    } catch (e) { fin(null); }
  }

  /* ---------- #hotlog：页面上直接看启动日志 ---------- */
  window.addEventListener("load", function () {
    if (!HOT_LOG) return;
    var d = document.createElement("pre");
    d.style.cssText = "position:fixed;left:0;right:0;top:0;bottom:0;z-index:9999;background:rgba(0,0,0,.88);" +
      "color:#0f0;font:12px/1.5 monospace;overflow:auto;padding:12px;white-space:pre-wrap;margin:0";
    d.textContent =
      "HOT " + APP + "  apk=" + APK_VER + "  base=" + HOT_BASE + "\n" +
      "fetch=" + !!window.fetch + "  localStorage=" + !!LS + "  indexedDB=" + !!window.indexedDB + "\n" +
      "build=" + get("build") + "  fails=" + get("fails") + "  disabled=" + get("disabled") + "\n\n" +
      LOG.join("\n");
    document.body.appendChild(d);
  });
})();
