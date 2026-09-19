/* ===================== 电视 / 遥控器（D-pad）适配 =====================
 * 仅在 TV 模式下启用；手机、平板、桌面浏览器完全不受影响。
 *
 * 判定顺序：
 *   1. URL 上带 #tv —— 调试开关，永远最优先（无 TV 设备时在浏览器里模拟 TV 全靠它）
 *   2. boot.js 从 AndroidDevice.isTV() 拿到的结果（window.__dev.tv）—— 真机最准
 *   3. UA 正则 —— 浏览器里预览时的兜底
 * （#tv 必须排在 __dev.tv 前面：boot.js 在浏览器里也会把 __dev.tv 初始化成 false，
 *   若先判它，#tv 永远轮不到 —— 之前 body.tv 在浏览器里加不上就是这个原因。）
 *
 * 焦点泛化：不再依赖写死的一串 class。新增玩法只要元素带 onclick 或
 * [data-tv-focus]，就会被自动纳入遥控器导航 —— 否则热更下发的新玩法
 * 在电视上永远选不中。
 */
(function () {
  var DEV = window.__dev || {};

  function detectTV() {
    if (location.hash.indexOf("tv") >= 0) return true;       // 调试开关，最优先
    if (typeof DEV.tv === "boolean") return DEV.tv;          // 原生桥说了算
    try {
      if (/tv|googletv|android tv|aftenmab?|aft|smarttv|smart-tv|appletv|crkey|fugu|shield android tv|mi tv|fire tv|hisense|tcl/i.test(navigator.userAgent)) return true;
    } catch (e) {}
    try {
      if (/android/i.test(navigator.userAgent) && !window.matchMedia("(pointer: fine)").matches && !("ontouchstart" in window)) return true;
    } catch (e) {}
    return false;
  }

  var TV = detectTV();
  window.__isTV = TV;
  if (!TV) return; // 非 TV：什么都不做，原版行为不变

  document.body.classList.add("tv");

  /* 可聚焦选择器：白名单 + 通用规则。
     通用规则（button / a[href] / [onclick] / [data-tv-focus]）保证
     热更下发的新玩法也能被遥控器选中，不用回来改这个文件。 */
  var SEL = [
    "[data-tv-focus]",
    "button",
    "a[href]",
    "select",
    "input[type=range]", "input[type=checkbox]", "input[type=radio]",
    "[onclick]",
    ".grade-card", ".unit-card", ".mode-card", ".opt", ".tile", ".mem-card",
    ".sw", ".bw", ".xcell", ".wp-item", ".bucket", ".switch"
  ].join(",");

  /* 电视没有软键盘：纯文本输入框不能被遥控器选中，否则焦点进去就卡死。
     这里只摘掉 tabindex，不设 readonly —— 插了 USB 键鼠的用户仍然能点进去用。 */
  var TEXTY = "textarea, input[type=text], input[type=number], input[type=search], input:not([type])";

  function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }

  function markFocusable(root) {
    $all(SEL, root || document).forEach(function (el) {
      if (!el.hasAttribute("tabindex") && el.offsetParent !== null) el.setAttribute("tabindex", "0");
    });
    $all(TEXTY, root || document).forEach(function (el) { el.setAttribute("tabindex", "-1"); });
  }

  function visibleFocusables() {
    return $all(SEL).filter(function (el) { return el.offsetParent !== null && !el.disabled; });
  }

  var lastFocus = null;
  function focusAt(el) { if (el) { try { el.focus(); } catch (e) {} lastFocus = el; } }

  /* 顶栏（返回 / 设置）不能当默认焦点：
     页面 HTML 以 topbar 开头，若按「第一个可聚焦元素」取焦点，进子页面时焦点
     会落在「←」上 —— 遥控器一按确认就执行了返回，表现为「点进年级页立刻退回首页」。
     默认焦点优先给主内容（年级卡 / 单元卡 / 玩法卡 / 选项），顶栏仍可用方向键走到。 */
  function inTopbar(el) {
    var p = el.parentNode;
    return !!(p && String(p.className || "").indexOf("topbar") >= 0);
  }
  function ensureFocus() {
    var act = document.activeElement;
    if (act && act !== document.body && act.offsetParent !== null) return; // 已有可见焦点
    if (lastFocus && lastFocus.offsetParent !== null) { focusAt(lastFocus); return; }
    var list = visibleFocusables();
    if (!list.length) return;
    var main = list.filter(function (el) { return !inTopbar(el); });
    focusAt(main[0] || list[0]);
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

    /* 观察整个 body：#app 之外还有设置弹层、升级提示条 */
    var root = document.body;
    if ("MutationObserver" in window) {
      var mo = new MutationObserver(function () {
        markFocusable(root);
        ensureFocus();
      });
      mo.observe(root, { childList: true, subtree: true });
    }

    document.addEventListener("keydown", function (e) {
      var act = document.activeElement;
      // 滑块（语速）放行方向键，交给原生调整数值
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

    window.addEventListener("load", function () { setTimeout(ensureFocus, 50); });
    // 视图切换后焦点可能落在已消失的节点上，兜底复位
    window.addEventListener("popstate", function () { setTimeout(ensureFocus, 80); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
