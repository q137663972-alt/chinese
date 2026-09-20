/* ===================== js/bridge.js · 老 APK 的三科桥接加载器 =====================
 * 这个文件只活在 2.4.x 及更早的 App 上 —— 那批 App 的 boot.js 里没有"学科"这回事，
 * 清单写死是 js/app.js 这种根级路径，而 boot.js 又是热更覆盖不到的冻结文件。
 *
 * 【它凭什么能工作 —— 两条口子】
 *   ① 老 boot.js 会无条件追加注入资源包里任何符合 /^js\/.+\.js$/ 的新文件：
 *        if (BUILTIN.indexOf(p) < 0 && /^js\/.+\.js$/.test(p)) out.push(...)
 *      本文件就是走这条路进来的，排在所有内置脚本之后。
 *   ② 原生虚拟域 https://local.hot/ 是按路径直读 files/hot/ 下的任意文件，不挑清单：
 *        File f = new File(getFilesDir(), "hot/" + path);
 *      所以我自己创建的 <script> / <link> 标签同样取得到三科子目录里的东西。
 *
 * 两条合起来等于：**不出新 APK，也能让老 App 换一套加载行为。**
 * 改 boot.js 那条路是不许走的（手册 §0 铁律）—— 这次走的是这儿。
 *
 * 【配套还必须有三个空壳】
 *   老的 boot.js 一定会先把语文那一整套注进来。为了不和后面加载的学科重复打架，
 *   资源包里同时顶掉了 js/app.js / js/games.js / js/game-battle.js / js/update.js
 *   （内容见同目录的几个空壳），真正干活的是本文件动态加载的那一份。
 *   不然同一份 app.js 被执行两遍，连点击监听器都会挂两份 —— 按一下走两步。
 * ============================================================================== */
(function () {
  "use strict";

  /* 新版宿主（2.5.0+）自带三科支持；本文件万一出现在那儿，立刻退场，不能两套机制并存 */
  if (window.APP_SUBJECTS) return;
  if (window.__bridgeLoaded) return;
  window.__bridgeLoaded = true;

  var KEY = "app_subject";        /* 与新版 boot.js 用同一个 localStorage 键，将来换包也不用重新选 */
  var LAST = "app_subject_last";
  var HOT = "https://local.hot/";

  /* 三科清单 —— 顺序即加载顺序，必须和 boot.js 里各科的 BUILTIN 保持一致。
     ★ tv.js / tv-tune.js 不在这里：它们由老 boot.js 的内置清单加载，
       而且资源包用同路径覆盖成了新版共享层，加载器不用操心。
     ★ 顺序里的硬约束：app.js 必须排在 tv.js 之前（tv 要包装 render），
       所以这里加载完学科文件后还要再调一次 __tvRearmRender() 补包装。 */
  var SUBJECTS = {
    cn: {
      key: "cn", dir: "cn", css: "cn/css/style.css",
      files: [
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
      ]
    },
    math: {
      key: "math", dir: "math", css: "math/css/style.css",
      files: [
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
      ]
    },
    en: {
      key: "en", dir: "en", css: "en/css/style.css",
      files: [
        "en/js/cp.js",
        "en/js/data-g1.js", "en/js/data-g2.js", "en/js/data-g3.js",
        "en/js/data-g4.js", "en/js/data-g5.js", "en/js/data-g6.js",
        "en/js/tts.js",
        "en/js/praise.js",
        "en/js/games.js",
        "en/js/app.js",
        "en/js/update.js"
      ]
    }
  };

  function log(s) { try { console.log("[bridge] " + s); } catch (e) {} }
  function get(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function set(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  /* ---------- 顺序加载：必须串行 ----------
     并发 <script> 会打乱执行顺序；而各科的 data-*.js 只是定义常量、
     app.js 却要在最后才用到它们 —— 顺序一乱就是大面积 undefined。
     ★ 单个文件失败要放过：资源包可能是旧 build 缺了新文件，
       整链中断会让 App 停在白屏，还不如带着缺的那一个继续跑。 */
  function loadSeq(files, done) {
    var i = 0;
    (function next() {
      if (i >= files.length) { done(); return; }
      var p = files[i++];
      var s = document.createElement("script");
      s.src = HOT + p;
      s.async = false;
      s.onload = function () { next(); };
      s.onerror = function () {
        log("跳过缺失文件 " + p);
        if (s.parentNode) s.parentNode.removeChild(s);
        next();
      };
      document.head.appendChild(s);
    })();
  }

  /* ---------- 样式：shell → 学科 → tv ----------
     老 index.html 只有 #css0（语文 style.css）和 #cssTV。
     #css0 必须撤掉：留着它，数学/英语的界面会被语文的配色和布局规则污染。 */
  function mountCss(subjCss) {
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
    if (subjCss) add("cssSub", HOT + subjCss);
  }

  /* ---------- 换学科入口 ----------
     老版 index.html 的设置面板里没有「🔄 换学科」这一行，跑到这里补上。
     同时挂到 window.__pickSubject —— 各科代码里约定俗成的就是这个名字。 */
  window.__pickSubject = function () {
    set(KEY, "");
    try { location.reload(); } catch (e) {}
  };
  function injectSwitchRow() {
    var card = document.querySelector("#settingsModal .modal-card");
    if (!card || document.getElementById("bridgeSwitchRow")) return;
    var row = document.createElement("div");
    row.className = "set-row";
    row.id = "bridgeSwitchRow";
    row.innerHTML = '<label>学科</label><button class="btn ghost" style="width:auto;padding:8px 12px" ' +
                    'onclick="window.__pickSubject&&window.__pickSubject()">🔄 换学科</button>';
    var h3 = card.querySelector("h3");
    if (h3 && h3.nextSibling) card.insertBefore(row, h3.nextSibling);
    else card.appendChild(row);
  }
  injectSwitchRow();
  /* 有的学科 App 会在自己的 render 里重建整个弹层，留个兜底再补一次 */
  setTimeout(injectSwitchRow, 1200);

  /* ---------- 走分区 ----------
     ★ 选学科页复用新版那份 js/subject.js（同一个文件、同一套文案与遥控器逻辑），
       这里只需要给它补上一个 __setSubject —— 老 App 里没有这个全局函数。 */
  window.__setSubject = function (k) {
    if (!SUBJECTS[k]) { log("未知学科 " + k); return; }
    set(KEY, k); set(LAST, k);
    try { location.reload(); } catch (e) {}
  };

  var cur = get(KEY);

  if (!cur || !SUBJECTS[cur]) {
    /* ===== 还没选：进选学科页 ===== */
    if (cur) set(KEY, "");          // 脏数据：写错学科名时别卡死在选择页
    mountCss(null);
    window.APP_SUBJECT = "";
    loadSeq(["js/subject.js"], function () {
      log("选学科页就绪");
    });
    return;
  }

  /* ===== 已选：按清单加载那一科 ===== */
  var subj = SUBJECTS[cur];
  window.APP_SUBJECT = cur;                 // 与新版宿主对齐，别让各科找不到上下文
  mountCss(subj.css);
  loadSeq(subj.files, function () {
    /* 学科 App 是 tv.js 跑完之后才加载的 —— window.render 此刻才第一次出现，
       必须补一次包装，否则机顶盒上每次切页焦点都不会复位。
       这也是为什么一开始就要求 app.js 排在 tv.js 之前、然后由这里兜底。 */
    try { if (window.__tvRearmRender) window.__tvRearmRender(); } catch (e) {}
    injectSwitchRow();
    /* App 自己可能已经渲染过一次（渲染完我还没包装），再渲染一次让焦点落到内容区 */
    try { if (typeof window.render === "function") window.render(); } catch (e) {}
    log("已加载学科 " + cur + "（" + subj.files.length + " 个文件）");
  });
})();
