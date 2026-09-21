/* ===================== 电视 / 遥控器（D-pad）适配 · 三科共用 =====================
 * 仅在 TV 模式下启用；手机、平板、桌面浏览器完全不受影响。
 *
 * 【为什么只有这一份】三科的遥控器逻辑必须是同一套 —— 返回键认不全、
 * 焦点困在滑块里这类问题不会挑学科。语文修好了、数学英语还留着旧版 128 行的
 * 残次实现（连返回键都没接管），用户切换学科就会以为「又坏了」。
 * 放在宿主层还有一个好处：一次热更同时修好三科。
 *
 * 它依赖的学科侧接口全部用 typeof 保护，缺哪个就跳过哪步：
 *   window.closeTopLayer  关闭设置弹层（三科 app.js 都要有）
 *   window.__gameExit      玩法自行收尾：清计时器、停朗读
 *   window.tvBack          页面级返回
 *   window.closeSettings   兜底关设置
 *   window.TV_TUNE         显示调参（js/tv-tune.js，缺了就走内置默认值）
 * 反过来也有一条硬约束：哪一科的 app.js 没提供 closeTopLayer，返回键就只会退页面、
 * 关不掉设置弹层 —— 症状跟没修一模一样。三科的 closeTopLayer 必须对得上。
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
    if (location.hash.indexOf("phone") >= 0) return false;   // 反向开关：强制按手机版渲染
    /* ★★ 2026-09-21 现场事故：触屏「电视一体机」上整个电视版布局全废 ★★
       现象：语文/数学等界面在大屏上呈现手机布局 —— 卡片小、散落、被拉伸。
       根因链：
         ① 这台设备是触屏一体机（用户用手指点屏），系统既不是
            UI_MODE_TYPE_TELEVISION、也没有 LEANBACK 特性，但**有触屏** →
            原生桥 isTV() 三重判定全落空 → 返回 false；
         ② boot.js 据此把 body 判成 phone（sw=361 < 600，361 是 16:9 的短边 dp，本身没错）；
         ③ 本文件原先第 34 行 `if (typeof DEV.tv === "boolean") return DEV.tv;`
            —— 直接采信原生桥的 false 就早退，下面的 UA / 几何兜底全都轮不到；
         ④ 于是 body.tv 从来没被加上，css/tv.css 里所有 body.tv 规则一条都不生效。
       ⚠️ boot.js 加 class 那一步改不了（冻结文件），但**在这里可以补**：
          只要判定为 TV，本文件就会执行 document.body.classList.add("tv")（第 48 行）。
       修法：原生桥说 false 时**不直接采信**，再用几何特征复核一遍 ——
          「横屏 + 屏幕够大 + 宽高比接近 16:9」是电视/一体机的强特征，
          手机平板横屏时通常也满足宽高比，但屏幕物理尺寸不足以达到下面的阈值。 */
    if (typeof DEV.tv === "boolean" && DEV.tv) return true;  // 桥说是 TV → 直接信
    /* 桥说不是（或压根没有桥）→ 几何复核。
       阈值取「物理像素」；判定条件：屏幕够大（短边 dp ≥ 600 或物理短边 ≥ 900px）
       且宽高比在 1.4~2.0 之间（16:9=1.78、16:10=1.6）—— 手机竖屏必被排除。
       可用 TV_TUNE.tvForce = false 关闭这条兜底（个别设备误判时）。 */
    try {
      var tt = (typeof window.TV_TUNE === "object" && window.TV_TUNE) || {};
      if (tt.tvForce !== false) {
        var dpr = window.devicePixelRatio || 1;
        var sw = window.screen ? (window.screen.width || 0) : 0;
        var sh = window.screen ? (window.screen.height || 0) : 0;
        var iw = window.innerWidth || 0, ih = window.innerHeight || 0;
        var pw = Math.max(sw, sh), ph = Math.min(sw, sh);
        if (pw <= 0) { pw = Math.max(iw, ih) * dpr; ph = Math.min(iw, ih) * dpr; }
        var wide = pw / (ph || 1);
        var bigShort = (DEV.sw >= 600) || (ph >= 900);
        if (bigShort && wide >= 1.4 && wide <= 2.0) return true;
      }
    } catch (e) {}
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
  /* boot.js 拿到的是原生桥的判定结果，触屏一体机上会被判成 phone（见 detectTV 注释）。
     这里既然复核出是 TV，就把 phone/tablet 摘掉，避免两套 class 语义打架。
     （当前没有 .phone 的 CSS 规则，但 body.tablet 有 —— 摘掉更干净。） */
  try { document.body.classList.remove("phone"); document.body.classList.remove("tablet"); } catch (e) {}

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

    /* ★★ 双重乘 dpr —— 2026-09-20 修（这是"比例整体偏大"的真正主因）★★
       原写法：
         vw/vh = innerWidth/innerHeight × dpr      ← 已经是物理像素了
         w     = max(vw, screen.width × dpr)       ← screen.width 本来就是物理像素，又乘一次
       而 tiers 的阈值（3000/2300/1700/1100）是按物理像素写的。
       1080p 电视实况：innerWidth=960、dpr=2、screen.width=1920
         vw = 960×2 = 1920           ← 对的，就是 1080p
         w  = max(1920, 1920×2=3840) ← 3840！被当成 4K
       于是 1080p 命中 [3000,1700,2.2] 这一档，缩放给到 2.2 而不是 1.5 ——
       整体大了近 50%，配上容器宽度的问题就成了现场那副"撑爆、被裁"的样子。
       Android TV / Fire TV 的 screen.width 返回的就是物理像素，不需要再乘 dpr；
       真正需要乘 dpr 还原物理分辨率的只有 innerWidth/innerHeight 那一对。
       ★ 结论：screen 只是"最后一道保险"，且必须与 vw/vh 同一个物理量纲 —— 不再乘 dpr。 */
    var dpr = T.dprFix === false ? 1 : (window.devicePixelRatio || 1);
    var vw = (window.innerWidth || 0) * dpr, vh = (window.innerHeight || 0) * dpr;
    var w = Math.max(vw, window.screen ? (window.screen.width || 0) : 0);
    var h = Math.max(vh, window.screen ? (window.screen.height || 0) : 0);

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

  /* 包装 window.render。抽成函数有两个调用点：
       ① init() —— 正常加载顺序下（App 先加载、tv.js 后加载）用；
       ② window.__tvRearmRender() —— 桥接加载器动态加载学科 App 时用。
     ★ 为什么必须有 ②：那一科的 app.js 是 tv.js 跑完之后才被 <script> 塞进来的，
       此刻 window.render 才第一次出现。少了这一步，遥控器/机顶盒上每次切页都不会复位焦点 ——
       表现是「进到新界面，光标还停在角落里的按钮上」。*/
  function wrapRender() {
    if (typeof window.render !== "function" || window.__tvRenderWrapped) return;
    window.__tvRenderWrapped = true;
    var origRender = window.render;
    window.render = function () {
      var r = origRender.apply(this, arguments);
      lastFocus = null;                       // 旧焦点属于上一个页面，别再复用
      setTimeout(function () { ensureFocus(true); }, 0);
      return r;
    };
    try {
      /* 把"这是哨兵占位"的标记透传下去（见 legacy/js/app.js 的 feedSentinel）：
         老 APK 上 window.render 一开始只是个占位空函数，tv.js 包一层之后它就
         变了个样子。标记留着，测试才能分辨"占位"和"学科 App 真的在跑"。 */
      if (origRender && origRender.__bootPad) window.render.__bootPad = true;
    } catch (e) {}
  }
  /* 重新触发入口：清掉标记再包一次。重复调用不会套两层包装。 */
  window.__tvRearmRender = function () {
    window.__tvRenderWrapped = false;
    wrapRender();
    try { markFocusable(document); } catch (e) {}
  };

  /* ===================== 显示尺寸实测（自检面板用） =====================
     电视上没有控制台，比例出问题时用户只能描述"两边有缝""字被切"，
     排查全靠猜。这里把真实生效值读成一段 HTML，塞进各科的热更自检面板 ——
     一次热更就能让用户把诊断数据读给我们。
     ★ 只读、不改任何样式，纯诊断，出问题也不影响使用。
     ★ 测的是 getComputedStyle 的实际生效值，不是我们写进去的输入值：
       三科样式表叠加后到底谁赢了，只有这里能看出来。 */
  window.tvDiagHtml = function () {
    try {
      var el = document.getElementById("app");
      if (!el) return "(找不到 #app)";
      var cs = window.getComputedStyle(el);
      var isTv = document.body.classList.contains("tv");
      var dpr = window.devicePixelRatio || 1;
      var scw = window.screen ? (window.screen.width || 0) : 0;
      var sch = window.screen ? (window.screen.height || 0) : 0;
      var pw = Math.max(scw, sch), ph = Math.min(scw, sch);
      var wide = ph ? (Math.round((pw / ph) * 100) / 100) : 0;
      var s = window.getComputedStyle(document.documentElement)
                .getPropertyValue("--s").trim() || "(未设)";
      var vw = window.innerWidth, vh = window.innerHeight;
      var boxW = el.getBoundingClientRect().width;
      var over = boxW - vw;
      return '电视版样式：' + (isTv
          ? '<span style="color:#0a0;font-weight:700">✅ 已启用（body.tv 已加上，css/tv.css 生效）</span>'
          : '<span style="color:#d33;font-weight:700">❌ 未启用 —— 大屏上会按手机布局渲染，' +
            '请在地址后加 #tv 或反馈此页</span>') + '<br>' +
        '视口：' + vw + ' × ' + vh + ' CSS px　dpr=' + dpr + '<br>' +
        '屏幕：' + scw + ' × ' + sch + '　宽高比=' + wide + '（原判定 sw=' + ((DEV && DEV.sw) || 0) + '）<br>' +
        '--s（整体缩放）：<span style="font-weight:700">' + s + '</span><br>' +
        '容器实测宽：' + Math.round(boxW) + 'px　max-width=' + cs.maxWidth +
        '　padding=' + cs.padding + '<br>' +
        '横向溢出：' + (over > 1
          ? '<span style="color:#d33;font-weight:700">⚠️ 超出 ' + Math.round(over) +
            'px —— 两侧会被裁出竖缝，请把这一行反馈</span>'
          : '<span style="color:#0a0;font-weight:700">✅ 无（容器未超出视口）</span>');
    } catch (e) { return '(取不到显示参数: ' + e.message + ')'; }
  };

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
    wrapRender();

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
       顺序很重要：**先让玩法自己收尾**（清计时器、停朗读），再退页面 ——
       否则玩法里的 setInterval 会继续跑，几秒后把界面又刷回游戏里。 */
    var BACK_KEY = { Escape: 1, Backspace: 1, GoBack: 1, BrowserBack: 1 };
    /* 各家机顶盒的返回键没有一个统一的 DOM keyCode，实测见过的：
         4 (Android KEYCODE_BACK)、461 (SMART-TV 的 "返回")、166 (部分盒子的 "通道返回")、
         0 + key="Unidentified"（中兴/华为部分 IPTV 盒子）……
       只认 4 会让「设置弹层按返回关不掉」——用户只能摸索到「完成」按钮去关。
       这里把已知形态全列上，并额外接纳「keyCode 为 0 且浏览器也说不出键名」的情况。 */
    var BACK_CODE = { 4: 1, 461: 1, 166: 1 };
    /* 按下与抬起会成对到达，用于给 keyup 兜底去重（见文末 keyup 监听）。 */
    var lastBackAt = 0;
    function isBack(e) {
      var kc = e.keyCode || 0;
      if (BACK_KEY[e.key]) return true;
      if (BACK_CODE[kc]) return true;
      /* keyCode 0 + Unidentified：固件把返回键吞成了未知键，
         唯一能认出来的线索就是「既没有键名也没有键码」。 */
      if (kc === 0 && e.key === "Unidentified") return true;
      /* 老 WebView 只有 keyIdentifier（Esc 是 U+001B）。 */
      try { if (String(e.keyIdentifier || "") === "U+001B") return true; } catch (err) {}
      return false;
    }
    /* ★ 任何返回值风格的按键处理器都要走这一层：焦点在输入框上时，
       WebView 可能把后续的 keydown 吞掉（用于关软键盘 / 取消控件编辑）。
       这里在最前面把返回键截下来并立刻停掉冒泡，保证「身在输入框也能返回」。 */
    function tryBack(e) {
      if (!isBack(e)) return false;
      /* ★ 必须打时间戳：一次按键的 keydown/keyup 会成对到达，
         不标记的话 keyup 兜底会再关一层 —— 表现为「按一下返回，设置关了连着又退出一个页面」。 */
      lastBackAt = Date.now();
      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
      doBack();
      return true;
    }
    function doBack() {
      /* ① 最上层是弹层（设置）→ 先关它。
            不这么排，按返回会直接退掉背后的页面，而设置界面还盖在上面 ——
            用户看到的就是「返回键只能退回上一级菜单，设置关不掉」。
         ② 焦点若卡在输入框里（语速滑块 / 备份文本框），先把它摘出来，
            否则关了弹层焦点还留在已隐藏的节点上，下一个界面收不到焦点。 */
      var act = document.activeElement;
      if (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName || "")) {
        try { act.blur(); } catch (e) {}
      }
      if (typeof window.closeTopLayer === "function") {
        try { if (window.closeTopLayer()) return true; } catch (e) {}
      }
      /* ③ 玩法自己在跑 → 让它收尾（清计时器、停朗读）再退 */
      if (typeof window.__gameExit === "function") {
        try { if (window.__gameExit() !== false) return true; } catch (e) { return true; }
      }
      if (typeof window.tvBack === "function") {
        try { return window.tvBack() !== false; } catch (e) { return true; }
      }
      return false;
    }

    document.addEventListener("keydown", function (e) {
      if (tryBack(e)) return;

      var act = document.activeElement;
      /* ★ 表单控件（语速滑块 / 备份文本框 / 下拉）里不能一棍子放行。
            旧写法是 `if (act.tagName === "INPUT") return;` —— 焦点一进滑块，
            四个方向键全部被放行、导航再也不执行，用户就「困在里面出不来了」，
            只能杀进程重开（2026-09-20 用户反馈的第二个问题）。
         正确分工（与 Android TV 原生控件一致）：
            左右键 → 留给控件调数值（range 调 +/-）
            上下键 → 一律跳出，交还给焦点导航
         这样既能调语速，又永远出得去。 */
      if (act && /^(INPUT|TEXTAREA|SELECT)$/.test(act.tagName || "")) {
        var kd = e.key;
        if (kd === "ArrowUp" || kd === "ArrowDown") {
          e.preventDefault();
          try { act.blur(); } catch (err) {}
          nav(kd === "ArrowUp" ? "up" : "down");
        }
        /* 其余按键（含左右、确认）放行给控件自身 */
        return;
      }

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

    /* （去重计数 lastBackAt 已在上面声明，此处只挂监听）
       ★ keyup 兜底：部分机顶盒固件只在抬键时把返回键交给 WebView
       （按下那一刻被系统层截去做「关软键盘 / 退出控件」了），
       只听 keydown 就永远收不到 —— 表现正是「返回键完全没反应」。
       去重：同一个键的 down 已经处理过（tryBack 打过时间戳）就不再重复处理 up。 */
    document.addEventListener("keyup", function (e) {
      if (!isBack(e)) return;
      if (Date.now() - lastBackAt < 350) return;   // down/up 成对，别关两次
      lastBackAt = Date.now();
      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
      doBack();
    }, true);

    /* ★ 弹层专属的返回通道：焦点落在设置面板内部的输入框上时，
       输入框可能把 keydown 吃掉（上面 keyup 兜底之外再上一层保险）。
       直接在弹层容器上挂 capture 监听，确保弹层开着时返回一定能关掉它。 */
    document.addEventListener("keydown", function (e) {
      var m = activeModal();
      if (!m) return;
      var a = document.activeElement;
      if (!a || !m.contains(a)) return;            // 焦点不在弹层里，交给主流程
      if (!/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || "")) return;
      if (!isBack(e)) return;
      /* 同样打时间戳：这里已经把弹层关了，keyup 兜底再跑一次 doBack() 就会顺带退掉背后的页面。 */
      lastBackAt = Date.now();
      try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
      try { a.blur(); } catch (err) {}
      if (typeof window.closeSettings === "function") window.closeSettings();
    }, true);

    window.addEventListener("load", function () { setTimeout(function () { ensureFocus(true); }, 50); });
    // 视图切换后焦点可能落在已消失的节点上，兜底复位
    window.addEventListener("popstate", function () { setTimeout(function () { ensureFocus(true); }, 80); });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
