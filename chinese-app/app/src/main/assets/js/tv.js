/* ===================== 电视 / 机顶盒（D-pad 遥控器）适配 =====================
 * 仅在 TV 模式下启用；手机与桌面浏览器完全不受影响。
 * 安卓壳通过 file://.../index.html#tv 或在 TV/盒子 UA 下自动进入本模式。
 * 核心：给所有可点击元素打 tabindex，接管方向键做几何最近邻导航，确认键触发 click。
 */
(function () {
  function detectTV() {
    try {
      if (/tv|googletv|android tv|aftenmab?|aft|smarttv|smart-tv|appletv|crkey|fugu|shield android tv|mi tv|fire tv|hisense|tcl/i.test(navigator.userAgent)) return true;
    } catch (e) {}
    if (location.hash.indexOf("tv") >= 0) return true;
    try {
      // Android 但非精确指针（触摸/鼠标）设备，视为电视/盒子
      if (/android/i.test(navigator.userAgent) && !window.matchMedia("(pointer: fine)").matches && !("ontouchstart" in window)) return true;
    } catch (e) {}
    return false;
  }

  var TV = detectTV();
  window.__isTV = TV;
  if (!TV) return; // 非 TV：什么都不做，原版行为不变

  document.body.classList.add("tv");

  // 需要可聚焦的交互元素（与 H5 现有点击元素一一对应）
  var SEL = ".grade-card,.unit-card,.mode-card,.opt,.tile,.mem-card,.sw,.bw,.xcell,.wp-item,.bucket,.switch,button,a,input,select,[data-tv-focus]";

  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function markFocusable(root) {
    $all(SEL, root || document).forEach(function (el) {
      if (!el.hasAttribute("tabindex") && el.offsetParent !== null) el.setAttribute("tabindex", "0");
    });
  }

  function visibleFocusables() {
    return $all(SEL).filter(function (el) { return el.offsetParent !== null && !el.disabled; });
  }

  var lastFocus = null;
  function focusAt(el) { if (el) { try { el.focus(); } catch (e) {} lastFocus = el; } }

  function ensureFocus() {
    var act = document.activeElement;
    if (act && act !== document.body && act.offsetParent !== null) return; // 已有可见焦点
    var f = (lastFocus && lastFocus.offsetParent !== null) ? lastFocus : visibleFocusables()[0];
    focusAt(f);
  }

  // 方向键：几何最近邻（主轴距离 + 垂直偏移惩罚）
  function nav(dir) {
    var list = visibleFocusables();
    if (!list.length) return;
    var cur = document.activeElement;
    if (!cur || cur === document.body || cur.offsetParent === null) { focusAt(list[0]); return; }
    var r0 = cur.getBoundingClientRect();
    var cx = r0.left + r0.width / 2, cy = r0.top + r0.height / 2;
    var best = null, bestScore = Infinity;
    list.forEach(function (el) {
      if (el === cur) return;
      var r = el.getBoundingClientRect();
      var ex = r.left + r.width / 2, ey = r.top + r.height / 2;
      var dx = ex - cx, dy = ey - cy;
      var inDir = (dir === "left" && dx < -1) || (dir === "right" && dx > 1) ||
                  (dir === "up" && dy < -1) || (dir === "down" && dy > 1);
      if (!inDir) return;
      var primary = (dir === "left" || dir === "right") ? Math.abs(dx) : Math.abs(dy);
      var cross = (dir === "left" || dir === "right") ? Math.abs(dy) : Math.abs(dx);
      var score = primary + cross * 2.2;
      if (score < bestScore) { bestScore = score; best = el; }
    });
    if (best) focusAt(best);
  }

  // 首次交互解锁音频（TV 没有 pointer 事件）
  function unlockOnce() {
    if (window.unlockAudio) { try { window.unlockAudio(); } catch (e) {} }
    document.removeEventListener("keydown", unlockOnce, true);
    document.removeEventListener("click", unlockOnce, true);
  }

  function init() {
    markFocusable(document);
    ensureFocus();

    // 监听渲染变化：重新打标并复位焦点
    var appEl = document.getElementById("app");
    if (appEl && "MutationObserver" in window) {
      var mo = new MutationObserver(function () {
        markFocusable(appEl);
        ensureFocus();
      });
      mo.observe(appEl, { childList: true, subtree: true });
    }

    document.addEventListener("keydown", function (e) {
      var act = document.activeElement;
      // 输入框（语速滑块）放行方向键，原生调整数值
      if (act && act.tagName === "INPUT") return;

      var k = e.key;
      if (k === "ArrowLeft") { e.preventDefault(); nav("left"); }
      else if (k === "ArrowRight") { e.preventDefault(); nav("right"); }
      else if (k === "ArrowUp") { e.preventDefault(); nav("up"); }
      else if (k === "ArrowDown") { e.preventDefault(); nav("down"); }
      else if (k === "Enter" || k === " " || e.keyCode === 13 || e.keyCode === 23) {
        // 原生按钮/链接/输入框交给浏览器触发，避免重复点击
        if (act && /^(BUTTON|A|INPUT|SELECT|TEXTAREA)$/.test(act.tagName)) return;
        if (act && act !== document.body) { e.preventDefault(); act.click(); }
      }
    }, true);

    document.addEventListener("keydown", unlockOnce, true);
    document.addEventListener("click", unlockOnce, true);

    // 进入页面先把焦点放到第一个可交互元素
    window.addEventListener("load", function () { setTimeout(ensureFocus, 50); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
