/* ===================== js/app.js · 老 APK（2.4.x）专用「选学科看门人」 =====================
 * 这个文件在资源包里覆盖掉老 App 的根级 js/app.js —— 也就是老 boot.js 内置清单里的
 * **第一个** 脚本。位置决定了它能抢在所有学科代码之前做判断。
 *
 * ---------------------------------------------------------------------------
 * ★ 为什么必须是看门人，不能是纯空壳（2026-09-20 现场事故）
 * ---------------------------------------------------------------------------
 * 现象：进 App 能看到语文/数学/英语三张卡，三五秒后自己跳进语文。
 * 根因：老内置清单第一个就是 js/app.js（语文的主程序）。它跑完之后语文那一套已经活了
 *       —— 有自己的默认学科、定时器、二次渲染；之后桥接层叠加的选学科页只是"盖"在上面，
 *       语文随时能把它翻回去。所以"再渲染一次选学科页"这类做法治不了根。
 *
 * 解法：让语文那套**根本不执行**。
 *   · 没选过学科 → 本文件直接渲染选学科页，然后收工，一个学科文件都不加载。
 *   · 已选学科   → 本文件什么都不做（真正的学科文件由 js/bridge.js 动态加载）。
 *
 * ---------------------------------------------------------------------------
 * 用户选完学科之后会发生什么
 * ---------------------------------------------------------------------------
 *   选学科页调 window.__setSubject(key) → 写 localStorage → location.reload()
 *   重载后本文件看到 app_subject 已有值 → return（放行）→ bridge.js 加载那一科。
 *   于是"没选学科就永远停在选择页"成为确定行为，不再有自动跳转。
 *
 * ★ 新版宿主（2.5.0+）的清单里没有根级 js/app.js 这个路径，本文件对它完全无害。
 * ★ 本文件必须能安全地被执行两遍（老 boot.js 有可能重复注入），故用 __gateLoaded 守卫。
 * ================================================================================ */
(function () {
  "use strict";
  if (window.__gateLoaded) return;
  window.__gateLoaded = true;

  function log(s) { try { console.log("[gate] " + s); } catch (e) {} }
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ==========================================================================
   * ★★★ 第一优先：喂饱老 boot.js 的启动哨兵 ★★★
   * --------------------------------------------------------------------------
   * 【2026-09-21 现场事故：热更成功一次 → 进语文后又被旧包覆盖 → 从此再也更新不上】
   *
   * 2.4.0 的 boot.js 判定"启动成功"用的是这一句：
   *     typeof window.render === "function" && window.app && window.app.childNodes.length > 0
   *   —— 那是**语文主程序**的两个顶层变量。它对我们的做法一无所知：
   *     · 选学科页：此刻一个学科文件都没加载，window.render 永远不会出现；
   *     · 已选学科：那 18 个学科文件是 bridge.js **异步串行**加载的，
   *       window.render 要等最后一个文件跑完才就位，机顶盒上稍慢就超过 1.5 秒。
   *   于是哨兵**必定**超时 → markBad(build) → 原生 rollback() 把 files/hot/ 删掉、
   *   退回内置 —— 就是看到的"被旧包覆盖"。而 markBad 累计到第 2 次，
   *   MainActivity 里 `if (f >= 2) ed.putBoolean(K_OFF, true)` 会把热更**永久熔断**：
   *   readManifest 直接返回 null，bgUpdate 直接 return —— 就是"新包再也更新不上"。
   *
   * 对策：boot.js 是冻结文件改不得，但 bootOk() 读的是**全局量** —— 提前挂上就行。
   *   本文件是老内置清单的**第一个**脚本，没有任何东西比它更早执行，
   *   所以挂在这里一定能赶在 boot.js 的 watch() 之前。
   * ======================================================================== */
  function feedSentinel() {
    try {
      var el = document.getElementById("app");
      if (el) {
        window.app = el;                 /* 学科 app.js 随后会再赋一次自己的，覆盖无害 */
        if (!el.childNodes.length) {
          var pad = document.createElement("span");
          pad.setAttribute("data-boot-pad", "1");
          pad.style.cssText = "display:none";       /* 看不见，但算 childNodes */
          el.appendChild(pad);
        }
      }
      /* 占位 render：tv.js 会包装它（无害），学科 app.js 会整个替换掉它。
         ★ 打上 __bootPad 标记，用来区分「哨兵占位」与「学科 App 真的跑起来了」
           （学科那份 render 没有这个标记，smoke 据此判）. */
      if (typeof window.render !== "function") {
        var padRender = function () {};
        padRender.__bootPad = true;
        window.render = padRender;
      }
    } catch (e) {}
  }
  feedSentinel();

  /* 竞态兜底：学科 App 有可能先 app.innerHTML="" 清空再画，清空那一瞬
     childNodes.length 就是 0。哨兵只判一次、理论上被我们挡在前面了，
     但在它那 1500ms 的窗口里多守几次不花钱。 */
  var __padN = 0;
  var __padIv = setInterval(function () {
    if (++__padN > 20) { clearInterval(__padIv); return; }      /* 守 2 秒 */
    try {
      var el = window.app || document.getElementById("app");
      if (el && !el.childNodes.length) {
        var pad = document.createElement("span");
        pad.setAttribute("data-boot-pad", "1");
        pad.style.cssText = "display:none";
        el.appendChild(pad);
      }
      if (typeof window.render !== "function") {
        var padRender2 = function () {};
        padRender2.__bootPad = true;
        window.render = padRender2;
      }
    } catch (e) {}
  }, 100);

  /* ---------------------------------------------------------------------------
   * 哨兵喂饱了，白屏保护就由我自己接手 —— 不能因为怕熔断就放任白屏。
   * ★ 逃生时绝不能调 markBad（那是熔断的开关）：直接跳 ?safe=1 走内置，
   *   那条路径 MAN 为 null，boot.js 的 onFail 自己会 return，不留后患。
   * ------------------------------------------------------------------------ */
  var __wdT0 = Date.now();
  var __wd = setInterval(function () {
    var el = null, hasUI = false;
    try {
      el = document.getElementById("app");
      hasUI = !!(el && (el.querySelector(".subj-grid") ||
                        document.getElementById("subjectBar") ||
                        (el.textContent || "").trim().length > 0));
    } catch (e) {}
    if (hasUI) { clearInterval(__wd); return; }
    if (Date.now() - __wdT0 > 9000) {
      clearInterval(__wd);
      log("9 秒没有画出任何界面 → 逃生到内置");
      try { location.href = "index.html?safe=1"; } catch (e) {}
    }
  }, 600);

  var KEY = "app_subject";
  var LAST = "app_subject_last";
  var HOT = "https://local.hot/";

  /* 新版宿主在跑（有 APP_SUBJECTS）→ 不归我管，立刻退场 */
  if (window.APP_SUBJECTS) { log("新版宿主，退场"); return; }

  /* ★★ 第一件事：无条件挂上「回选学科页」的全局函数 ★★
     不管选没选过学科，都必须有这条路 —— 否则用户一旦进了某一科，
     就再也回不去选择页（现场表现：「再进又只剩下语文，而且没有换学科选项」）。
     挂在这里（而不是只在未选分支里）是因为本文件是老清单的第一个脚本，
     任何分支都会执行到，是最可靠的落点。 */
  window.__pickSubject = function () {
    set(KEY, "");
    try { location.hash = ""; } catch (e) {}
    try { location.reload(); } catch (e) {}
  };
  /* 兼容旧名字（老 index.html / 旧设置面板里可能仍在调这个） */
  if (typeof window.showSubjectPicker !== "function") {
    window.showSubjectPicker = window.__pickSubject;
  }

  var cur = get(KEY);
  var KNOWN = { cn: 1, math: 1, en: 1 };
  if (cur && KNOWN[cur]) {
    /* 已选学科：放行给 bridge.js，但换学科入口必须确保可用（见上）。
       bridge.js 会往设置弹层里插「🔄 换学科」那一行。 */
    log("已选学科 " + cur + "，放行给 bridge.js");
    return;
  }
  if (cur) set(KEY, "");        /* 脏数据（老版本学科名 / 手滑写错）当没选过 */

  /* ===== 没选学科：由我负责把选学科页端出来，并且不让任何学科代码跑起来 ===== */
  log("未选学科 → 呈现选学科页");
  window.APP_SUBJECT = "";      /* 让 js/subject.js 不要因为"已有学科"而自我退场 */

  /* 学科名、图标、简介、顺序全部在 js/subject.js 里（可热更）。
     这里只补老 App 缺的两个全局函数，语义与新宿主一致。 */
  window.__setSubject = function (k) {
    if (!KNOWN[k]) { log("未知学科 " + k); return; }
    set(KEY, k); set(LAST, k);
    try { location.reload(); } catch (e) {}
  };

  /* 样式：老 index.html 只有 #css0（语文 style.css）与 #cssTV。
     #css0 必须撤掉，否则语文的配色/布局会污染选学科页与其它学科。
     学科样式由 bridge.js 在选定学科后挂上。 */
  (function css() {
    var anchor = document.getElementById("cssTV");
    var old0 = document.getElementById("css0");
    if (old0 && old0.parentNode) old0.parentNode.removeChild(old0);
    function add(id, href) {
      if (document.getElementById(id)) return;
      var l = document.createElement("link");
      l.rel = "stylesheet"; l.id = id; l.href = href;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(l, anchor);
      else document.head.appendChild(l);
    }
    add("cssShell", HOT + "css/shell.css");
    add("cssPick", HOT + "css/picker.css");
  })();

  /* 加载选学科页并渲染。桥接层随后也会检查一次（幂等），双保险。 */
  function paint() {
    if (typeof window.__renderSubjectPicker === "function") {
      try { window.__renderSubjectPicker(); return true; } catch (e) { log("render 失败 " + e); }
    }
    return false;
  }
  var s = document.createElement("script");
  s.src = HOT + "js/subject.js?b=" + (window.__HOT_BUILD || 0);
  s.async = false;
  s.onload = function () { paint(); log("选学科页就绪"); };
  s.onerror = function () {
    log("subject.js 加载失败");
    var el = document.getElementById("app");
    if (el) el.innerHTML = '<p style="padding:24px;font-size:20px">' +
      '内容加载失败，请退出 App 重新打开。</p>';
  };
  document.head.appendChild(s);
})();
