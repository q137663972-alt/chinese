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

  /* 弹层（设置）打开时，焦点必须锁在弹层里。
     不锁的话方向键会跑到背后的页面上，按确认还会误触背景按钮 ——
     表现就是「设置界面关不掉、按返回只是退了上一级菜单」。 */
  function activeModal() {
    var m = document.getElementById("settingsModal");
    if (m && String(m.className || "").indexOf("hidden") < 0) return m;
    return null;
  }
  function scope() { return activeModal() || document; }
  function inScope(el, root) {
    if (!el) return false;
    if (root === document) return true;
    try { return root.contains(el); } catch (e) { return true; }
  }

  function markFocusable(root) {
    $all(SEL, root || document).forEach(function (el) {
      if (!el.hasAttribute("tabindex") && el.offsetParent !== null) el.setAttribute("tabindex", "0");
    });
    $all(TEXTY, root || document).forEach(function (el) { el.setAttribute("tabindex", "-1"); });
  }

  /* 取「当前作用域内」的可聚焦元素：弹层打开时只返回弹层里的 */
  function visibleFocusables() {
    return $all(SEL, scope()).filter(function (el) { return el.offsetParent !== null && !el.disabled; });
  }

  var lastFocus = null;
  var lastOkAt = 0;   // 确认键防抖时间戳

  /* 电视没有手指滚动：焦点跳到屏幕外的元素时必须把它拉回视野，
     否则「焦点在下面但看不见」，表现为按钮像被切掉了。
     这里自己算 scrollTop（不用 scrollIntoView 的参数形式 —— 老 WebView 不认 options）。 */
  function ensureVisible(el) {
    if (!el) return;
    try {
      var box = document.getElementById("app");
      if (!box) return;
      var r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
      var pad = Math.round((window.innerHeight || 720) * 0.06);
      if (r.top < b.top + pad) box.scrollTop -= Math.ceil(b.top + pad - r.top);
      else if (r.bottom > b.bottom - pad) box.scrollTop += Math.ceil(r.bottom - (b.bottom - pad));
    } catch (e) {}
  }
  function focusAt(el) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
    lastFocus = el;
    setTimeout(function () { ensureVisible(el); }, 0);
  }

  /* 顶栏（返回 / 设置）不能当默认焦点：
     页面 HTML 以 topbar 开头，若按「第一个可聚焦元素」取焦点，进子页面时焦点
     会落在「←」上 —— 遥控器一按确认就执行了返回，表现为「点进年级页立刻退回首页」。
     默认焦点优先给主内容（年级卡 / 单元卡 / 玩法卡 / 选项），顶栏仍可用方向键走到。 */
  /* 向上找若干层：gear 按钮可能被包一层（<div class="topbar"><div><button class="gear">），
     只看直接父节点会漏判，焦点就又落在设置上了。
     不用 closest() —— 部分老 WebView 上行为不一，手写遍历最稳。 */
  function inTopbar(el) {
    var p = el, i = 0;
    while (p && p.nodeType === 1 && i < 5) {
      if (p.classList && p.classList.contains("topbar")) return true;
      if (String(p.className || "").indexOf("topbar") >= 0) return true;
      p = p.parentNode; i++;
    }
    return false;
  }
  function ensureFocus(force) {
    var root = scope();
    if (!force) {
      var act = document.activeElement;
      /* 已有焦点且在作用域内就别动它 —— 否则每次 DOM 变动都会把用户的焦点抢走。
         但「在作用域内」这个条件很关键：刚关掉设置弹层时 activeElement 还在弹层里，
         不判就会一直认为「已经有焦点」，新页面的焦点永远设不上 ——
         这就是「进了新界面，光标还停在设置按钮上」。 */
      if (act && act !== document.body && act.offsetParent !== null && inScope(act, root)) return;
      if (lastFocus && lastFocus.offsetParent !== null && inScope(lastFocus, root)) { focusAt(lastFocus); return; }
    }
    var list = visibleFocusables();
    if (!list.length) return;
    /* 弹层里：直接落在第一个可操作元素（朗读开关），不要跑到背景页面去 */
    if (root !== document) { focusAt(list[0]); return; }
    var main = list.filter(function (el) { return !inTopbar(el); });
    /* 答题界面：默认焦点直接落在第一个答案选项上，遥控器不用先跨过题干；
       选择类界面（年级/单元/玩法）没有 .opt，就落在第一张卡片上。 */
    var opts = main.filter(function (el) { return el.classList && el.classList.contains("opt"); });
    focusAt(opts[0] || main[0] || list[0]);
  }

  /* TV 尺度：720p / 1080p / 2K / 4K 盒子差异极大，固定 px 在 4K 上小到看不见、
     在 720p 上又撑出屏幕。按实测视口分档写入 --s，CSS 侧用 calc(基础 × --s) 缩放。
     另外两个「必须一屏放下」的尺寸由这里直接算成 px：
       --tian 田字格边长、--pic 主视觉图边长
     它们取 min(按 --s 放大的尺寸, 视口高度占比)，**不能用 CSS 的 min()** ——
     安卓 8 的 WebView 会把整条声明丢掉，田字格就会塌掉、底部按钮被顶出屏幕。

     【按物理分辨率分档】电视上的 WebView 普遍把 CSS 视口报成物理的一半：
       1080p 电视 = 960×540 CSS px（devicePixelRatio=2）、4K = 1920×1080 CSS px。
     直接拿 CSS px 分档会把 1080p 当成 720p、4K 当成 1080p，UI 整体偏小一档
     （Fire TV / Shield 等实测都是这样，见 StackOverflow「Full resolution WebView
     on Android TV」）。这里乘以 devicePixelRatio 还原物理分辨率再分档 ——
     与 Android TV 官方按物理档位给 dp 资源的做法一致。 */
  function applyScale() {
    /* 全部取值都过 num()：tv-tune.js 缺失、字段写错、热更包没下发，
       都只是退回内置默认显示，绝不白屏也不会 NaN。 */
    var T = (typeof window.TV_TUNE === "object" && window.TV_TUNE) || {};
    function num(v, d) { return (typeof v === "number" && isFinite(v)) ? v : d; }

    var dpr = T.dprFix === false ? 1 : (window.devicePixelRatio || 1);
    var vw = (window.innerWidth || 0) * dpr, vh = (window.innerHeight || 0) * dpr;
    var w = Math.max(vw, window.screen ? (window.screen.width || 0) * dpr : 0);
    var h = Math.max(vh, window.screen ? (window.screen.height || 0) * dpr : 0);

    var DEF_TIERS = [[3000, 1700, 2.2], [2300, 1300, 1.8], [1700, 950, 1.5], [1100, 620, 1.25]];
    var tiers = (T.tiers && T.tiers.length) ? T.tiers : DEF_TIERS;
    var s = num(T.base, 1.2);
    for (var i = 0; i < tiers.length; i++) {
      var t = tiers[i] || [];
      if (w >= num(t[0], Infinity) || h >= num(t[1], Infinity)) { s = num(t[2], s); break; }
    }
    var force = num(T.forceScale, 0);
    if (force > 0) s = force; else s = s * num(T.scaleK, 1);
    s = Math.min(Math.max(s, num(T.minScale, 0.7)), num(T.maxScale, 3));

    var st = document.documentElement.style;
    st.setProperty("--s", String(s));
    var vhp = (window.innerHeight || 720);
    st.setProperty("--tian", Math.round(Math.min(num(T.tianK, 340) * s, vhp * num(T.tianMaxVh, 0.42))) + "px");
    st.setProperty("--pic", Math.round(Math.min(num(T.picK, 260) * s, vhp * num(T.picMaxVh, 0.34))) + "px");
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

    /* 左右键的「同排优先」：方向键默认取几何最近邻，
       但顶栏按钮（← / 标题 / 🛠️ / ⚙️）与主内容不在同一水平带，
       纯距离算分时，同一排的相邻按钮可能输给下方更靠左的大卡片 ——
       表现就是「想去顶栏的热更/设置按钮，按左右却总在下面几排跳」。
       这里给同一水平带的元素一个显著加权，保证左右键先走完同一排。
       只影响左右键，上下键逻辑不变。 */
    var hRow = Math.max(24, r0.height * 0.9);
    var sameRowBoost = (dir === "left" || dir === "right") ? 0.35 : 1;

    /* 【上下键补丁 · 2.4.1】顶栏（← / 🛠️ / ⚙️）在最上方，从主内容按「上」时
       最近邻会先跳到紧贴顶栏的大卡片，用户要连按好几次才够得着顶栏 ——
       机上表现就是「热更/设置按钮在顶上够不到」。
       这里只在「还没跨过顶栏」的前提下让上键优先吸附顶栏：
       当前元素在顶栏下沿以下、且存在横向重叠的顶栏按钮时，直接把焦点交给它。
       横向不重叠的（例如左下角按钮）不受影响，仍按就近原则走。 */
    if (dir === "up") {
      var bars = $all("#app .topbar");
      for (var bi = 0; bi < bars.length; bi++) {
        var bar = bars[bi];
        if (bar.offsetParent === null) continue;
        var br = bar.getBoundingClientRect();
        if (r0.top < br.bottom - 2) continue;        // 已经在顶栏里/之上了
        var cands = $all(".gear, .back", bar).filter(function (el) {
          if (el.offsetParent === null || el === cur) return false;
          var cr = el.getBoundingClientRect();
          return cr.left < r0.right && cr.right > r0.left;   // 横向有重叠
        });
        if (cands.length) {
          /* 多个候选时取横向最接近的（例如从右下方按上 → 先够到 ⚙️ 而不是 🛠️） */
          var pick = cands[0], pd = Infinity;
          cands.forEach(function (el) {
            var cr = el.getBoundingClientRect();
            var d = Math.abs((cr.left + cr.width / 2) - cx);
            if (d < pd) { pd = d; pick = el; }
          });
          focusAt(pick);
          return;
        }
      }
    }

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
      var score = primary + cross * 2.2 * (Math.abs(dy) <= hRow ? sameRowBoost : 1);
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
    /* 告诉原生壳：遥控器按键由 WebView 里的 tv.js 接管了。
       MainActivity.dispatchKeyEvent 原本在 ACTION_UP 时自己再 click() 一次，
       与这里的 keydown 处理叠加就成了「按一下点两下」—— 有这个标记它就退让。 */
    window.__tvKeyHandled = true;
    applyScale();
    window.addEventListener("resize", applyScale);
    markFocusable(document);
    ensureFocus();

    /* 每次视图切换后，强制把焦点放回主内容。
       不包装的话：切页时旧的 activeElement 可能还在（尤其刚从设置弹层出来），
       ensureFocus 一看「已经有焦点」就直接跳过 ——
       表现就是「进了新界面，光标还停在设置按钮上」。 */
    if (typeof window.render === "function" && !window.__tvRenderWrapped) {
      window.__tvRenderWrapped = true;
      var origRender = window.render;
      window.render = function () {
        var r = origRender.apply(this, arguments);
        lastFocus = null;                       // 旧焦点属于上一个页面，别再复用
        setTimeout(function () { ensureFocus(true); }, 0);
        return r;
      };
    }

    /* 观察整个 body：#app 之外还有设置弹层、升级提示条。
       额外监听 class 变化 —— 弹层开关就是切一个 class，
       只听 childList 的话弹层打开时焦点根本不会进去。 */
    var root = document.body;
    if ("MutationObserver" in window) {
      var mo = new MutationObserver(function () {
        markFocusable(root);
        ensureFocus();
      });
      try {
        mo.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
      } catch (e) {
        mo.observe(root, { childList: true, subtree: true });   // 老 WebView 不认 attributeFilter
      }
    }

    /* 返回键：遥控器上的「返回 / 退出」。
       真机上一般由 MainActivity.onKeyDown(KEYCODE_BACK) 直接调 window.tvBack()，
       这里兜住浏览器预览与部分把按键透传到 WebView 的盒子。
       顺序很重要：**先让玩法自己收尾**（清计时器、停朗读），再退页面 ——
       否则玩法里的 setInterval 会继续跑，几秒后把界面又刷回游戏里。 */
    var BACK_KEY = { Escape: 1, Backspace: 1, GoBack: 1, BrowserBack: 1 };
    function isBack(e) {
      var kc = e.keyCode || 0;
      return !!(BACK_KEY[e.key] || kc === 4 || kc === 461 || kc === 166);
    }
    function doBack() {
      /* ① 最上层是弹层（设置）→ 先关它。
            不这么排，按返回会直接退掉背后的页面，而设置界面还盖在上面 ——
            用户看到的就是「返回键只能退回上一级菜单，设置关不掉」。 */
      if (typeof window.closeTopLayer === "function") {
        try { if (window.closeTopLayer()) return true; } catch (e) {}
      }
      /* ② 玩法自己在跑 → 让它收尾（清计时器、停朗读）再退 */
      if (typeof window.__gameExit === "function") {
        try { if (window.__gameExit() !== false) return true; } catch (e) { return true; }
      }
      if (typeof window.tvBack === "function") {
        try { return window.tvBack() !== false; } catch (e) { return true; }
      }
      return false;
    }

    document.addEventListener("keydown", function (e) {
      if (isBack(e)) { e.preventDefault(); doBack(); return; }

      var act = document.activeElement;
      // 滑块（语速）放行方向键，交给原生调整数值
      if (act && act.tagName === "INPUT") return;

      var k = e.key;
      if (k === "ArrowLeft") { e.preventDefault(); nav("left"); }
      else if (k === "ArrowRight") { e.preventDefault(); nav("right"); }
      else if (k === "ArrowUp") { e.preventDefault(); nav("up"); }
      else if (k === "ArrowDown") { e.preventDefault(); nav("down"); }
      else if (k === "Enter" || k === " " || e.keyCode === 13 || e.keyCode === 23 || e.keyCode === 66) {
        /* 三重防护，缺一个都会漏出「按一次点两下」：
           ① e.repeat —— 安卓固件按住 OK 会持续发 keydown（长按连发），必须丢掉；
           ② 220ms 防抖 —— 部分遥控器一次按下会补发第二个 keydown；
           ③ 自己 click 并 preventDefault —— 以前对 <button> 是 return 交给浏览器，
              浏览器默认 click 与某些固件补发的事件叠加就成了两次
              （设置开关被点两次 = 开了又关，看着像失灵）。
           只防确认键：方向键的长按连发必须保留，否则遥控器连续移动会卡顿。 */
        if (e.repeat) { e.preventDefault(); return; }
        var now = Date.now();
        if (now - lastOkAt < 220) { e.preventDefault(); return; }
        lastOkAt = now;
        if (act && act !== document.body) {
          e.preventDefault();
          try { act.click(); } catch (err) {}
        }
      }
    }, true);

    document.addEventListener("keydown", unlockOnce, true);
    document.addEventListener("click", unlockOnce, true);

    window.addEventListener("load", function () { setTimeout(function () { ensureFocus(true); }, 50); });
    // 视图切换后焦点可能落在已消失的节点上，兜底复位
    window.addEventListener("popstate", function () { setTimeout(function () { ensureFocus(true); }, 80); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
