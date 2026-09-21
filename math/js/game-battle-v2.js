/* ===================== 知识圈 v2 · 重做骨架（可热更 · 数学场） =====================
 * 这是「知识圈」的 Phase 1 骨架：6 个学生（1 真人 + 5 AI）+ 1 老师，
 * 教室→操场开场动画、老师 5·4·3·2·1 倒计时、答题生存赛、掉星回教室罚站、枪/娃娃装备覆盖层。
 *
 * 设计原则（来自现有 game-battle.js 的铁律，全部遵守）：
 *   1. 渲染函数叫 battleRender，绝不叫 render。
 *   2. 所有 setTimeout/setInterval 走 later()/every()，带 runId + stillMine() 守卫。
 *   3. 注入 HTML 的值全部过 T()。
 *   4. 退出走 battleStop()：runId++ + 清计时器 + 停朗读 + 摘钩子。
 *   5. 纯热更：不碰 boot.js / index.html / version 字段；不修改原 game-battle.js。
 *
 * 题库复用：math 全局有 genQ/genV/vertHTML，window.DATA 是内容包。
 *   这里把 buildBank/makeQuestion 各自实现一份 *V2（原文件是 IIFE 私有、无法跨文件调用，
 *   且禁止修改原文件）。两版逻辑同源，合并期可把原版挂到 window 复用。
 * ==================================================================== */
(function () {
  try { if (typeof log === "function") log("arena file executing"); } catch (e) {}
  if (typeof registerGame !== "function") {
    try { if (typeof log === "function") log("arena: registerGame missing → 安全降级"); } catch (e) {}
    return;
  }

  /* ---------- 资产路径（必须带学科前缀 math/；资源包虚拟域 https://local.hot/ 直读 files/hot/） ---------- */
  var IMG = "https://local.hot/math/img/battle/";
  var STU_IMG = [
    "stu_01_chick.png", "stu_02_police_dog.png", "stu_03_paw_rubble.png",
    "stu_04_paw_skye.png", "stu_05_white_bear.png", "stu_06_brown_bear.png"
  ];
  var STU_NAME = ["萌鸡小队", "拉布拉多警长", "汪汪队工程犬", "汪汪队紫犬", "白熊", "棕熊"];
  var STU_EMOJI = ["🐤", "🐶", "🐾", "🐱", "🐻‍❄️", "🐻"];
  var TEACHER_IMG = "char_teacher_user.png";
  var GUN_IMG = ["gun_01_revolver.png", "gun_02_golden_rose_smg.png", "gun_03_platinum_rifle.png", "gun_04_pinkblue_sniper.png", "gun_05_golden_deagle.png"];
  var DOLL_IMG = ["doll_01_teddy.png", "doll_02_fabric_girl.png", "doll_03_pink_bear.png", "doll_04_barbie.png", "doll_05_patrick.png"];

  /* ---------- 玩法常量 ---------- */
  var SKILL = 0.72;            /* AI 单题正确率 */
  var TOTAL_Q = 8;             /* 单局题数 */
  var BASE_TIME = 15;          /* 每题秒数 */
  var MIN_TIME = 10;
  var START_STARS = 4;         /* 初始能量星 */
  var WALK_IN_MS = 5000;       /* 开场走 5 秒 */
  var WALK_BACK_MS = 3000;     /* 掉星回教室走 3 秒 */
  var INV_KEY = "arena_inventory_v2";

  /* ---------- 通用小工具 ---------- */
  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return (a && a.length) ? a[rnd(a.length)] : null; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function idx(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return i; return -1; }
  function T(x) {
    if (x === undefined || x === null) return "";
    var s; try { s = String(x); } catch (e) { return ""; }
    if (s === "undefined" || s === "null" || s === "NaN" || s === "[object Object]") return "";
    return s;
  }
  function num(x, d) { var n = Number(x); return (isFinite(n) ? n : (d || 0)); }
  /* 头像：emoji 永远兜底，照片加载失败自动移除 → 不依赖资源也能跑 */
  function faceHTML(emoji, img) {
    return '<span class="a-face">' + T(emoji) + '</span>' +
      (img ? '<img class="a-photo" src="' + T(IMG + img) + '" alt="" onerror="this.remove()">' : "");
  }

  /* ---------- 题库（同源复用 math 全局 genQ/genV/vertHTML） ---------- */
  var FALLBACK_GEN = [{ t: "addsub", max: 10 }, { t: "addsub", max: 20 }, { t: "compare" }, { t: "addsub2" }, { t: "mul1" }];
  var GENPOOL = [], CURTIP = "";
  function buildBank() {
    GENPOOL = []; CURTIP = "";
    var grades = (window.DATA && window.DATA.grades) || window.GRADES || [];
    if (!grades || typeof grades.length !== "number") grades = [];
    var gi = 0, bi = 0, ui = 0;
    try { if (typeof state !== "undefined" && state) { gi = num(state.gi, 0); bi = num(state.bi, 0); ui = num(state.ui, 0); } } catch (e) {}
    var g = grades[gi] || grades[0] || null;
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
  function selfQ() {
    var a = rnd(9) + 1, b = rnd(9) + 1, ans = a + b;
    var opts = [String(ans)], seen = {}; seen[ans] = 1, guard = 0;
    while (opts.length < 4 && guard++ < 60) {
      var c = String(Math.max(0, ans + (rnd(7) - 3)));
      if (seen[c]) continue; seen[c] = 1; opts.push(c);
    }
    return { q: a + " + " + b + " = ?", a: String(ans), opts: shuffle(opts), say: a + "加" + b + "等于几", v: null, tip: "" };
  }
  function makeQuestion() {
    var cfg = pick(GENPOOL) || { t: "addsub", max: 10 };
    var q = null, tip = CURTIP, useVert = (typeof genV === "function") && Math.random() < 0.35;
    try { q = useVert ? genV(cfg) : ((typeof genQ === "function") ? genQ(cfg) : null); } catch (e) { q = null; }
    if (useVert && (!q || !q.v)) { try { q = (typeof genQ === "function") ? genQ(cfg) : null; } catch (e2) { q = null; } }
    if (!q || !q.opts || q.opts.length < 2 || q.a === undefined || q.a === null) q = selfQ();
    var qText = T(q.q); if (!qText) qText = "算一算";
    var opts = (q.opts || []).map(function (o) { return { label: T(o), val: T(o) }; });
    if (opts.length < 2) opts = [{ label: T(q.a), val: T(q.a) }];
    var correct = idx(opts, function (o) { return String(o.val) === String(q.a); });
    if (correct < 0) correct = 0;
    var isVert = !!(useVert && q && q.v && typeof vertHTML === "function");
    return {
      qText: qText,
      vert: isVert ? vertHTML(q.v) : "",
      speakText: T(q.say) || qText,
      hint: T(tip) || "先算个位，再算十位",
      opts: opts, correct: correct
    };
  }

  /* ---------- 运行时状态 ---------- */
  var S = null;
  var timers = [], runId = 0;
  var avatarEls = [];          /* 持久头像 DOM，动画靠它，不被 battleRender 重建 */

  function clearTimers() { for (var i = 0; i < timers.length; i++) { clearInterval(timers[i]); clearTimeout(timers[i]); } timers = []; }
  function appEl() { try { if (typeof app !== "undefined" && app) return app; } catch (e) {} return document.getElementById("app"); }
  function stillMine() { var el = appEl(); return !!(el && el.querySelector && el.querySelector(".arena")); }
  function later(fn, ms) {
    var tk = runId;
    var t = setTimeout(function () { if (tk !== runId || !S) return; if (!stillMine()) { clearTimers(); return; } try { fn(); } catch (e) {} }, ms);
    timers.push(t); return t;
  }
  function every(fn, ms) {
    var tk = runId;
    var t = setInterval(function () { if (tk !== runId || !S || !stillMine()) { clearInterval(t); return; } try { fn(); } catch (e) {} }, ms);
    timers.push(t); return t;
  }
  function setApp(html) {
    if (html.indexOf("undefined") >= 0) { try { console.warn("[arena] 渲染出现 undefined，已清理"); } catch (e) {} html = html.split("undefined").join(""); }
    var el = appEl(); if (el) el.innerHTML = html;
  }
  function banner(text) {
    if (!document.body) return;
    var b = document.createElement("div");
    b.className = "a-banner";
    b.innerHTML = '<span class="badge">' + T(text) + "</span>";
    document.body.appendChild(b);
    later(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1400);
  }

  function alivePlayers() { return S.players.filter(function (p) { return p.alive; }); }
  function loseStar(p) { p.stars--; if (p.stars <= 0) { p.stars = 0; p.alive = false; p.resting = true; } }
  function starStr(n) { var k = Math.round(num(n, 0)); if (k < 0) k = 0; if (k > START_STARS) k = START_STARS; return "★".repeat(k) + "☆".repeat(START_STARS - k); }

  /* ---------- 装备 / 库存（localStorage 持久化，简单可桩） ---------- */
  function readInv() {
    try { var v = JSON.parse(localStorage.getItem(INV_KEY) || "{}"); if (v && typeof v === "object") return v; } catch (e) {}
    return { attachments: 0, finished: 0 };
  }
  function saveInv(v) { try { localStorage.setItem(INV_KEY, JSON.stringify(v)); } catch (e) {} }
  /* 收集 3 个配件 → 兑换 1 个成品（枪/娃娃）。桩：玩家胜负时调 attach() */
  function attachPiece() { var v = readInv(); v.attachments++; saveInv(v); return v; }
  function exchangePiece() {
    var v = readInv();
    if (v.attachments >= 3) { v.attachments -= 3; v.finished++; saveInv(v); banner("🎉 集齐 3 配件，兑换 1 成品！"); }
    else banner("还需 " + (3 - v.attachments) + " 个配件才能兑换");
    return v;
  }

  /* ---------- 样式注入（最小可用） ---------- */
  function ensureStyle() {
    if (document.getElementById("arena-style")) return;
    var s = document.createElement("style");
    s.id = "arena-style";
    s.textContent =
      ".arena{max-width:560px;margin:0 auto;padding:8px;font-family:inherit;position:relative}" +
      ".a-top{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px;font-weight:800;flex-wrap:wrap;margin-bottom:6px}" +
      ".a-top .pill{background:#fff;border:0;border-radius:999px;padding:5px 10px;box-shadow:0 2px 6px rgba(0,0,0,.08)}" +
      ".a-top .stars{color:#e08b00}" +
      /* 舞台：教室 / 操场两层叠加，按 scene 切换可见 */
      ".a-stage{position:relative;height:230px;border-radius:16px;overflow:hidden;background:#cfe8ff;box-shadow:0 4px 12px rgba(0,0,0,.1)}" +
      ".a-scene{position:absolute;inset:0;display:none;align-items:flex-end;justify-content:center;padding-bottom:14px}" +
      ".a-scene.on{display:flex}" +
      ".a-classroom{background:linear-gradient(180deg,#fff3d6,#ffe2a8)}" +
      ".a-classroom:before{content:'🏫 教室';position:absolute;top:8px;left:10px;font-weight:900;color:#a9743a}" +
      ".a-playground{background:linear-gradient(180deg,#bfe9c0,#7fc98a)}" +
      ".a-playground:before{content:'🏟️ 操场';position:absolute;top:8px;left:10px;font-weight:900;color:#2f7a3a}" +
      /* 头像：flex 排开，走路靠 transform translateX（CSS 过渡） */
      ".a-row{display:flex;gap:8px;justify-content:center;align-items:flex-end;width:100%;padding:0 8px}" +
      ".a-avatar{position:relative;width:62px;display:flex;flex-direction:column;align-items:center;transition:transform 5s linear}" +
      ".a-avatar .a-body{position:relative;width:54px;height:54px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:30px;box-shadow:0 2px 5px rgba(0,0,0,.15)}" +
      ".a-avatar .a-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}" +
      ".a-avatar .a-name{font-size:11px;font-weight:800;margin-top:2px;background:rgba(255,255,255,.7);border-radius:8px;padding:0 4px}" +
      ".a-avatar.me .a-body{outline:3px solid #4a86e8}" +
      ".a-avatar.rest .a-body{filter:grayscale(1);opacity:.6}" +
      ".a-avatar .a-stars{font-size:11px;color:#e08b00;letter-spacing:1px;min-height:14px}" +
      /* 装备覆盖层（枪/娃娃）：挂在头像右上 */
      ".a-avatar .a-equip{position:absolute;top:-6px;right:-6px;width:26px;height:26px;display:none}" +
      ".a-avatar .a-equip.on{display:block}" +
      /* 罚站 ❌ 覆盖 */
      ".a-avatar .a-x{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-size:40px;color:#ef476f;font-weight:900;text-shadow:0 0 4px #fff}" +
      ".a-avatar.rest .a-x{display:flex}" +
      /* 老师 */
      ".a-teacher{position:absolute;top:30px;left:50%;transform:translateX(-50%);width:60px;height:60px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:34px;box-shadow:0 2px 6px rgba(0,0,0,.2)}" +
      ".a-teacher img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}" +
      /* HUD 题目卡 */
      ".a-q{background:#fff;border-radius:16px;padding:14px;margin:8px 0;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.08)}" +
      ".a-q .qbig{font-size:32px;font-weight:900;line-height:1.2;word-break:break-all}" +
      ".a-q .qtext{font-size:16px;font-weight:800;margin:4px 0;color:#333}" +
      ".a-q .qhint{font-size:14px;color:#8a5cf6;font-weight:800;margin-top:4px}" +
      ".a-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      ".a-opt{display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#fff,#f3f7ff);border:2px solid #e3e9f5;border-radius:16px;padding:14px 10px;font-size:20px;font-weight:900;color:#234;cursor:pointer;min-height:60px}" +
      ".a-opt:active{transform:scale(.97)}" +
      ".a-opt.correct{background:#d8f5e3;border-color:#37b26a;color:#1f7a45}" +
      ".a-opt.wrong{background:#ffe1e1;border-color:#ef476f;color:#b3233f}" +
      ".a-opt.excl{opacity:.4;text-decoration:line-through;pointer-events:none}" +
      ".a-timer{height:10px;background:#eef;border-radius:999px;overflow:hidden;margin:6px 0}" +
      ".a-timer>i{display:block;height:100%;background:linear-gradient(90deg,#5fd08a,#f5c542,#ef476f);transition:width .1s linear}" +
      ".a-fb{text-align:center;font-size:16px;font-weight:900;min-height:22px;margin:6px 0}" +
      ".a-bottom{display:flex;gap:8px;margin-top:6px;flex-wrap:wrap}" +
      ".a-bottom button{flex:1;border:0;border-radius:12px;padding:10px;font-size:13px;font-weight:800;background:#fff;color:#456;box-shadow:0 2px 6px rgba(0,0,0,.08);cursor:pointer}" +
      ".a-cd{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:900;color:#fff;text-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none}" +
      ".a-banner{position:fixed;left:0;right:0;top:28%;text-align:center;z-index:9999;pointer-events:none}" +
      ".a-banner .badge{display:inline-block;background:rgba(0,0,0,.72);color:#fff;font-size:20px;font-weight:900;padding:12px 22px;border-radius:999px;animation:abp .8s ease}" +
      "@keyframes abp{0%{transform:scale(.5);opacity:0}40%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}";
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- 舞台：一次性建好持久 DOM（头像动画靠它） ---------- */
  function mountStage() {
    var players = S.players;
    var rowHtml = players.map(function (p, i) {
      var eq = (p.equip === "gun") ? '<img class="a-equip on" src="' + T(IMG + p.equipImg) + '" onerror="this.remove()">'
        : (p.equip === "doll") ? '<img class="a-equip on" src="' + T(IMG + p.equipImg) + '" onerror="this.remove()">' : '<img class="a-equip">';
      return '<div class="a-avatar ' + (p.isMe ? "me" : "") + '" data-i="' + i + '">' +
        '<div class="a-body">' + faceHTML(p.emoji, p.img) +
          '<div class="a-x">❌</div>' + eq + '</div>' +
        '<div class="a-name">' + (p.isMe ? "你" : T(p.name)) + '</div>' +
        '<div class="a-stars">' + starStr(p.stars) + '</div>' +
      '</div>';
    }).join("");
    var html =
      '<div class="arena">' +
      '<div class="a-top">' +
        '<button class="pill" onclick="arenaExit()" style="cursor:pointer">← 退出</button>' +
        '<span class="pill">👥 剩 <b id="a-alive">' + alivePlayers().length + '</b></span>' +
        '<span class="pill stars">⭐ <b id="a-stars">' + starStr(players[0].stars) + '</b></span>' +
        '<span class="pill">分 <b id="a-score">' + num(players[0].score, 0) + '</b></span>' +
        '<span class="pill">⏱ <b id="a-time">' + BASE_TIME + '</b></span>' +
      '</div>' +
      '<div class="a-stage">' +
        '<div class="a-scene a-classroom on" id="a-classroom">' +
          '<div class="a-teacher">' + faceHTML("👩‍🏫", TEACHER_IMG) + '</div>' +
          '<div class="a-row">' + rowHtml + '</div>' +
        '</div>' +
        '<div class="a-scene a-playground" id="a-playground">' +
          '<div class="a-row">' + rowHtml + '</div>' +
        '</div>' +
        '<div class="a-cd" id="a-cd" style="display:none"></div>' +
      '</div>' +
      '<div id="a-hud"></div>' +
      '</div>';
    setApp(html);
    /* 缓存头像 DOM 引用（两场景各一份，按 data-i 取） */
    avatarEls = [];
    var nodes = document.querySelectorAll(".arena .a-avatar");
    for (var n = 0; n < nodes.length; n++) avatarEls.push(nodes[n]);
    /* 开场：头像先从左侧屏幕外走到各自槽位（教室层） */
    for (var i = 0; i < avatarEls.length; i++) {
      var el = avatarEls[i];
      el.style.transition = "transform " + (WALK_IN_MS / 1000) + "s linear";
      el.style.transform = "translateX(-460px)";
    }
    /* 强制重排后归位 → 触发过渡 */
    later(function () {
      for (var j = 0; j < avatarEls.length; j++) avatarEls[j].style.transform = "translateX(0)";
    }, 60);
  }

  function refreshTop() {
    var a = document.getElementById("a-alive"); if (a) a.textContent = alivePlayers().length;
    var s = document.getElementById("a-stars"); if (s) s.textContent = starStr(S.players[0].stars);
    var sc = document.getElementById("a-score"); if (sc) sc.textContent = num(S.players[0].score, 0);
  }
  function refreshAvatar(i) {
    var el = avatarEls[i]; if (!el) return;
    var p = S.players[i];
    var st = el.querySelector(".a-stars"); if (st) st.textContent = p.resting ? "罚站" : starStr(p.stars);
    if (p.resting) el.classList.add("rest");
    /* 装备覆盖层 */
    var eq = el.querySelector(".a-equip");
    if (eq) {
      if (p.equip) { eq.src = T(IMG + p.equipImg); eq.classList.add("on"); eq.style.display = ""; }
      else { eq.classList.remove("on"); eq.style.display = "none"; }
    }
  }

  /* ---------- 渲染（必须叫 battleRender，不叫 render） ---------- */
  function battleRender() {
    if (!S) return;
    var hud = document.getElementById("a-hud");
    if (!hud) return;
    if (S.phase === "opening" || S.phase === "countdown") {
      hud.innerHTML = '<div class="a-q" style="background:#fff8e6"><div class="qtext">老师：同学们，去操场集合！</div>' +
        '<button class="pill" style="cursor:pointer;margin-top:6px" onclick="arenaTeacher()">🔊 听老师</button></div>';
      return;
    }
    if (S.phase === "over") { renderOver(hud); return; }
    var q = S.q; if (!q) return;
    var me = S.players[0];
    var timeLeft = Math.max(0, Math.ceil(num(S.left, 0)));
    var optsHtml = (q.opts || []).map(function (o, i) {
      var cls = "a-opt";
      if (S.revealed) { if (i === q.correct) cls += " correct"; else if (S.chosen === i) cls += " wrong"; else if (S.excluded === i) cls += " excl"; }
      else if (S.excluded === i) cls += " excl";
      return '<button class="' + cls + '" onclick="arenaAnswer(' + i + ')"><span>' + T(o && o.label) + "</span></button>";
    }).join("");
    hud.innerHTML =
      '<div class="a-q">' +
        '<div class="qtext">' + (q.vert ? T(q.qText) : "🧮 算一算") + "</div>" +
        '<div class="qbig">' + (q.vert ? q.vert : T(q.qText)) + "</div>" +
        (q.hint && S.showHint ? '<div class="qhint">💡 提示：' + T(q.hint) + "</div>" : "") +
        '<button class="pill" style="margin-top:6px;cursor:pointer" onclick="arenaReplay()">🔊 读题</button>' +
      "</div>" +
      '<div class="a-timer"><i style="width:' + (num(S.left, 0) / (S.time || BASE_TIME) * 100) + '%"></i></div>' +
      '<div class="a-opts">' + optsHtml + "</div>" +
      '<div class="a-fb" id="afb">' + T(S.fb) + "</div>" +
      '<div class="a-bottom">' +
        '<button onclick="arenaHint()"' + (S.hintUsed ? " disabled style=\"opacity:.4\"" : "") + ">💡 提示" + (S.hintUsed ? "(已用)" : "") + "</button>" +
        '<button onclick="arenaEquip()">🎒 装备</button>' +
        '<button onclick="arenaExchange()">🎁 兑换(' + readInv().attachments + ")</button>" +
      "</div>";
    refreshTop();
  }

  /* ---------- 开场：教室→操场走 5s，老师倒计时 5..1 ---------- */
  function startOpening() {
    S.phase = "opening";
    battleRender();
    later(function () {
      /* 切到操场层（教室层淡出，头像保留在原位继续入场） */
      var cls = document.getElementById("a-classroom"), pg = document.getElementById("a-playground");
      if (cls) cls.classList.remove("on"); if (pg) pg.classList.add("on");
      S.phase = "countdown";
      countdown(5);
    }, WALK_IN_MS);
  }
  function countdown(n) {
    var cd = document.getElementById("a-cd");
    if (n <= 0) { if (cd) cd.style.display = "none"; showQuestion(); return; }
    if (cd) { cd.style.display = "flex"; cd.textContent = T(n); }
    if (typeof speak === "function") { try { speak(T(String(n)), "zh-CN"); } catch (e) {} }
    later(function () { countdown(n - 1); }, 1000);
  }

  /* ---------- 题目流程 ---------- */
  function showQuestion() {
    S.phase = "play";
    S.q = makeQuestion();
    S.chosen = -1; S.revealed = false; S.fb = ""; S.left = S.time; S.locked = false; S.showHint = false;
    battleRender();
    if (typeof speak === "function") later(function () { try { speak(T(S.q.speakText), "zh-CN"); } catch (e) {} }, 350);
    var last = Date.now();
    S.tick = every(function () {
      if (!S) return;
      var now = Date.now(); S.left -= (now - last) / 1000; last = now;
      if (S.left <= 0) { S.left = 0; battleRender(); if (!S.locked) arenaAnswer(-1); return; }
      var bar = document.querySelector(".a-timer>i"); if (bar) bar.style.width = (S.left / (S.time || BASE_TIME) * 100) + "%";
      var t = document.getElementById("a-time"); if (t) t.textContent = Math.ceil(S.left);
    }, 100);
  }

  function arenaAnswer(idx) {
    if (!S || S.locked) return;
    S.locked = true; if (S.tick) clearInterval(S.tick);
    var q = S.q, correct = (idx === q.correct);
    S.chosen = idx; S.revealed = true;
    var me = S.players[0];
    if (correct) me.score++; else loseStar(me);
    for (var i = 1; i < S.players.length; i++) {
      var p = S.players[i]; if (!p.alive) continue;
      if (Math.random() < SKILL) p.score++; else loseStar(p);
    }
    var fb = document.getElementById("afb");
    if (fb) fb.textContent = correct ? "✅ 答对啦！+1 分" : "❌ 掉了一颗星";
    if (!correct && typeof speak === "function") later(function () {
      try { var right = (q.opts || [])[q.correct]; speak(right ? T(right.label) : T(q.speakText), "zh-CN"); } catch (e) {}
    }, 200);
    battleRender();
    /* 处理掉星回教室罚站动画：本轮所有掉星（输了的）学生都走回教室，老师逐个点名 */
    var nth = 0;
    S.players.forEach(function (p, k) { if (p.resting && !p._walked) { walkBack(k, nth * 1400); nth++; } });
    later(afterResolve, 1700);
  }

  /* 掉星 → 头像走回教室（3s）+ ❌ 覆盖；老师逐个点名让其回教室好好学习
     delayMs：同 round 多人同时掉星时错开播报，避免语音被引擎合并成一团 */
  function walkBack(i, delayMs) {
    var p = S.players[i]; p._walked = true;
    var el = avatarEls[i]; if (!el) return;
    el.style.transition = "transform " + (WALK_BACK_MS / 1000) + "s linear";
    el.style.transform = "translateX(-720px)";
    /* 老师点名：某某，回教室好好学习（每个被淘汰的学生各播一次，靠 _walked 守卫，绝不漏、绝不重复） */
    var msg = T(p.isMe ? "你" : p.name) + "，回教室好好学习";
    if (typeof speak === "function") {
      if (delayMs && delayMs > 0) later(function () { try { speak(msg, "zh-CN"); } catch (e) {} }, delayMs);
      else try { speak(msg, "zh-CN"); } catch (e) {}
    }
    later(function () { refreshAvatar(i); }, WALK_BACK_MS + 50);
  }

  function afterResolve() {
    if (!S) return;
    if (!S.players[0].alive) { endGame(); return; }
    var alive = alivePlayers();
    if (alive.length <= 1) { endGame(); return; }
    S.qn++;
    if (S.qn > TOTAL_Q) { endGame(); return; }
    showQuestion();
  }

  function renderOver(hud) {
    var alive = alivePlayers();
    if (alive.length > 1) alive.sort(function (a, b) { return (b.stars - a.stars) || (b.score - a.score); });
    var winner = alive[0] || null, youWon = !!(winner && winner.isMe), me = S.players[0];
    /* 奖励：冠军得 1 个配件（桩） */
    if (youWon) { var v = attachPiece(); banner("🏆 冠军奖励 +1 配件（共 " + v.attachments + "）"); }
    var head = youWon
      ? '<div style="text-align:center;font-size:46px">🏆</div><div style="text-align:center;font-size:24px;font-weight:900;color:#e08b00">知识王者！</div>'
      : '<div style="text-align:center;font-size:46px">🪑</div><div style="text-align:center;font-size:20px;font-weight:900;margin:6px 0">你回教室罚站啦</div><div style="text-align:center;color:#888">本局王者：' + (winner ? T(winner.emoji) + (winner.isMe ? "你" : T(winner.name)) : "—") + "</div>";
    hud.innerHTML = head +
      '<div style="text-align:center;font-size:15px;font-weight:800;margin:8px 0">本局得分 ' + num(me.score, 0) + ' 分</div>' +
      '<div style="text-align:center;font-size:13px;color:#888">🎒 配件 ' + readInv().attachments + " · 成品 " + readInv().finished + "</div>" +
      '<div class="a-bottom" style="margin-top:12px">' +
        '<button style="background:linear-gradient(180deg,#5fd08a,#37b26a);color:#fff" onclick="arenaRestart()">🔁 再来一局</button>' +
        '<button style="background:linear-gradient(180deg,#ff7b7b,#ef476f);color:#fff" onclick="arenaExit()">🏠 返回</button>' +
      "</div>";
  }

  /* ---------- 退出：一次收干净 ---------- */
  function battleStop() {
    runId++;
    clearTimers();
    S = null; avatarEls = [];
    window.__gameExit = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }

  /* ---------- 公开控制（挂在 window，供 onclick 调用） ---------- */
  window.arenaAnswer = arenaAnswer;
  window.arenaReplay = function () { if (S && S.q && typeof speak === "function") { try { speak(T(S.q.speakText), "zh-CN"); } catch (e) {} } };
  window.arenaTeacher = function () { if (typeof speak === "function") { try { speak("同学们，准备开始答题闯关！", "zh-CN"); } catch (e) {} } };
  window.arenaHint = function () {
    if (!S || !S.q || S.hintUsed || S.revealed) return;
    var wrongs = []; (S.q.opts || []).forEach(function (o, i) { if (i !== S.q.correct && i !== S.excluded) wrongs.push(i); });
    if (!wrongs.length) return;
    S.excluded = pick(wrongs); S.hintUsed = true; battleRender();
  };
  window.arenaEquip = function () {
    /* 装备粒度（桩）：玩家在 无→枪→娃娃 间循环，覆盖层即时显示 */
    var me = S && S.players[0]; if (!me) return;
    if (!me.equip) { me.equip = "gun"; me.equipImg = pick(GUN_IMG); }
    else if (me.equip === "gun") { me.equip = "doll"; me.equipImg = pick(DOLL_IMG); }
    else { me.equip = null; me.equipImg = ""; }
    refreshAvatar(0); banner(me.equip ? ("装备：" + (me.equip === "gun" ? "🔫" : "🧸")) : "已卸下装备");
  };
  window.arenaExchange = function () { exchangePiece(); battleRender(); };
  window.arenaExit = function () {
    battleStop();
    try { if (typeof state !== "undefined" && state) { state.mode = null; state.view = "modes"; } } catch (e) {}
    if (typeof window.render === "function") window.render();
  };
  window.arenaRestart = function () { battleStop(); startArena(); };

  /* ---------- 入口 ---------- */
  function startArena() {
    buildBank();
    battleStop();
    ensureStyle();
    runId++;
    /* 随机抽 1 个当真人，其余 5 个 AI */
    var meIdx = rnd(6);
    var players = [];
    for (var i = 0; i < 6; i++) {
      players.push({
        name: STU_NAME[i], emoji: STU_EMOJI[i], img: STU_IMG[i],
        isMe: (i === meIdx), alive: true, resting: false, _walked: false,
        stars: START_STARS, score: 0, correct: 0, equip: null, equipImg: ""
      });
    }
    S = { players: players, qn: 1, time: BASE_TIME, left: BASE_TIME, locked: false, q: null, chosen: -1, revealed: false, fb: "", tick: null, phase: "opening", hintUsed: false, showHint: false, excluded: null };
    window.__gameExit = function () { if (!S) return false; window.arenaExit(); return true; };
    mountStage();
    startOpening();
  }

  try { if (typeof log === "function") log("arena registering"); } catch (e) {}
  registerGame({
    id: "arena2",
    name: "知识圈竞赛2",
    icon: "🏆",
    desc: "6 人答题生存赛：老师带队去操场，答对活、掉星回教室罚站！",
    start: startArena
  });
  try { if (typeof log === "function") log("arena registered, GAMES=" + ((window.GAMES && window.GAMES.length) || 0)); } catch (e) {}
})();
