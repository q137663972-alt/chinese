/* ===================== 知识圈 / 吃鸡玩法（可热更） =====================
 * 一年级启蒙圈 · 语文场（单机 AI 版，MVP）
 * 注册一个新玩法 battle：首页会自动多一个「🪂 知识圈」入口。
 * 只改这一个文件就能热更，boot.js 的 planFiles 会把 js/game-*.js 自动加载并
 * 从 registerGame 提取 id 写进清单，不需要改 app.js、也不需要出新 APK。
 *
 * 规则（来自产品设计文档 v1.0）：
 *   - 1 真人 + 6 AI，每人初始 4 颗能量星
 *   - 8 题，每题所有人同时答 A/B/C/D
 *   - 答对 +1 分；答错或超时 -1 星；星掉光「回教室休息」可观战
 *   - 每 2 题缩圈一次，答题时间 -1 秒（最低 10 秒）
 *   - 每 2 题触发知识对决：随机 2 人，先答对者发射知识泡泡，对手 -1 星
 *   - 答对满 3 题自动发射知识发射器（语文：拼音泡泡枪 +3 秒 / 古诗卷轴发射器 显示拼音提示）
 *   - 最后剩 1 人 = 知识王者（放大奖杯特效）
 *   - 合规：不出现真枪/军事/血腥，统一叫知识发射器/知识泡泡，被命中只掉星
 *
 * 【三条铁律】（都是踩过的坑，改这个文件时别破坏）：
 *   1. 渲染函数只能叫 battleRender —— 不能叫 render。
 *      叫 render 会把 app.js 的全局视图 render 遮蔽掉，退出时本想回玩法列表，
 *      结果又调回自己（那时状态已清空）直接抛异常，界面就卡死在游戏里。
 *   2. 所有 setTimeout / setInterval 必须走 later() / every()。
 *      它们带会话令牌 + 页面归属检查：退出或页面被别的视图顶掉后，在途回调
 *      一律自行了断 —— 否则「退出后又自动跳回游戏」就是这么来的。
 *   3. 拼进 HTML 的值一律过 T()。
 *      机顶盒上出现过整屏 undefined（数据层没装配好时字段取空），
 *      T() 把 undefined/null/NaN 全换成空串，setApp 再做一次兜底清理。
 * ==================================================================== */
(function () {
  if (typeof registerGame !== "function") return; /* 上一层的 games.js 没加载时不注册，安全降级 */

  var SKILL = 0.72;          /* AI 单题正确率（控制淘汰节奏） */
  var TOTAL_Q = 8;           /* 单局题数 */
  var BASE_TIME = 15;        /* 初始每题秒数 */
  var MIN_TIME = 10;         /* 缩圈最低秒数 */
  var START_STARS = 4;       /* 初始能量星 */
  var AI_NAMES = ["小明", "小红", "乐乐", "糖糖", "豆豆", "奇奇"];
  var AI_EMOJI = ["🧑", "👧", "🧒", "👦", "🐯", "🐰"];

  /* 兜底题库：数据层万一没装配好（内容包没拉到、字段结构变了、某些机顶盒上
     window.DATA 是空的），宁可用这一小撮一年级常用字开局，也绝不能让界面
     出现 undefined 或空题。手机端一直正常、机顶盒 undefined 就是这么兜住的。 */
  var FALLBACK = [
    { z: "日", p: "rì", n: 4, k: "☀️" }, { z: "月", p: "yuè", n: 4, k: "🌙" },
    { z: "水", p: "shuǐ", n: 4, k: "💧" }, { z: "火", p: "huǒ", n: 4, k: "🔥" },
    { z: "山", p: "shān", n: 3, k: "⛰️" }, { z: "石", p: "shí", n: 5, k: "🪨" },
    { z: "田", p: "tián", n: 5, k: "🌾" }, { z: "土", p: "tǔ", n: 3, k: "🟫" },
    { z: "人", p: "rén", n: 2, k: "🧒" }, { z: "口", p: "kǒu", n: 3, k: "👄" },
    { z: "手", p: "shǒu", n: 4, k: "✋" }, { z: "目", p: "mù", n: 5, k: "👁️" },
    { z: "天", p: "tiān", n: 4, k: "🌤️" }, { z: "云", p: "yún", n: 4, k: "☁️" },
    { z: "雨", p: "yǔ", n: 8, k: "🌧️" }, { z: "花", p: "huā", n: 7, k: "🌸" },
    { z: "鸟", p: "niǎo", n: 5, k: "🐦" }, { z: "马", p: "mǎ", n: 3, k: "🐴" },
    { z: "牛", p: "niú", n: 4, k: "🐮" }, { z: "羊", p: "yáng", n: 6, k: "🐑" },
    { z: "大", p: "dà", n: 3, k: "🙆" }, { z: "小", p: "xiǎo", n: 3, k: "🐣" },
    { z: "上", p: "shàng", n: 3, k: "⬆️" }, { z: "下", p: "xià", n: 3, k: "⬇️" },
    { z: "中", p: "zhōng", n: 4, k: "🎯" }, { z: "木", p: "mù", n: 4, k: "🌳" },
    { z: "禾", p: "hé", n: 5, k: "🌾" }, { z: "竹", p: "zhú", n: 6, k: "🎋" },
    { z: "星", p: "xīng", n: 9, k: "⭐" }, { z: "光", p: "guāng", n: 6, k: "💡" }
  ];

  var ALLWORDS = [];
  var usedFallback = false;
  function buildBank() {
    ALLWORDS = [];
    usedFallback = false;
    var grades = (window.DATA && window.DATA.grades) || (window.GRADES) || [];
    var src = grades;
    if (grades && grades.grades) src = grades.grades; /* 兜底：有的结构是 {grades:[...]} */
    if (!src || typeof src.length !== "number") src = [];
    for (var gi = 0; gi < src.length; gi++) {
      var books = (src[gi] && src[gi].books) || [];
      for (var bi = 0; bi < books.length; bi++) {
        var units = (books[bi] && books[bi].u) || [];
        for (var ui = 0; ui < units.length; ui++) {
          var ws = (units[ui] && units[ui].w) || [];
          for (var wi = 0; wi < ws.length; wi++) {
            var it = ws[wi];
            /* 字段不齐的字（拼音/笔画/emoji 缺任何一个）会让界面上直接渲染出
               undefined —— 宁可不进题库，也不能把 undefined 显示给孩子看。 */
            if (it && it.z && it.p && it.n) ALLWORDS.push(it);
          }
        }
      }
    }
    if (ALLWORDS.length < 8) { ALLWORDS = FALLBACK.slice(); usedFallback = true; }
  }

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return (a && a.length) ? a[rnd(a.length)] : null; }
  function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = rnd(i + 1); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }
  function findWord(z) { for (var i = 0; i < ALLWORDS.length; i++) if (ALLWORDS[i].z === z) return ALLWORDS[i]; return null; }
  function distractor(field, val, n, extra) {
    var out = [], seen = {}; if (val != null) seen[val] = 1;
    var pool = (extra && extra.length) ? extra.concat(ALLWORDS) : ALLWORDS;
    var guard = 0;
    while (out.length < n && guard++ < 800) {
      var it = pick(pool); if (!it) continue;
      var c = it[field];
      if (c == null) continue;
      if (typeof c === "string" && /[，,、]/.test(c)) c = c.split(/[，,、]/)[0];
      if (seen[c]) continue; seen[c] = 1; out.push(c);
    }
    return out;
  }
  function idx(arr, fn) { for (var i = 0; i < arr.length; i++) if (fn(arr[i])) return i; return -1; }

  /* 安全取值：undefined / null / NaN / "undefined" 一律退化成空串。
     界面上出现「undefined」四个字母，比题目少一个选项难受一百倍。 */
  function T(x) {
    if (x === undefined || x === null) return "";
    var s;
    try { s = String(x); } catch (e) { return ""; }
    if (s === "undefined" || s === "null" || s === "NaN" || s === "[object Object]") return "";
    return s;
  }
  function num(x, d) { var n = Number(x); return (isFinite(n) ? n : (d || 0)); }

  /* 动态出一道语文题：4 种题型轮换（听音选字 / 看字选拼音 / 看图选字 / 笔画数） */
  function makeQuestion() {
    var w = pick(ALLWORDS) || {};
    var type = pick(["listen", "pinyin", "pic", "stroke"]);
    var opts = [], correct = 0, qText = "", speakText = "", hint = "";
    /* 字段兜底：任何一处取不到也只降级成空串/默认图，绝不在界面上出现 undefined */
    var pinyin = T(w.p), zh = T(w.z), strokes = num(w.n, 0), emoji = T(w.k) || "\uD83D\uDDBC\uFE0F";
    if (!zh) return { qText: "\u6682\u65e0\u9898\u76ee", speakText: pinyin, hint: "", opts: [], correct: 0 };
    if (type === "listen") {
      qText = "🔊 听一听，选出听到的字"; speakText = pinyin; hint = pinyin;
      opts = shuffle([zh].concat(distractor("z", zh, 3))).map(function (z) { var o = findWord(z); return { label: (o && o.k ? T(o.k) + " " : "") + T(z), val: z }; });
      correct = idx(opts, function (x) { return x.val === zh; });
    } else if (type === "pinyin") {
      qText = "「" + zh + "」的拼音是？"; speakText = zh; hint = zh;
      opts = shuffle([pinyin].concat(distractor("p", pinyin, 3))).map(function (p) { return { label: T(p), val: p }; });
      correct = idx(opts, function (x) { return x.val === pinyin; });
    } else if (type === "pic") {
      qText = emoji + " 看图片，选出这个字"; speakText = zh; hint = pinyin;
      opts = shuffle([zh].concat(distractor("z", zh, 3))).map(function (z) { var o = findWord(z); return { label: (o && o.k ? T(o.k) + " " : "") + T(z), val: z }; });
      correct = idx(opts, function (x) { return x.val === zh; });
    } else { /* stroke */
      qText = "「" + zh + "」有几笔？"; speakText = zh; hint = pinyin;
      opts = shuffle([strokes].concat(distractor("n", strokes, 3))).map(function (n) { return { label: T(n), val: n }; });
      correct = idx(opts, function (x) { return x.val === strokes; });
    }
    if (correct < 0) correct = 0;
    if (!opts.length) opts = [{ label: zh, val: zh }];
    return { qText: qText, speakText: speakText, hint: hint, opts: opts, correct: correct };
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
    if (typeof app !== "undefined" && app) return app;
    return document.getElementById("app");
  }
  /* 页面归属检查：#app 里还有 .battle 说明这一局仍在前台。
     一旦被别的视图（玩法列表、结果页、热更重渲染）顶掉，回调必须立刻熄火 ——
     否则「退出游戏后几秒，界面又自己跳回游戏」就是它干的。 */
  function stillMine() {
    var el = appEl();
    return !!(el && el.querySelector(".battle"));
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

  /* 能量星：clip 到 [0, START_STARS]，避免 repeat 收到负数抛错 */
  function starStr(n) {
    var k = Math.round(num(n, 0));
    if (k < 0) k = 0;
    if (k > START_STARS) k = START_STARS;
    return "★".repeat(k) + "☆".repeat(START_STARS - k);
  }

  function setApp(html) {
    /* 最后一道防线：万一还有漏网的 undefined，直接抹掉，
       宁可题目显示得朴素一点，也不能把四个字母甩给孩子看。 */
    if (html.indexOf("undefined") >= 0) {
      window.__battleUndef++;
      try { console.warn("[battle] 渲染里出现 undefined，已清理（第 " + window.__battleUndef + " 次）"); } catch (e) {}
      html = html.split("undefined").join("");
    }
    var el = appEl();
    if (el) el.innerHTML = html;
  }

  function banner(text) {
    var b = document.createElement("div");
    b.className = "b-banner";
    b.innerHTML = '<span class="badge">' + T(text) + "</span>";
    document.body.appendChild(b);
    later(function () { if (b.parentNode) b.parentNode.removeChild(b); }, 1400);
  }

  function alivePlayers() { return S.players.filter(function (p) { return p.alive; }); }
  function loseStar(p) { p.stars--; if (p.stars <= 0) { p.stars = 0; p.alive = false; p.resting = true; } }

  /* ---------- 渲染 ---------- */
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
      ".b-q .qbig{font-size:40px;font-weight:900}" +
      ".b-q .qtext{font-size:16px;font-weight:800;margin:6px 0;color:#333}" +
      ".b-q .qhint{font-size:14px;color:#8a5cf6;font-weight:800;margin-top:4px}" +
      ".b-opts{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:8px 0}" +
      ".b-opt{display:flex;align-items:center;justify-content:center;gap:8px;background:linear-gradient(180deg,#fff,#f3f7ff);border:2px solid #e3e9f5;border-radius:16px;padding:14px 10px;font-size:20px;font-weight:900;color:#234;cursor:pointer;min-height:64px}" +
      ".b-opt:active{transform:scale(.97)}" +
      ".b-opt.correct{background:#d8f5e3;border-color:#37b26a;color:#1f7a45}" +
      ".b-opt.wrong{background:#ffe1e1;border-color:#ef476f;color:#b3233f}" +
      ".b-opt.excl{opacity:.4;text-decoration:line-through;pointer-events:none}" +
      ".b-emoji{font-size:26px}" +
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

  /* 注意：这里必须叫 battleRender，不能叫 render —— 否则会遮蔽 app.js 的全局
     视图 render，退出时本想回玩法列表却调回自己，状态已清空 → 抛异常 → 卡死。 */
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
        (o && o.emoji ? '<span class="b-emoji">' + T(o.emoji) + "</span>" : "") +
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
          '<div class="qtext">' + T(q.qText) + "</div>" +
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
      if (S.buff === "time") { S.time = Math.min(20, S.time + 3); S.left = S.time; banner("🔫 拼音泡泡枪！本题 +3 秒"); }
      if (S.buff === "hint") { S.showHint = true; banner("📜 古诗卷轴发射器！显示拼音提示"); }
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
    if (correct) { me.score++; me.correct++; if (me.correct % 3 === 0) fireLauncher(); }
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
    /* 反馈 */
    var fb = document.getElementById("bfb");
    if (fb) fb.textContent = correct ? "✅ 答对啦！+1 分" : "❌ 掉了一颗星";
    if (!correct && typeof speak === "function") later(function () {
      try {
        var right = (q.opts || [])[q.correct];
        var txt = right ? T(right.label).replace(/^[^\u4e00-\u9fa5]+/, "").trim() : "";
        speak(txt || T(q.speakText));
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
    banner(kind === "time" ? "🔫 拼音泡泡枪已上膛！" : "📜 古诗卷轴发射器已上膛！");
  }

  function afterResolve() {
    if (!S) return;
    var alive = alivePlayers();
    if (!S.players[0].alive) { /* 你出局，快速决出本局知识王者 */ fastForward(); endGame(); return; }
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

  function endGame() {
    clearTimers();
    var alive = alivePlayers();
    if (alive.length > 1) alive.sort(function (a, b) { return (b.stars - a.stars) || (b.score - a.score); });
    var winner = alive[0] || null;
    var youWon = !!(winner && winner.isMe);
    var P = window.PRAISE;
    var head = youWon
      ? (P ? P.block("perfect") : '<div style="text-align:center;font-size:46px">🏆</div><div style="text-align:center;font-size:24px;font-weight:900;color:#e08b00">知识王者！</div>')
      : '<div style="text-align:center;font-size:46px">🪑</div><div style="text-align:center;font-size:20px;font-weight:900;margin:6px 0">你回教室休息啦</div><div style="text-align:center;color:#888">本局知识王者：' + (winner ? T(winner.emoji) + (winner.isMe ? "你" : T(winner.name)) : "—") + "</div>";
    var html =
      '<div class="battle">' + head +
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
    if (typeof state !== "undefined" && state) { state.mode = null; state.view = "modes"; }
    if (typeof window.render === "function") window.render();
  };
  window.battleRestart = function () { battleStop(); startBattle(); };

  /* 遥控器返回键 / 原生返回键统一走这里：
     正在玩 → 收尾并返回玩法列表（返回 true 表示已处理）；没在玩 → 交给页面级返回。 */
  window.__gameExit = null;

  /* ---------- 入口 ---------- */
  function startBattle() {
    buildBank();
    if (!ALLWORDS.length) { if (typeof toast === "function") toast("题库为空"); return; }
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
    if (usedFallback && typeof toast === "function") toast("用内置题库开局");
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
