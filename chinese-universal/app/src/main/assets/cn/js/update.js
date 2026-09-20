/* ===================== js/update.js · 应用内一键升级 =====================
 * 原则：静默检查 → 有新版本才在首页顶部显示一条小提示条 → 点了才升 →
 *       不点或用 × 关掉都完全不影响正常使用，绝不打断孩子做题。
 * 可热更文件（在 boot.js 的 BUILTIN 清单末尾）。
 * 没有原生桥（浏览器/微信里打开）时什么都不做。
 * ======================================================================== */
(function () {
  "use strict";

  var A = window.AndroidUpdate;
  var SKIP_KEY = "upd_skip";

  function toast(msg) {
    try { if (typeof window.toast === "function") { window.toast(msg); return; } } catch (e) {}
    var t = document.getElementById("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(window.__ut);
    window.__ut = setTimeout(function () { t.classList.remove("show"); }, 2000);
  }

  function check() {
    if (!A) return;
    var base = window.HOT_BASE || "";
    if (!base) return;
    var s = document.createElement("script");
    s.src = base + "update.js?t=" + Date.now();
    s.onload = function () { show(window.APP_UPDATE); };
    document.head.appendChild(s);
  }

  function show(u) {
    if (!u || !u.code) return;
    var cur = 0;
    try { cur = A.getVersionCode(); } catch (e) { return; }
    if (cur <= 0 || cur >= u.code) return;                       // 已是最新
    try { if (localStorage.getItem(SKIP_KEY) === String(u.code)) return; } catch (e) {}

    /* v3.0 起只有一个通用包（手机/平板/TV 通吃），优先读 apk 字段。
       老的 1.1 版 APK 里内置的 update.js 只认 phone/tv，所以 update.json 里
       这两个字段仍然保留、指向同一个包 —— 老用户也能收到升级提示。 */
    var isTV = (window.__isTV === true) || location.hash.indexOf("tv") >= 0;
    var url    = u.apk || (isTV ? (u.tv || u.phone) : (u.phone || u.tv));
    var mirror = u.apkMirror || (isTV ? (u.tvMirror || u.phoneMirror) : (u.phoneMirror || u.tvMirror));
    if (!url) return;

    var bar = document.createElement("div");
    bar.className = "upd-bar";
    bar.innerHTML =
      '<span class="upd-txt">🎉 有新版本 ' + (u.name || "") + "：" + (u.note || "修好了一些小问题") + "</span>" +
      '<button class="upd-go">更新</button><button class="upd-x">×</button>';
    document.body.appendChild(bar);
    document.body.style.paddingTop = "46px";
    window.__updBar = bar;

    bar.querySelector(".upd-x").onclick = function () {
      try { localStorage.setItem(SKIP_KEY, String(u.code)); } catch (e) {}
      close();
    };
    bar.querySelector(".upd-go").onclick = function () {
      var go = bar.querySelector(".upd-go");
      go.disabled = true;
      go.textContent = "准备中…";
      try { A.install(url, mirror || ""); } catch (e) { fail(String(e && e.message || e)); }
    };
  }

  function close() {
    var bar = window.__updBar;
    if (bar && bar.parentNode) bar.parentNode.removeChild(bar);
    window.__updBar = null;
    document.body.style.paddingTop = "";
  }

  window.__onUpdateProgress = function (done) {
    var go = window.__updBar && window.__updBar.querySelector(".upd-go");
    if (!go) return;
    if (done < 0) { go.textContent = "安装中…"; return; }
    go.textContent = (done / 1048576).toFixed(1) + " MB";
  };
  window.__onUpdateDone = function (st, msg) {
    if (st === "ok") { toast("下载完成，按提示安装即可"); close(); return; }
    if (st === "need-permission") { toast("请先在设置里允许安装未知应用"); reset(); return; }
    fail(msg);
  };
  function fail(msg) {
    reset();
    toast("升级失败，可稍后再试" + (msg ? "（" + msg + "）" : ""));
  }
  function reset() {
    var go = window.__updBar && window.__updBar.querySelector(".upd-go");
    if (go) { go.disabled = false; go.textContent = "重试"; }
  }

  setTimeout(check, 4000);                                       // 启动 4 秒后再查，绝不抢首屏
})();
