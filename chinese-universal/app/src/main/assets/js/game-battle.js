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

  var ALLWORDS = [];
  function buildBank() {
    ALLWORDS = [];
    var grades = (window.DATA && window.DATA.grades) || (window.GRADES) || [];
    var src = grades;
    if (grades && grades.grades) src = grades.grades; /* 兜底：有的结构是 {grades:[...]} */
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
  }

  function rnd(n) { return Math.floor(Math.random() * n); }
  function pick(a) { return a[rnd(a.length)]; }
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

  /* 动态出一道语文题：4 种题型轮换（听音选字 / 看字选拼音 / 看图选字 / 笔画数） */
  function makeQuestion() {
    var w = pick(ALLWORDS) || {};
    var type = pick(["listen", "pinyin", "pic", "stroke"]);
    var opts = [], correct = 0, qText = "", speakText = "", hint = "";
    /* 字段兜底：任何一处取不到也只降级成空串/默认图，绝不在界面上出现 undefined */
    var pinyin = w.p || "", zh = w.z || "", strokes = w.n || 0, emoji = w.k || "\uD83D\uDDBC\uFE0F";
    if (!zh) return { qText: "\u6682\u65e0\u9898\u76ee", speakText: pinyin, hint: "", opts: [], correct: 0 };
    if (type === "listen") {
      qText = "🔊 听一听，选出听到的字"; speakText = pinyin; hint = pinyin;
      opts = shuffle([zh].concat(distractor("z", zh, 3))).map(function (z) { var o = findWord(z); return { label: ((o && o.k) ? o.k + " " : "") + z, val: z }; });
      correct = idx(opts, function (x) { return x.val === zh; });
    } else if (type === "pinyin") {
      qText = "「" + zh + "」的拼音是？"; speakText = zh; hint = zh;
      opts = shuffle([pinyin].concat(distractor("p", pinyin, 3))).map(function (p) { return { label: p, val: p }; });
      correct = idx(opts, function (x) { return x.val === pinyin; });
    } else if (type === "pic") {
      qText = emoji + " 看图片，选出这个字"; speakText = zh; hint = pinyin;
      opts = shuffle([zh].concat(distractor("z", zh, 3))).map(function (z) { var o = findWord(z); return { label: ((o && o.k) ? o.k + " " : "") + z, val: z }; });
      correct = idx(opts, function (x) { return x.val === zh; });
    } else { /* stroke */
      qText = "「" + zh + "」有几笔？"; speakText = zh; hint = pinyin;
      opts = shuffle([strokes].concat(distractor("n", strokes, 3))).map(function (n) { return { label: String(n), val: n }; });
      correct = idx(opts, function (x) { return x.val === strokes; });
    }
    return { qText: qText, speakText: speakText, hint: hint, opts: opts, correct: correct };
  }

  /* ---------- 运行时状态 ---------- */
  var S = null;
  var timers = [];
  function clearTimers() { timers.forEach(function (t) { clearInterval(t); clearTimeout(t); }); timers = []; }
  function later(fn, ms) { var t = setTimeout(fn, ms); timers.push(t); return t; }
  function every(fn, ms) { var t = setInterval(fn, ms); timers.push(t); return t; }

  function starStr(n) { return "★".repeat(n) + "☆".repeat(START_STARS - n); }

  function setApp(html) {
    var el = (typeof app !== "undefined" && app) ? app : document.getElementById("app");
    if (el) el.innerHTML = html;
  }

  function banner(text) {
    var b = document.createElement("div");
    b.className = "b-banner";
    b.innerHTML = '<span class="badge">' + text + "</span>";
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

  function render() {
    var q = S.q;
    var me = S.players[0];
    var timeLeft = Math.ceil(S.left);
    var chips = S.players.map(function (p) {
      return '<div class="b-chip ' + (p.isMe ? "me " : "") + (p.resting ? "dead" : "") + '">' +
        '<div class="ce">' + p.emoji + "</div>" +
        '<div>' + (p.isMe ? "你" : p.name) + "</div>" +
        '<div class="cs">' + (p.resting ? "休息" : starStr(p.stars)) + "</div></div>";
    }).join("");
    var optsHtml = q.opts.map(function (o, i) {
      var cls = "b-opt";
      var tag = "";
      if (S.revealed) {
        if (i === q.correct) cls += " correct";
        else if (S.chosen === i) cls += " wrong";
        else if (S.excluded === i) cls += " excl";
      } else if (S.excluded === i) {
        cls += " excl";
      }
      return '<button class="' + cls + '" onclick="battleAnswer(' + i + ')">' +
        (o.emoji ? '<span class="b-emoji">' + o.emoji + "</span>" : "") +
        '<span>' + o.label + "</span></button>";
    }).join("");
    var chargePct = Math.round((S.launchCharge / 3) * 100);
    var html =
      '<div class="battle">' +
        '<div class="b-top">' +
          '<button class="pill" onclick="battleExit()" style="cursor:pointer">← 退出</button>' +
          '<span class="pill">👥 剩 ' + alivePlayers().length + "</span>" +
          '<span class="pill b-stars">⭐' + starStr(me.stars) + "</span>" +
          '<span class="pill">分 ' + me.score + "</span>" +
          '<span class="pill">⏱ ' + timeLeft + "</span>" +
        "</div>" +
        '<div class="b-players">' + chips + "</div>" +
        '<div class="b-q">' +
          '<div class="qtext">' + q.qText + "</div>" +
          (q.hint && S.showHint ? '<div class="qhint">💡 提示：' + q.hint + "</div>" : "") +
          '<button class="pill" style="margin-top:6px;cursor:pointer" onclick="battleReplay()">🔊 读题</button>' +
        "</div>" +
        '<div class="b-timer"><i style="width:' + (S.left / S.time * 100) + '%"></i></div>' +
        '<div class="b-opts">' + optsHtml + "</div>" +
        '<div class="b-fb" id="bfb">' + (S.fb || "") + "</div>" +
        '<div class="b-bottom">' +
          '<button onclick="battleHint()"' + (S.hintUsed ? " disabled style=\"opacity:.4\"" : "") + ">💡 提示" + (S.hintUsed ? "(已用)" : "") + "</button>" +
          '<div class="charge">📡 知识发射器<div class="b-bar"><i style="width:' + chargePct + '%"></i></div>' + S.launchCharge + "/3</div>" +
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
    render();
    if (typeof speak === "function") later(function () { try { speak(S.q.speakText); } catch (e) {} }, 350);
    var last = Date.now();
    S.tick = every(function () {
      var now = Date.now();
      S.left -= (now - last) / 1000; last = now;
      if (S.left <= 0) { S.left = 0; render(); if (!S.locked) battleAnswer(-1); return; }
      var bar = document.querySelector(".b-timer>i");
      if (bar) bar.style.width = (S.left / S.time * 100) + "%";
      var t = document.querySelector(".b-top .pill:last-child");
      if (t) t.textContent = "⏱ " + Math.ceil(S.left);
    }, 100);
    timers.push(S.tick);
  }

  /* 真人或超时作答：idx 为选项下标，-1 表示超时 */
  function battleAnswer(idx) {
    if (S.locked) return;
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
    if (!correct && typeof speak === "function") later(function () { try { speak(q.opts[q.correct].label.replace(/^[^\u4e00-\u9fa5]+/, "").trim() || q.speakText); } catch (e) {} }, 200);
    render();
    later(afterResolve, 1700);
  }

  function duel() {
    var alive = alivePlayers();
    if (alive.length < 2) return;
    var a = pick(alive), b = pick(alive.filter(function (x) { return x !== a; }));
    var aOk = a.isMe ? (S.chosen === S.q.correct) : a.answered;
    var bOk = b.isMe ? (S.chosen === S.q.correct) : b.answered;
    var winner = null, loser = null;
    if (aOk && !bOk) { winner = a; loser = b; }
    else if (bOk && !aOk) { winner = b; loser = a; }
    banner("⚔️ 知识对决！" + (winner ? (winner.isMe ? "你" : winner.name) + " 发射知识泡泡 🫧" : ""));
    if (loser) later(function () { loseStar(loser); }, 300);
  }

  function fireLauncher() {
    S.launchCharge = 0;
    var kind = Math.random() < 0.5 ? "time" : "hint";
    S.buff = kind;
    banner(kind === "time" ? "🔫 拼音泡泡枪已上膛！" : "📜 古诗卷轴发射器已上膛！");
  }

  function afterResolve() {
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
        if (alive.length >= 2) { var l = pick(alive); loseStar(l); }
      }
    }
  }

  function endGame() {
    clearTimers();
    var alive = alivePlayers();
    if (alive.length > 1) alive.sort(function (a, b) { return (b.stars - a.stars) || (b.score - a.score); });
    var winner = alive[0];
    var youWon = winner && winner.isMe;
    var P = window.PRAISE;
    var head = youWon
      ? (P ? P.block("perfect") : '<div style="text-align:center;font-size:46px">🏆</div><div style="text-align:center;font-size:24px;font-weight:900;color:#e08b00">知识王者！</div>')
      : '<div style="text-align:center;font-size:46px">🪑</div><div style="text-align:center;font-size:20px;font-weight:900;margin:6px 0">你回教室休息啦</div><div style="text-align:center;color:#888">本局知识王者：' + (winner ? winner.emoji + (winner.isMe ? "你" : winner.name) : "—") + "</div>";
    var html =
      '<div class="battle">' + head +
      '<div class="b-players">' + S.players.map(function (p) {
        return '<div class="b-chip ' + (p.resting ? "dead" : "") + (p.isMe && youWon ? "me" : "") + '"><div class="ce">' + p.emoji + '</div><div>' + (p.isMe ? "你" : p.name) + '</div><div class="cs">' + (p.resting ? "休息" : "⭐" + p.stars) + " · " + p.score + "分</div></div>";
      }).join("") + "</div>" +
      '<div class="b-row">' +
        '<button style="background:linear-gradient(180deg,#5fd08a,#37b26a)" onclick="battleRestart()">🔁 再来一局</button>' +
        '<button style="background:linear-gradient(180deg,#ff7b7b,#ef476f)" onclick="battleExit()">🏠 返回</button>' +
      "</div></div>";
    setApp(html);
    if (P) later(function () { try { P.fx(youWon ? "perfect" : "good"); } catch (e) {} }, 250);
  }

  /* ---------- 公开控制（绑定到 button onclick） ---------- */
  window.battleAnswer = battleAnswer;
  window.battleReplay = function () { if (S && S.q && typeof speak === "function") { try { speak(S.q.speakText); } catch (e) {} } };
  window.battleHint = function () {
    if (!S || S.hintUsed || S.revealed) return;
    var wrongs = [];
    S.q.opts.forEach(function (o, i) { if (i !== S.q.correct && i !== S.excluded) wrongs.push(i); });
    if (!wrongs.length) return;
    S.excluded = pick(wrongs); S.hintUsed = true; render();
  };
  window.battleExit = function () { clearTimers(); S = null; if (typeof state !== "undefined") { state.view = "modes"; if (typeof render === "function") render(); } };
  window.battleRestart = function () { clearTimers(); startBattle(); };

  /* ---------- 入口 ---------- */
  function startBattle() {
    buildBank();
    if (!ALLWORDS.length) { if (typeof toast === "function") toast("题库为空"); return; }
    ensureStyle();
    clearTimers();
    var players = [{ name: "你", emoji: "🧒", isMe: true, alive: true, resting: false, stars: START_STARS, score: 0, correct: 0, answered: false }];
    for (var i = 0; i < AI_NAMES.length; i++) players.push({ name: AI_NAMES[i], emoji: AI_EMOJI[i], isMe: false, alive: true, resting: false, stars: START_STARS, score: 0, correct: 0, answered: false });
    S = {
      players: players, qn: 1, time: BASE_TIME, left: BASE_TIME, locked: false,
      launchCharge: 0, buff: null, showHint: false, hintUsed: false, excluded: null,
      shrink: 0, q: null, chosen: -1, revealed: false, fb: "", tick: null
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
