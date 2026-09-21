/* ===================== 知识圈 / 吃鸡玩法（可热更 · 数学场） =====================
 * 1 真人 + 6 AI 的答题生存赛：答对 +1 分，答错/超时 -1 星，星掉光回教室休息。
 * 与语文场（cn/js/game-battle.js）同一套规则、同一套骨架，只有题库不同：
 *   语文出题 = 汉字/拼音/笔画   → 数学出题 = genQ()/genV() 参数化出题器
 *
 * 【加载链路（为什么只加这一个文件就够）】
 *   tools/gen-pack.mjs 会扫到 <学科>/js/game-*.js，读出 registerGame 的 id 写进
 *   manifest 的 games[]；boot.js 的 planFiles() 把玩法文件插在本学科 games.js 之后
 *   注入（registerGame 已在 games.js 里定义好），所以首页会自己多一个入口。
 *   boot.js 是冻结文件，这里一个字都不用改它 —— 纯热更，不出 APK。
 *
 * 【四条铁律】（前三条是语文场真机踩过的坑，改这个文件时别破坏）
 *   1. 渲染函数只能叫 battleRender，绝不能叫 render。
 *      叫 render 会遮蔽 app.js 的全局视图 render，退出时本想回玩法列表却调回
 *      自己（那时状态已清空）直接抛异常，界面卡死在游戏里。
 *   2. 所有 setTimeout / setInterval 必须走 later() / every()。
 *      它们带会话令牌 runId + 页面归属检查 stillMine()：退出或页面被别的视图顶掉后，
 *      在途回调一律自行了断 —— 否则「退出后又自动跳回游戏」就是这么来的。
 *   3. 拼进 HTML 的值一律过 T()。
 *      机顶盒上出现过整屏 undefined（数据层没装配好时字段取空），
 *      T() 把 undefined/null/NaN 全换成空串，setApp 再做一次兜底清理。
 *   4. 退出必须走 battleStop()：runId++ 作废在途回调 + 清计时器 + 停朗读 + 摘钩子。
 * ==================================================================== */
(function () {
  if (typeof registerGame !== "function") return; /* games.js 没加载时不注册，安全降级 */

  var SKILL = 0.72;          /* AI 单题正确率（控制淘汰节奏） */
  var TOTAL_Q = 8;           /* 单局题数 */
  var BASE_TIME = 15;        /* 初始每题秒数（数学要算，比语文多给 3 秒） */
  var MIN_TIME = 10;         /* 缩圈最低秒数 */
  var START_STARS = 4;       /* 初始能量星 */
  var AI_NAMES = ["小明", "小红", "乐乐", "糖糖", "豆豆", "奇奇"];
  var AI_EMOJI = ["🧑", "👧", "🧒", "👦", "🐯", "🐰"];

  /* 兜底出题参数：数据层万一没装配好（内容包没拉到、单元结构变了、某些机顶盒上
     window.DATA 是空的），宁可用一年级这几个最稳的题型开局，也绝不能让界面出现
     undefined 或空题。手机端一直正常、机顶盒 undefined 就是这么兜住的。 */
  var FALLBACK_GEN = [
    { t: "addsub", max: 10 }, { t: "addsub", max: 20 },
    { t: "compare" }, { t: "addsub2" }, { t: "mul1" }
  ];

  var GENPOOL = [];          /* 本年级可用出题参数（当前单元排在最前） */
  var CURTIP = "";           /* 当前单元的学习提示，用作发射器提示文案 */

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return (a && a.length) ? a[rnd(a.length)] : null; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function idx(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return i; return -1; }

  /* 安全取值：undefined / null / NaN / "undefined" 一律退化成空串 */
  function T(x) {
    if (x === undefined || x === null) return "";
    var s;
    try { s = String(x); } catch (e) { return ""; }
    if (s === "undefined" || s === "null" || s === "NaN" || s === "[object Object]") return "";
    return s;
  }
  function num(x, d) { var n = Number(x); return (isFinite(n) ? n : (d || 0)); }

  /* ---------- 题库装配 ---------- */
  function buildBank() {
    GENPOOL = [];
    CURTIP = "";
    var grades = (window.DATA && window.DATA.grades) || window.GRADES || [];
    if (!grades || typeof grades.length !== "number") grades = [];
    var gi = 0, bi = 0, ui = 0;
    try { if (typeof state !== "undefined" && state) { gi = num(state.gi, 0); bi = num(state.bi, 0); ui = num(state.ui, 0); } } catch (e) {}
    var g = grades[gi] || grades[0] || null;
    /* 当前单元的 gen 排在最前：知识圈首先是「复习本单元」，再拿本年级其它单元掺着考 */
    try {
      if (g && g.books && g.books[bi] && g.books[bi].u && g.books[bi].u[ui]) {
        var cu = g.books[bi].u[ui];
        if (cu && cu.gen) GENPOOL.push(cu.gen);
        CURTIP = T(cu && cu.tip);
      }
    } catch (e) {}
    try {
      if (g && g.books) for (var b = 0; b < g.books.length; b++) {
        var us = (g.books[b] && g.books[b].u) || [];
        for (var u = 0; u < us.length; u++) if (us[u] && us[u].gen) GENPOOL.push(us[u].gen);
      }
    } catch (e) {}
    if (!GENPOOL.length) GENPOOL = FALLBACK_GEN.slice();
  }

  /* 最后一档兜底：连 genQ 都不可用时自己出一道 20 以内加法，
     宁可题目朴素，也不能让屏幕上一个字都没有。 */
  function selfQ() {
    var a = rnd(9) + 1, b = rnd(9) + 1, ans = a + b;
    var opts = [String(ans)], seen = {}; seen[ans] = 1;
    var guard = 0;
    while (opts.length < 4 && guard++ < 60) {
      var c = String(Math.max(0, ans + (rnd(7) - 3)));
      if (seen[c]) continue; seen[c] = 1; opts.push(c);
    }
    return { q: a + " + " + b + " = ?", a: String(ans), opts: shuffle(opts), say: a + "加" + b + "等于几", v: null, tip: "" };
  }

  /* 出一道数学题：口算 / 竖式两条路，全部带兜底 */
  function makeQuestion() {
    var cfg = pick(GENPOOL) || { t: "addsub", max: 10 };
    var q = null, tip = CURTIP;
    var useVert = (typeof genV === "function") && Math.random() < 0.35;
    try {
      q = useVert ? genV(cfg) : ((typeof genQ === "function") ? genQ(cfg) : null);
    } catch (e) { q = null; }
    if (useVert && (!q || !q.v)) { try { q = (typeof genQ === "function") ? genQ(cfg) : null; } catch (e2) { q = null; } }
    if (!q || !q.opts || q.opts.length < 2 || q.a === undefined || q.a === null) q = selfQ();
    var qText = T(q.q);
    if (!qText) qText = "算一算";
    var opts = (q.opts || []).map(function (o) { return { label: T(o), val: T(o) }; });
    if (opts.length < 2) opts = [{ label: T(q.a), val: T(q.a) }];
    var correct = idx(opts, function (o) { return String(o.val) === String(q.a); });
    if (correct < 0) { correct = 0; }
    /* ★ 只有抽中竖式时才走竖式渲染 —— genQ 也可能带回 v（addsub 那批题型就有），
         不看这个标记的话几乎每道题都会变成竖式，既单调、手机上又容易挤爆。 */
    var isVert = !!(useVert && q && q.v && typeof vertHTML === "function");
    return {
      qText: qText,
      vert: isVert ? vertHTML(q.v) : "",   /* 竖式用 games.js 的渲染器 */
      speakText: T(q.say) || qText,
      hint: T(tip) || "先算个位，再算十位",
      opts: opts,
      correct: correct
    };
  }

  /* ---------- 运行时状态 ---------- */
  var S = null;
  var timers = [];
  var runId = 0;                       /* 会话令牌：每开一局 +1，旧局的回调全部作废 */
  window.__battleUndef = 0;            /* 诊断用：渲染里出现过几次 undefined（应为 0） */

  function clearTimers() {
    for (var i = 0; i < timers.length; i++) { clearInterval(timers[i]); clearTimeout(timers[i]); }
    timers = [];
  }
  function appEl() {
    try { if (typeof app !== "undefined" && app) return app; } catch (e) {}
    return document.getElementById("app");
  }
  /* 页面归属检查：#app 里还有 .battle 说明这一局仍在前台 */
  function stillMine() {
    var el = appEl();
    return !!(el && el.querySelector && el.querySelector(".battle"));
  }
  function later(fn, ms) {
    var tk = runId;
    var t = setTimeout(function () {
      if (tk !== runId || !S) return;
      if (!stillMine()) { clearTimers(); return; }
      try { fn(); } catch (e) {}
    }, ms);
    timers.push(t); return t;
  }
  function every(fn, ms) {
    var tk = runId;
    var t = setInterval(function () {
      if (tk !== runId || !S || !stillMine()) { clearInterval(t); return; }
      try { fn(); } catch (e) {}
    }, ms);
    timers.push(t); return t;
  }

  function starStr(n) {
    var k = Math.round(num(n, 0));
    if (k < 0) k = 0;
    if (k > START_STARS) k = START_STARS;
    return "★".repeat(k) + "☆".repeat(START_STARS - k);
  }

  function setApp(html) {
    /* 最后一道防线：万一还有漏网的 undefined，直接抹掉 */
    if (html.indexOf("undefined") >= 0) {
      window.__battleUndef++;
      try { console.warn("[battle] 渲染里出现 undefined，已清理（第 " + window.__battleUndef + " 次）"); } catch (e) {}
      html = html.split("undefined").join("");
    }
    var el = appEl();
    if (el) el.innerHTML = html;
  }

  function banner(text) {
    if (!document.body) return;
    var b = document.createElement("div");
    b.className = "b-banner";
    b.innerHTML = '<span class="badge">' + T(text) + "</span>";
    document.body.appendChild(b);
    later(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1400);
  }

  function alivePlayers() { return S.players.filter(function (p) { return p.alive; }); }
  function loseStar(p) { p.stars--; if (p.stars <= 0) { p.stars = 0; p.alive = false; p.resting = true; } }

  /* ---------- 样式 & 渲染 ---------- */
  function ensureStyle() {
    if (document.getElementById("battle-style")) return;
    var s = document.createElement("style");
    s.id = "battle-style";
    s.textContent =
      ".battle{max-width:560px;margin:0 auto;padding:8px;font-family:inherit}" +
      ".b-top{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px;font-weight:800;flex-wrap:wrap}" +
      ".b-top .pill{background:#fff;border:0;border-radius:999px;padding:5px 10px;box-shadow:0 2px 6px rgba(0,0,0,.08)}" +
      ".b-stars{color:#e08b00}" +
      ".b-players{display:flex;flex-wrap:wrap;gap:6px;margin:8px 0;justify-content:center}" +
      ".b-chip{display:flex;flex-direction:column;align-items:center;font-size:11px;background:#fff;border-radius:12px;padding:4px 6px;min-width:54px;box-shadow:0 1px 4px rgba(0,0,0,.08)}" +
      ".b-chip.me{outline:2px solid #4a86e8}" +
      ".b-chip.dead{opacity:.45;filter:grayscale(1)}" +
      ".b-chip .ce{font-size:22px}" +
      ".b-chip .cs{color:#e08b00;letter-spacing:1px}" +
      ".b-q{background:#fff;border-radius:16px;padding:14px;margin:6px 0;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.08)}" +
      ".b-q .qbig{font-size:34px;font-weight:900;line-height:1.25;word-break:break-all}" +
      ".b-q .qtext{font-size:17px;font-weight:800;margin:4px 0;color:#333}" +
      ".b-q .qhint{font-size:14px;color:#8a5cf6;font-weight:800;margin-top:4px}" +
      ".b-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}" +
      ".b-opt{display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(180deg,#fff,#f3f7ff);border:2px solid #e3e9f5;border-radius:16px;padding:14px 10px;font-size:20px;font-weight:900;color:#234;cursor:pointer;min-height:64px}" +
      ".b-opt:active{transform:scale(.97)}" +
      ".b-opt.correct{background:#d8f5e3;border-color:#37b26a;color:#1f7a45}" +
      ".b-opt.wrong{background:#ffe1e1;border-color:#ef476f;color:#b3233f}" +
      ".b-opt.excl{opacity:.4;text-decoration:line-through;pointer-events:none}" +
      ".b-timer{height:10px;background:#eef;border-radius:999px;overflow:hidden;margin:6px 0}" +
      ".b-timer>i{display:block;height:100%;background:linear-gradient(90deg,#5fd08a,#f5c542,#ef476f);transition:width .1s linear}" +
      ".b-bottom{display:flex;gap:8px;margin-top:6px}" +
      ".b-bottom button{flex:1;border:0;border-radius:12px;padding:10px;font-size:14px;font-weight:800;background:#fff;color:#456;box-shadow:0 2px 6px rgba(0,0,0,.08)}" +
      ".b-bottom .charge{flex:2;text-align:left;display:flex;align-items:center;gap:6px}" +
      ".b-bar{height:8px;flex:1;background:#eee;border-radius:999px;overflow:hidden}" +
      ".b-bar>i{display:block;height:100%;width:0;background:linear-gradient(90deg,#8a5cf6,#b692ff)}" +
      ".b-row{display:flex;gap:10px;margin-top:14px;justify-content:center}" +
      ".b-row button{border:0;border-radius:12px;padding:11px 18px;font-size:15px;font-weight:800;color:#fff;cursor:pointer}" +
      ".b-fb{text-align:center;font-size:16px;font-weight:900;min-height:22px;margin:6px 0}" +
      ".b-banner{position:fixed;left:0;right:0;top:28%;text-align:center;z-index:9999;pointer-events:none}" +
      ".b-banner .badge{display:inline-block;background:rgba(0,0,0,.72);color:#fff;font-size:20px;font-weight:900;padding:12px 22px;border-radius:999px;animation:bp .8s ease}" +
      "@keyframes bp{0%{transform:scale(.5);opacity:0}40%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}";
    (document.head || document.documentElement).appendChild(s);
  }

  /* 必须叫 battleRender，不能叫 render —— 见文件头铁律 1 */
  function battleRender() {
    if (!S || !S.q) return;
    var q = S.q;
    var me = S.players[0];
    var timeLeft = Math.max(0, Math.ceil(num(S.left, 0)));
    var chips = S.players.map(function (p) {
      return '<div class="b-chip ' + (p.isMe ? "me " : "") + (p.resting ? "dead" : "") + '">' +
        '<div class="ce">' + T(p.emoji) + "</div>" +
        '<div>' + (p.isMe ? "你" : T(p.name)) + "</div>" +
        '<div class="cs">' + (p.resting ? "休息" : starStr(p.stars)) + "</div></div>";
    }).join("");
    var optsHtml = (q.opts || []).map(function (o, i) {
      var cls = "b-opt";
      if (S.revealed) {
        if (i === q.correct) cls += " correct";
        else if (S.chosen === i) cls += " wrong";
        else if (S.excluded === i) cls += " excl";
      } else if (S.excluded === i) {
        cls += " excl";
      }
      return '<button class="' + cls + '" onclick="battleAnswer(' + i + ')">' +
        '<span>' + T(o && o.label) + "</span></button>";
    }).join("");
    var chargePct = Math.round((num(S.launchCharge, 0) / 3) * 100);
    var html =
      '<div class="battle">' +
        '<div class="b-top">' +
          '<button class="pill" onclick="battleExit()" style="cursor:pointer">← 退出</button>' +
          '<span class="pill">👥 剩 ' + alivePlayers().length + "</span>" +
          '<span class="pill b-stars">⭐' + starStr(me.stars) + "</span>" +
          '<span class="pill">分 ' + num(me.score, 0) + "</span>" +
          '<span class="pill">⏱ ' + timeLeft + "</span>" +
        "</div>" +
        '<div class="b-players">' + chips + "</div>" +
        '<div class="b-q">' +
          /* 有竖式时：题干文字走小字、竖式走大字；没有竖式时大字直接放题干 */
          '<div class="qtext">' + (q.vert ? T(q.qText) : "🧮 算一算") + "</div>" +
          '<div class="qbig">' + (q.vert ? q.vert : T(q.qText)) + "</div>" +
          (q.hint && S.showHint ? '<div class="qhint">💡 提示：' + T(q.hint) + "</div>" : "") +
          '<button class="pill" style="margin-top:6px;cursor:pointer" onclick="battleReplay()">🔊 读题</button>' +
        "</div>" +
        '<div class="b-timer"><i style="width:' + (num(S.left, 0) / (S.time || BASE_TIME) * 100) + '%"></i></div>' +
        '<div class="b-opts">' + optsHtml + "</div>" +
        '<div class="b-fb" id="bfb">' + T(S.fb) + "</div>" +
        '<div class="b-bottom">' +
          '<button onclick="battleHint()"' + (S.hintUsed ? " disabled style=\"opacity:.4\"" : "") + ">💡 提示" + (S.hintUsed ? "(已用)" : "") + "</button>" +
          '<div class="charge">📡 知识发射器<div class="b-bar"><i style="width:' + chargePct + '%"></i></div>' + num(S.launchCharge, 0) + "/3</div>" +
        "</div>" +
      "</div>";
    setApp(html);
  }

  /* ---------- 题目流程 ---------- */
  function showQuestion() {
    S.q = makeQuestion();
    S.chosen = -1; S.revealed = false; S.fb = "";
    S.left = S.time; S.locked = false;
    if (S.buff) { /* 应用上一题攒出的知识发射器效果（一次性） */
      if (S.buff === "time") { S.time = Math.min(22, S.time + 3); S.left = S.time; banner("🧮 速算加速器！本题 +3 秒"); }
      if (S.buff === "hint") { S.showHint = true; banner("📐 草稿纸发射器！显示解题提示"); }
      S.buff = null;
    }
    battleRender();
    if (typeof speak === "function") later(function () { try { speak(T(S.q.speakText)); } catch (e) {} }, 350);
    var last = Date.now();
    S.tick = every(function () {
      if (!S) return;
      var now = Date.now();
      S.left -= (now - last) / 1000; last = now;
      if (S.left <= 0) { S.left = 0; battleRender(); if (!S.locked) battleAnswer(-1); return; }
      var bar = document.querySelector(".b-timer>i");
      if (bar) bar.style.width = (S.left / (S.time || BASE_TIME) * 100) + "%";
      var t = document.querySelector(".b-top .pill:last-child");
      if (t) t.textContent = "⏱ " + Math.ceil(S.left);
    }, 100);
  }

  /* 真人或超时作答：idx 为选项下标，-1 表示超时 */
  function battleAnswer(idx) {
    if (!S || S.locked) return;
    S.locked = true;
    if (S.tick) clearInterval(S.tick);
    var q = S.q;
    var correct = (idx === q.correct);
    S.chosen = idx; S.revealed = true;
    var me = S.players[0];
    if (correct) { me.score++; me.correct++; S.launchCharge = Math.min(3, num(S.launchCharge, 0) + 1); if (me.correct % 3 === 0) fireLauncher(); }
    else loseStar(me);
    /* AI 同时作答 */
    for (var i = 1; i < S.players.length; i++) {
      var p = S.players[i]; if (!p.alive) continue;
      var aiOk = Math.random() < SKILL;
      p.answered = aiOk;
      if (aiOk) p.score++; else loseStar(p);
    }
    /* 每 2 题：缩圈 + 知识对决 */
    if (S.qn % 2 === 0) {
      S.time = Math.max(MIN_TIME, S.time - 1); S.shrink++;
      duel();
    }
    var fb = document.getElementById("bfb");
    if (fb) fb.textContent = correct ? "✅ 答对啦！+1 分" : "❌ 掉了一颗星";
    if (!correct && typeof speak === "function") later(function () {
      try {
        var right = (q.opts || [])[q.correct];
        speak(right ? T(right.label) : T(q.speakText));
      } catch (e) {}
    }, 200);
    battleRender();
    later(afterResolve, 1700);
  }

  function duel() {
    var alive = alivePlayers();
    if (!alive || alive.length < 2) return;
    var a = pick(alive);
    var rest = alive.filter(function (x) { return x !== a; });
    var b = pick(rest);
    if (!a || !b) return;
    var aOk = a.isMe ? (S.chosen === S.q.correct) : a.answered;
    var bOk = b.isMe ? (S.chosen === S.q.correct) : b.answered;
    var winner = null, loser = null;
    if (aOk && !bOk) { winner = a; loser = b; }
    else if (bOk && !aOk) { winner = b; loser = a; }
    banner("⚔️ 知识对决！" + (winner ? (winner.isMe ? "你" : T(winner.name)) + " 发射知识泡泡 🫧" : ""));
    if (loser) later(function () { loseStar(loser); }, 300);
  }

  function fireLauncher() {
    S.launchCharge = 0;
    var kind = Math.random() < 0.5 ? "time" : "hint";
    S.buff = kind;
    banner(kind === "time" ? "🧮 速算加速器已上膛！" : "📐 草稿纸发射器已上膛！");
  }

  function afterResolve() {
    if (!S) return;
    var alive = alivePlayers();
    if (!S.players[0].alive) { fastForward(); endGame(); return; }
    if (alive.length <= 1) { endGame(); return; }
    S.qn++;
    if (S.qn > TOTAL_Q) { endGame(); return; }
    S.showHint = false;
    showQuestion();
  }

  function fastForward() {
    while (alivePlayers().length > 1 && S.qn < TOTAL_Q) {
      S.qn++;
      for (var i = 1; i < S.players.length; i++) {
        var p = S.players[i]; if (!p.alive) continue;
        if (Math.random() < SKILL) p.score++; else loseStar(p);
      }
      if (S.qn % 2 === 0) {
        S.time = Math.max(MIN_TIME, S.time - 1);
        var alive = alivePlayers();
        if (alive.length >= 2) { var l = pick(alive); if (l) loseStar(l); }
      }
    }
  }

  function bestKey() { return "math_battle_best"; }
  function readBest() { try { return parseInt(localStorage.getItem(bestKey()) || "0", 10) || 0; } catch (e) { return 0; } }
  function saveBest(score) {
    try { if (score > readBest()) localStorage.setItem(bestKey(), String(score)); } catch (e) {}
  }

  function endGame() {
    clearTimers();
    var alive = alivePlayers();
    if (alive.length > 1) alive.sort(function (a, b) { return (b.stars - a.stars) || (b.score - a.score); });
    var winner = alive[0] || null;
    var youWon = !!(winner && winner.isMe);
    var me = S.players[0];
    var best = readBest();
    if (num(me.score, 0) > best) { best = num(me.score, 0); saveBest(best); }
    var P = window.PRAISE;
    var head = youWon
      ? (P ? P.block("perfect") : '<div style="text-align:center;font-size:46px">🏆</div><div style="text-align:center;font-size:24px;font-weight:900;color:#e08b00">知识王者！</div>')
      : '<div style="text-align:center;font-size:46px">🪑</div><div style="text-align:center;font-size:20px;font-weight:900;margin:6px 0">你回教室休息啦</div><div style="text-align:center;color:#888">本局知识王者：' + (winner ? T(winner.emoji) + (winner.isMe ? "你" : T(winner.name)) : "—") + "</div>";
    var html =
      '<div class="battle">' + head +
      '<div style="text-align:center;font-size:15px;font-weight:800;margin:8px 0">本局得分 ' + num(me.score, 0) + ' 分 · 历史最高 ' + best + ' 分</div>' +
      '<div class="b-players">' + S.players.map(function (p) {
        return '<div class="b-chip ' + (p.resting ? "dead" : "") + (p.isMe && youWon ? "me" : "") + '"><div class="ce">' + T(p.emoji) + '</div><div>' + (p.isMe ? "你" : T(p.name)) + '</div><div class="cs">' + (p.resting ? "休息" : "⭐" + p.stars) + " · " + num(p.score, 0) + "分</div></div>";
      }).join("") + "</div>" +
      '<div class="b-row">' +
        '<button style="background:linear-gradient(180deg,#5fd08a,#37b26a)" onclick="battleRestart()">🔁 再来一局</button>' +
        '<button style="background:linear-gradient(180deg,#ff7b7b,#ef476f)" onclick="battleExit()">🏠 返回</button>' +
      "</div></div>";
    setApp(html);
    if (P) later(function () { try { P.fx(youWon ? "perfect" : "good"); } catch (e) {} }, 250);
  }

  /* ---------- 退出：一次收干净，不留任何在途回调 ---------- */
  function battleStop() {
    runId++;                 /* 作废本局所有还没触发的回调 */
    clearTimers();
    S = null;
    window.__gameExit = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }

  /* ---------- 公开控制（绑定到 button onclick） ---------- */
  window.battleAnswer = battleAnswer;
  window.battleReplay = function () { if (S && S.q && typeof speak === "function") { try { speak(T(S.q.speakText)); } catch (e) {} } };
  window.battleHint = function () {
    if (!S || !S.q || S.hintUsed || S.revealed) return;
    var wrongs = [];
    (S.q.opts || []).forEach(function (o, i) { if (i !== S.q.correct && i !== S.excluded) wrongs.push(i); });
    if (!wrongs.length) return;
    S.excluded = pick(wrongs); S.hintUsed = true; battleRender();
  };
  /* 退出按钮 / 遥控器返回键共用：先熄火，再回玩法列表。
     这里必须用 window.render（app.js 的全局视图渲染），不能用局部的 battleRender。 */
  window.battleExit = function () {
    battleStop();
    try { if (typeof state !== "undefined" && state) { state.mode = null; state.view = "modes"; } } catch (e) {}
    if (typeof window.render === "function") window.render();
  };
  window.battleRestart = function () { battleStop(); startBattle(); };

  /* ---------- 入口 ---------- */
  function startBattle() {
    buildBank();
    battleStop();                       /* 上一局（如果有）彻底熄火 */
    ensureStyle();
    runId++;
    var players = [{ name: "你", emoji: "🧒", isMe: true, alive: true, resting: false, stars: START_STARS, score: 0, correct: 0, answered: false }];
    for (var i = 0; i < AI_NAMES.length; i++) players.push({ name: AI_NAMES[i], emoji: AI_EMOJI[i], isMe: false, alive: true, resting: false, stars: START_STARS, score: 0, correct: 0, answered: false });
    S = {
      players: players, qn: 1, time: BASE_TIME, left: BASE_TIME, locked: false,
      launchCharge: 0, buff: null, showHint: false, hintUsed: false, excluded: null,
      shrink: 0, q: null, chosen: -1, revealed: false, fb: "", tick: null
    };
    window.__gameExit = function () {   /* 在玩 → 接管返回键 */
      if (!S) return false;
      window.battleExit();
      return true;
    };
    showQuestion();
  }

  registerGame({
    id: "battle",
    name: "知识圈",
    icon: "🪂",
    desc: "答题生存赛：答对活、答错掉星，最后剩 1 人当知识王者！",
    start: startBattle
  });
})();
