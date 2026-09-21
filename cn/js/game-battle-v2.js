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
  var START_STARS = 5;         /* 初始能量星（每人 5 颗；掉光即出局） */
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

  /* ---------- 声音系统（2026-09-21 补：之前全程静音） ----------
   *  TTS：原生 speak 桥优先，缺失时用浏览器内置 speechSynthesis 兜底，保证一定有朗读。
   *  sfx：用 Web Audio 即时合成音效，不依赖任何音频文件（无 5MB 限制、离线可用）。 */
  var _nativeSpeak = (typeof speak === "function") ? speak : null;
  var _audioCtx = null;
  function audioCtx() {
    try {
      if (!_audioCtx) { var AC = window.AudioContext || window.webkitAudioContext; if (AC) _audioCtx = new AC(); }
      if (_audioCtx && _audioCtx.state === "suspended") _audioCtx.resume();
    } catch (e) {}
    return _audioCtx;
  }
  /* 按当前学科返回朗读语种 */
  function curLang() {
    return (curSubj() === "en") ? "en-US" : "zh-CN";
  }
  /* 题卡顶部的小标题：数学「算一算」、语文「选一选」、英语「Read & Choose」 */
  function subjectLabel() {
    var s = curSubj();
    if (s === "cn") return "📖 选一选";
    if (s === "en") return "🔤 Read & Choose";
    return "🧮 算一算";
  }
  /* 朗读文本。三级降级，保证任何机型都有声音：
     ① 原生 speak 桥 —— 但它在三科 tts.js 里都有 `if(!settings.tts) return` 门禁，
        设置里一关朗读就全线静音；所以只在桥确实能出声时才用它（见下方 hasTTS）。
     ② 学科自己的音频兜底 speakAudio —— 有道 MP3，电视 / 微信 / 关了朗读设置都能响。
     ③ 浏览器 Web Speech API —— 最后的本地兜底。 */
  function ttsOn() {
    try { if (typeof settings !== "undefined" && settings && !settings.tts) return false; } catch (e) {}
    return true;
  }
  function tts(text, lang) {
    text = T(text); if (!text) return;
    if (!lang) lang = curLang();
    /* ★ 2026-09-21 英语（及所有科）无声的真正根因：
       三科 tts.js 的 speak() 第一行都是「if(!settings.tts || !text) return;」——
       只要设置里关了朗读、或 settings 未初始化，就静默返回。
       手机上数学科还能靠别的路径出声，英语科则全程无声 → 表现为「只有英语没声音」。
       这里不再依赖那个开关：优先学科音频兜底，再退浏览器合成。 */
    var bridged = false;
    if (ttsOn() && _nativeSpeak) { try { _nativeSpeak(text, lang); bridged = true; } catch (e) { bridged = false; } }
    if (bridged) return;
    try { if (typeof window.speakAudio === "function") { window.speakAudio(text); return; } } catch (e) {}
    try {
      if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang; u.rate = 1; u.pitch = 1; u.volume = 1;
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
      }
    } catch (e) {}
  }
  /* 音效：正确/错误/倒计时/出局/夺冠，用振荡器即时合成 */
  function sfx(type) {
    var ac = audioCtx(); if (!ac) return;
    try {
      var now = ac.currentTime, notes = [], dur = 0.18, gain = 0.18, wave = "sine";
      if (type === "correct") { notes = [523.25, 659.25, 783.99]; dur = 0.12; }                 /* C5 E5 G5 上行叮 */
      else if (type === "wrong") { notes = [311.13, 233.08]; dur = 0.22; gain = 0.16; wave = "sawtooth"; } /* Eb4 Bb3 下行嗡 */
      else if (type === "tick") { notes = [880]; dur = 0.07; gain = 0.12; }                      /* 倒计时滴 */
      else if (type === "elim") { notes = [440, 329.63, 246.94]; dur = 0.2; gain = 0.18; wave = "sawtooth"; } /* A4 E4 B3 出局 */
      else if (type === "win") { notes = [523.25, 659.25, 783.99, 1046.5]; dur = 0.18; gain = 0.2; } /* 冠军号角 */
      else return;
      for (var i = 0; i < notes.length; i++) {
        var o = ac.createOscillator(), g = ac.createGain();
        o.type = wave; o.frequency.value = notes[i];
        var t0 = now + i * dur;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g); g.connect(ac.destination);
        o.start(t0); o.stop(t0 + dur + 0.02);
      }
    } catch (e) {}
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

  /* 当前学科：cn / math / en（决定题库来源与题干措辞） */
  function curSubj() {
    try { if (typeof window !== "undefined" && window.APP_SUBJECT) return window.APP_SUBJECT; } catch (e) {}
    try { if (typeof window !== "undefined" && window.HOT_APP) return window.HOT_APP; } catch (e) {}
    /* ★ 2026-09-21 兜底：若全局学科变量都没挂，用脚本自身所在目录名判断，
       否则语文/英语科会被误判成 math → 一直出数学题。 */
    try {
      var sc = document.querySelector('script[src*="game-battle-v2.js"]');
      if (sc) {
        var src = sc.getAttribute("src") || "";
        var m = src.match(/\/(cn|en|math)\/js\//);
        if (m) return m[1];
      }
    } catch (e) {}
    return "math";
  }
  /* 按当前年级过滤题库（取不到 g 就不过滤，保证一定有题） */
  function nowGrade() {
    try { if (typeof state !== "undefined" && state) return num(state.gi, 0) + 1; } catch (e) {}
    return 0;
  }
  function fromLib(lib, g) {
    var a = window[lib]; if (!a || !a.length) return null;
    var gg = nowGrade();
    var f = gg ? a.filter(function (x) { return !x.g || num(x.g, 0) === gg; }) : [];
    return (f.length >= 4) ? f : a;
  }

  /* ---------- 语文题：近反义词 / 成语 / 量词 / 古诗 ---------- */
  function cnQ() {
    var kind = rnd(4);
    try {
      if (kind === 0 || kind === 1) {
        /* 近义词 / 反义词：给出词 a，从选项里选它的近/反义项 */
        var nf = fromLib("NEARFAR", 0); if (!nf) return null;
        var it = pick(nf); if (!it || !it.a || !it.b) return null;
        var isFan = (it.t === "反");
        var right = isFan ? it.b : it.b;
        var opts = [right], guard = 0;
        while (opts.length < 4 && guard++ < 80) {
          var o = pick(nf); if (!o || !o.b) continue;
          /* 干扰项必须与正确项同类型（同为反义/近义），否则一眼排除 */
          if (String(o.t) !== String(it.t)) continue;
          if (opts.indexOf(o.b) < 0 && String(o.b) !== String(it.a)) opts.push(o.b);
        }
        if (opts.length < 4) return null;
        var qs = isFan ? ("选出「" + it.a + "」的反义词") : ("选出「" + it.a + "」的近义词");
        return finalizeQ({ q: qs, a: right, opts: shuffle(opts), say: qs, tip: isFan ? "想想意思相反的那个词" : "想想意思相近的那个词" });
      }
      if (kind === 2) {
        /* 成语释义：给出成语选意思（或给释义选成语） */
        var id = fromLib("IDIOMS", 0); if (!id) return null;
        var i2 = pick(id); if (!i2 || !i2.w || !i2.m) return null;
        var flip = Math.random() < 0.5;
        var r2 = flip ? i2.m : i2.w;
        var opts2 = [r2], g2 = 0;
        while (opts2.length < 4 && g2++ < 90) {
          var o2 = pick(id); if (!o2) continue;
          var cand = flip ? o2.m : o2.w;
          if (cand && opts2.indexOf(cand) < 0 && String(cand) !== String(r2)) opts2.push(cand);
        }
        if (opts2.length < 4) return null;
        var qs2 = flip ? ("「" + i2.w + "」是什么意思？") : ("哪个成语的意思是：" + i2.m + "？");
        return finalizeQ({ q: qs2, a: r2, opts: shuffle(opts2), say: qs2, tip: "联系成语里的字来想" });
      }
      if (kind === 3) {
        /* 量词搭配：一(__)名词 */
        var lc = fromLib("LIANGCI", 0); if (!lc) return null;
        var l1 = pick(lc); if (!l1 || !l1.n || !l1.l) return null;
        var r3 = l1.l, opts3 = [r3];
        (l1.o || []).forEach(function (x) { if (opts3.length < 4 && opts3.indexOf(x) < 0) opts3.push(x); });
        if (opts3.length < 4) return null;
        var qs3 = "一（　）" + l1.n + "　该填哪个量词？";
        return finalizeQ({ q: qs3, a: r3, opts: shuffle(opts3), say: "一" + l1.n + "的量词是什么", tip: "想想平时怎么说话" });
      }
      /* 古诗：给上句选下句 */
      var pm = fromLib("POEMS", 0); if (!pm) return null;
      var p = pick(pm); if (!p || !p.l || p.l.length < 2) return null;
      var li = rnd(p.l.length - 1);
      var head = String(p.l[li]).replace(/[，。？！、；：]$/, "");
      var r4 = String(p.l[li + 1]).replace(/[，。？！、；：]$/, "");
      var opts4 = [r4], g4 = 0;
      while (opts4.length < 4 && g4++ < 120) {
        var p2 = pick(pm); if (!p2 || !p2.l) continue;
        var c2 = String(pick(p2.l)).replace(/[，。？！、；：]$/, "");
        if (c2 && opts4.indexOf(c2) < 0 && c2 !== r4) opts4.push(c2);
      }
      if (opts4.length < 4) return null;
      var qs4 = "《" + p.t + "》下一句是？\n" + head + "，";
      return finalizeQ({ q: qs4, a: r4, opts: shuffle(opts4), say: "诗句接龙，" + head + "，下一句是", tip: "回忆这首诗的原文" });
    } catch (e) { return null; }
  }

  /* ---------- 英语题：看英选中 / 看中选英 / 句子翻译 ---------- */
  function enWords() {
    try {
      var grades = (window.GRADES && window.GRADES.length) ? window.GRADES : ((window.DATA && window.DATA.grades) || []);
      var gg = nowGrade(), pool = [], all = [];
      for (var g = 0; g < grades.length; g++) {
        var books = grades[g].books || [];
        for (var b = 0; b < books.length; b++) {
          var us = books[b].u || [];
          for (var u = 0; u < us.length; u++) {
            var ws = (us[u] && us[u].w) || [];
            for (var k = 0; k < ws.length; k++) {
              var w = ws[k];
              if (w && w.e && w.z) { all.push(w); if (!gg || num(grades[g].g, 0) === gg) pool.push(w); }
            }
          }
        }
      }
      return (pool.length >= 8) ? pool : (all.length >= 8 ? all : null);
    } catch (e) { return null; }
  }
  function enQ() {
    try {
      var pool = enWords(); if (!pool) return null;
      var it = pick(pool); if (!it) return null;
      if (Math.random() < 0.5) {
        /* 看英文选中文 */
        var r = it.z, opts = [r], g = 0;
        while (opts.length < 4 && g++ < 90) {
          var o = pick(pool); if (!o) continue;
          if (o.z && opts.indexOf(o.z) < 0 && o.z !== r) opts.push(o.z);
        }
        if (opts.length < 4) return null;
        var qs = it.e + "　是什么意思？";
        return finalizeQ({ q: qs, a: r, opts: shuffle(opts), say: it.e, speakText: it.e, tip: "读一读这个单词" });
      }
      /* 看中文选英文 */
      var r2 = it.e, opts2 = [r2], g2 = 0;
      while (opts2.length < 4 && g2++ < 90) {
        var o2 = pick(pool); if (!o2) continue;
        if (o2.e && opts2.indexOf(o2.e) < 0 && o2.e !== r2) opts2.push(o2.e);
      }
      if (opts2.length < 4) return null;
      var qs2 = "「" + it.z + "」的英语是？";
      return finalizeQ({ q: qs2, a: r2, opts: shuffle(opts2), say: it.e, speakText: it.e, tip: "想想它在课文里怎么念" });
    } catch (e) { return null; }
  }

  function makeQuestion() {
    var subj = curSubj();
    /* ★ 2026-09-21：语文/英语必须出本科目的题。
       之前只试一次 cnQ() 就落到数学题，导致「语文英语出的都是数学题」。
       现在多试几次，仍失败才退回数学（保证不卡死）。 */
    if (subj === "cn") {
      for (var i = 0; i < 6; i++) { var cq = cnQ(); if (cq) return cq; }
      try { if (typeof log === "function") log("arena: cnQ 取不到题，回退数学题"); } catch (e) {}
    }
    if (subj === "en") {
      for (var j = 0; j < 6; j++) { var eq = enQ(); if (eq) return eq; }
      try { if (typeof log === "function") log("arena: enQ 取不到题，回退数学题"); } catch (e) {}
    }
    var cfg = pick(GENPOOL) || { t: "addsub", max: 10 };
    var q = null, tip = CURTIP, useVert = (typeof genV === "function") && Math.random() < 0.35;
    try { q = useVert ? genV(cfg) : ((typeof genQ === "function") ? genQ(cfg) : null); } catch (e) { q = null; }
    if (useVert && (!q || !q.v)) { try { q = (typeof genQ === "function") ? genQ(cfg) : null; } catch (e2) { q = null; } }
    if (!q || !q.opts || q.opts.length < 2 || q.a === undefined || q.a === null) q = selfQ();
    var isVert = !!(useVert && q && q.v && typeof vertHTML === "function");
    return finalizeQ(q, T(tip) || "先算个位，再算十位", isVert);
  }

  /* 统一整形：题干/选项/正确项/朗读文案 */
  function finalizeQ(q, hint, isVert) {
    var qText = T(q.q); if (!qText) qText = "算一算";
    var opts = (q.opts || []).map(function (o) { return { label: T(o), val: T(o) }; });
    if (opts.length < 2) opts = [{ label: T(q.a), val: T(q.a) }];
    var correct = idx(opts, function (o) { return String(o.val) === String(q.a); });
    if (correct < 0) correct = 0;
    return {
      qText: qText,
      vert: (isVert && typeof vertHTML === "function") ? vertHTML(q.v) : "",
      /* speakText 允许调用方指定（英语题要读英文单词，不能读中文题干） */
      speakText: T(q.speakText) || T(q.say) || qText,
      hint: T(hint),
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

  /* ★ 2026-09-21 修正（用户明确规则）：
   *   每人 5 星；真人答错掉光星也出局（不走"受保护"），走回教室 + 被批评 + 游戏结束。
   *   不再按"局"强制淘汰 AI；淘汰只发生在某人星掉到 0（自然发生）。
   *   8 题后判定：满星 → 真人必第一（受表扬）；不满星 → 星 >= 存活 AI 最高星则第一但被批评；
   *   否则 AI 赢、真人被批评。详见 renderOver()。 */

  /* 人类夺冠特效：彩带 + 皇冠弹入 + 号角音效 + 老师表扬（renderOver 调用，只播一次） */
  function championFX() {
    if (S._fx) return; S._fx = true;
    sfx("win");
    tts("太棒了，你是本局的知识王者！");
    try {
      var colors = ["#ff5b5b", "#ffd23f", "#5fd08a", "#4a86e8", "#b06bff", "#ff9f43"];
      for (var i = 0; i < 44; i++) {
        var c = document.createElement("div");
        c.className = "a-confetti";
        c.style.left = (Math.random() * 100) + "vw";
        c.style.background = colors[rnd(colors.length)];
        c.style.animationDelay = (Math.random() * 0.8) + "s";
        c.style.borderRadius = (Math.random() < 0.5 ? "2px" : "50%");
        document.body.appendChild(c);
        later(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 3800);
      }
    } catch (e) {}
  }

  /* ---------- 装备 / 库存（localStorage 持久化，简单可桩） ---------- */
  function readInv() {
    /* ★ 2026-09-21 修复「兑换(undefined)」：
       JSON.parse("{}") 返回 {} 是真值对象，原写法直接 return 了它，
       attachments/finished 都是 undefined → 界面显示 undefined、++ 变 NaN。
       这里必须逐字段补默认值，而不是只判断外层是不是对象。 */
    var v = null;
    try { v = JSON.parse(localStorage.getItem(INV_KEY) || "null"); } catch (e) { v = null; }
    if (!v || typeof v !== "object") v = {};
    v.attachments = Math.max(0, num(v.attachments, 0));
    v.finished = Math.max(0, num(v.finished, 0));
    return v;
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
      ".arena{max-width:560px;margin:0 auto;padding:6px;font-family:inherit;position:relative;box-sizing:border-box;width:100%;overflow-x:hidden}" +
      ".a-top{display:flex;justify-content:space-between;align-items:center;gap:4px;font-size:12px;font-weight:800;flex-wrap:wrap;margin-bottom:5px}" +
      ".a-top .pill{background:#fff;border:0;border-radius:999px;padding:4px 8px;box-shadow:0 2px 6px rgba(0,0,0,.08)}" +
      ".a-top .stars{color:#e08b00}" +
      /* 舞台：教室 / 操场两层叠加，按 scene 切换可见。
         ★ 2026-09-21 用户反馈「操场宽度占比高」：原 height 固定 230px 太占屏，
         改为按视口高度自适应（手机≈150px、大屏最多 190px），把空间让给题目和选项。 */
      ".a-stage{position:relative;height:150px;max-height:22vh;border-radius:14px;overflow:hidden;background:#cfe8ff;box-shadow:0 4px 12px rgba(0,0,0,.1)}" +
      "@media(min-height:700px){.a-stage{height:180px}}" +
      ".a-scene{position:absolute;inset:0;display:none;align-items:flex-end;justify-content:center;padding-bottom:8px}" +
      ".a-scene.on{display:flex}" +
      ".a-classroom{background:linear-gradient(180deg,#fff3d6,#ffe2a8)}" +
      ".a-classroom:before{content:'🏫 教室';position:absolute;top:8px;left:10px;font-weight:900;color:#a9743a}" +
      ".a-playground{background:linear-gradient(180deg,#bfe9c0,#7fc98a)}" +
      ".a-playground:before{content:'🏟️ 操场';position:absolute;top:8px;left:10px;font-weight:900;color:#2f7a3a}" +
      /* 头像：flex 排开，走路靠 transform translateX（CSS 过渡） */
      ".a-row{display:flex;gap:4px;justify-content:center;align-items:flex-end;width:100%;padding:0 2px;box-sizing:border-box;overflow:hidden}" +
      ".a-avatar{position:relative;flex:1 1 0;min-width:0;max-width:56px;display:flex;flex-direction:column;align-items:center;transition:transform 5s linear}" +
      ".a-avatar .a-body{position:relative;width:100%;max-width:48px;aspect-ratio:1/1;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:26px;box-shadow:0 2px 5px rgba(0,0,0,.15)}" +
      ".a-avatar .a-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}" +
      ".a-avatar .a-name{font-size:11px;font-weight:800;margin-top:2px;background:rgba(255,255,255,.7);border-radius:8px;padding:0 3px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}" +
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
      /* ★ 2026-09-21 用户反馈「选项溢出」：原来 1fr 1fr + 20px 字号 + 大内边距，
         长文本（语文词句/英语句子）会把卡片撑破、被屏幕裁掉。
         改法：minmax(0,1fr) 允许收缩、word-break 强制换行、字号降一档、内边距收紧。 */
      ".a-q{background:#fff;border-radius:14px;padding:10px;margin:6px 0;text-align:center;box-shadow:0 4px 12px rgba(0,0,0,.08);box-sizing:border-box;width:100%;overflow:hidden}" +
      ".a-q .qbig{font-size:26px;font-weight:900;line-height:1.25;word-break:break-word;overflow-wrap:anywhere;white-space:pre-line}" +
      ".a-q .qtext{font-size:15px;font-weight:800;margin:4px 0;color:#333;word-break:break-word}" +
      ".a-q .qhint{font-size:13px;color:#8a5cf6;font-weight:800;margin-top:4px;word-break:break-word}" +
      ".a-opts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;width:100%;box-sizing:border-box}" +
      ".a-opt{display:flex;align-items:center;justify-content:center;background:linear-gradient(180deg,#fff,#f3f7ff);border:2px solid #e3e9f5;border-radius:14px;padding:10px 6px;font-size:17px;font-weight:900;color:#234;cursor:pointer;min-height:52px;min-width:0;box-sizing:border-box;word-break:break-word;overflow-wrap:anywhere;text-align:center;line-height:1.25}" +
      ".a-opt:active{transform:scale(.97)}" +
      ".a-opt.correct{background:#d8f5e3;border-color:#37b26a;color:#1f7a45}" +
      ".a-opt.wrong{background:#ffe1e1;border-color:#ef476f;color:#b3233f}" +
      ".a-opt.excl{opacity:.4;text-decoration:line-through;pointer-events:none}" +
      ".a-timer{height:8px;background:#eef;border-radius:999px;overflow:hidden;margin:5px 0}" +
      ".a-timer>i{display:block;height:100%;background:linear-gradient(90deg,#5fd08a,#f5c542,#ef476f);transition:width .1s linear}" +
      ".a-fb{text-align:center;font-size:15px;font-weight:900;min-height:20px;margin:5px 0}" +
      ".a-bottom{display:flex;gap:6px;margin-top:5px;flex-wrap:wrap;width:100%;box-sizing:border-box}" +
      ".a-bottom button{flex:1 1 30%;min-width:0;border:0;border-radius:12px;padding:9px 6px;font-size:12px;font-weight:800;background:#fff;color:#456;box-shadow:0 2px 6px rgba(0,0,0,.08);cursor:pointer;word-break:break-word}" +
      ".a-cd{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:120px;font-weight:900;color:#fff;text-shadow:0 4px 12px rgba(0,0,0,.4);pointer-events:none}" +
      ".a-banner{position:fixed;left:0;right:0;top:28%;text-align:center;z-index:9999;pointer-events:none}" +
      ".a-banner .badge{display:inline-block;background:rgba(0,0,0,.72);color:#fff;font-size:20px;font-weight:900;padding:12px 22px;border-radius:999px;animation:abp .8s ease}" +
      "@keyframes abp{0%{transform:scale(.5);opacity:0}40%{transform:scale(1.1);opacity:1}100%{transform:scale(1);opacity:1}}" +
      /* 人类夺冠特效 */
      ".a-confetti{position:fixed;top:-24px;width:10px;height:14px;z-index:9998;pointer-events:none;animation:acf 2.8s linear forwards}" +
      "@keyframes acf{0%{transform:translateY(-24px) rotate(0);opacity:1}100%{transform:translateY(106vh) rotate(720deg);opacity:0}}" +
      ".a-crown{display:inline-block;animation:acr .7s ease both}" +
      "@keyframes acr{0%{transform:scale(.3) rotate(-20deg);opacity:0}60%{transform:scale(1.25) rotate(8deg);opacity:1}100%{transform:scale(1) rotate(0)}}";
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
        '<div class="qtext">' + (q.vert ? T(q.qText) : subjectLabel()) + "</div>" +
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
    sfx("tick"); tts(T(String(n)));
    later(function () { countdown(n - 1); }, 1000);
  }

  /* ---------- 题目流程 ---------- */
  function showQuestion() {
    S.phase = "play";
    S.q = makeQuestion();
    S.chosen = -1; S.revealed = false; S.fb = ""; S.left = S.time; S.locked = false; S.showHint = false;
    battleRender();
    later(function () { tts(S.q.speakText); }, 350);
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
    if (correct) { me.score++; sfx("correct"); tts("答对啦，加一分"); }
    else { loseStar(me); sfx("wrong"); later(function () {
      try { var right = (q.opts || [])[q.correct]; tts(right ? T(right.label) : T(q.speakText)); } catch (e) {}
    }, 200); }
    for (var i = 1; i < S.players.length; i++) {
      var p = S.players[i]; if (!p.alive) continue;
      if (Math.random() < SKILL) p.score++; else loseStar(p);
    }
    var fb = document.getElementById("afb");
    if (fb) fb.textContent = correct ? "✅ 答对啦！+1 分" : "❌ 答错了，加油";
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
    if (delayMs && delayMs > 0) later(function () { tts(msg); }, delayMs);
    else tts(msg);
    later(function () { refreshAvatar(i); }, WALK_BACK_MS + 50);
  }

  function afterResolve() {
    if (!S) return;
    /* 真人掉光星 → 走回教室 + 被批评 + 游戏结束（2026-09-21 修正：真人不再受保护） */
    if (!S.players[0].alive) { endGame(); return; }
    var alive = alivePlayers();
    if (alive.length <= 1) { endGame(); return; }
    S.qn++;
    if (S.qn > TOTAL_Q) { endGame(); return; }   /* 8 题后结算（按星判定胜负） */
    later(showQuestion, 1800);                    /* 等本轮掉星回教室动画走完 */
  }

  /* ★ 2026-09-21 修复：原先只调用了 endGame()，但这个函数从来没定义过 ——
     调用时抛 ReferenceError，又被 later() 的 try/catch 静默吞掉，
     表现为「掉光星后界面卡死：没反应、老师不评价、不结束」。
     现在补上真正的收尾：切场景回教室 + 老师语音评价 + 出结算面板。 */
  function endGame() {
    if (!S || S.phase === "over") return;
    S.phase = "over";
    if (S.tick) { clearInterval(S.tick); S.tick = null; }
    var me = S.players[0], meLost = !me.alive;
    /* 舞台切回教室：输了的玩家也走回教室（若还没走过） */
    try {
      var pg = document.getElementById("a-playground"), cls = document.getElementById("a-classroom");
      if (pg) pg.classList.remove("on");
      if (cls) cls.classList.add("on");
    } catch (e) {}
    if (meLost && !me._walked) walkBack(0, 0);
    /* 老师评价：满星表扬，否则一律批评（含中途掉光星出局）。延后一点避免和点名语音叠在一起 */
    var meFull = (me.stars >= START_STARS);
    var talk = meFull
      ? "太棒了，你满星通关，是当之无愧的第一名！"
      : "你没拿满星，老师要批评你，下次要全对哦！";
    later(function () { tts(talk); }, meLost ? 3200 : 500);
    /* 等回教室动画走完再出结算面板，别让面板盖住动画 */
    later(function () { if (S) battleRender(); }, meLost ? 3400 : 1600);
  }

  function renderOver(hud) {
    var me = S.players[0];
    var meFull = (me.stars >= START_STARS);          /* 满星 = 5/5，全程没掉星 */
    /* ★ 2026-09-21 修正（用户明确规则）：8 题后按星判定胜负
       满星        → 真人必第一，受表扬（👑 知识王者）
       不满星且星 ≥ 存活 AI 最高星 → 真人第一，但被批评（没拿满星）
       不满星且星 < 存活 AI 最高星 → AI 赢，真人被批评 */
    var board = alivePlayers().slice();
    board.sort(function (a, b) { return (b.stars - a.stars) || (b.score - a.score); });
    if (meFull && (!board[0] || !board[0].isMe)) board = [me].concat(board.filter(function (p) { return !p.isMe; }));
    var winner = board[0] || me;
    var youWon = !!winner.isMe;
    var youPraised = meFull;                          /* 只有满星才受表扬 */
    S._praised = youPraised;
    if (youWon) {
      var v = attachPiece();
      banner("🏆 冠军奖励 +1 配件（共 " + v.attachments + "）");
      if (youPraised) championFX();                   /* 满星才放彩带皇冠 */
    }
    var rival = null;
    for (var i = 0; i < board.length; i++) if (!board[i].isMe) { rival = board[i]; break; }
    var head;
    if (youPraised) {
      head =
        '<div style="text-align:center;font-size:52px" class="a-crown">👑</div>' +
        '<div style="text-align:center;font-size:26px;font-weight:900;color:#e08b00">知识王者！满星通关</div>' +
        '<div style="text-align:center;font-size:13px;color:#8a5cf6;font-weight:800;margin-top:4px">👩‍🏫 老师：太棒了，你满星通关，是当之无愧的第一名！</div>' +
        (rival ? '<div style="text-align:center;color:#888;margin-top:4px">亚军：' + T(rival.emoji) + T(rival.name) + "（" + num(rival.stars, 0) + " 星）</div>" : "");
    } else if (youWon) {
      head =
        '<div style="text-align:center;font-size:48px">🥇</div>' +
        '<div style="text-align:center;font-size:22px;font-weight:900">你得了第一名</div>' +
        '<div style="text-align:center;font-size:13px;color:#ef7d57;font-weight:800;margin-top:4px">👩‍🏫 老师：你拿了第一，但没满星，要批评你，下次要全对！</div>';
    } else {
      head =
        '<div style="text-align:center;font-size:46px">🪑</div>' +
        '<div style="text-align:center;font-size:20px;font-weight:900;margin:6px 0">你被淘汰啦，回教室好好学习</div>' +
        '<div style="text-align:center;color:#8a5cf6;font-weight:800">👩‍🏫 老师：你比 ' + (rival ? T(rival.name) : "同学") + ' 少了一颗星，下次加油！</div>';
    }
    hud.innerHTML = head +
      '<div style="text-align:center;font-size:15px;font-weight:800;margin:8px 0">本局得分 ' + num(me.score, 0) + ' 分 · ' + (meFull ? "满星 ⭐⭐⭐⭐⭐" : ("剩 " + num(me.stars, 0) + " 星")) + "</div>" +
      '<div style="text-align:center;font-size:13px;color:#888">🎒 配件 ' + readInv().attachments + " · 成品 " + readInv().finished + "</div>" +
      '<div class="a-bottom" style="margin-top:12px">' +
        '<button onclick="arenaTeacherTalk()">🔊 听老师</button>' +
        '<button style="background:linear-gradient(180deg,#5fd08a,#37b26a);color:#fff" onclick="arenaRestart()">🔁 再来一局</button>' +
        '<button style="background:linear-gradient(180deg,#ff7b7b,#ef476f);color:#fff" onclick="arenaExit()">🏠 返回</button>' +
      "</div>";
  }

  /* 结算页重听老师评价（赢了表扬 / 输了鼓励） */
  window.arenaTeacherTalk = function () {
    if (!S) return;
    var talk = S._praised
      ? "太棒了，你满星通关，是当之无愧的第一名！"
      : "你没拿满星，老师要批评你，下次要全对哦！";
    tts(talk);
  };

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
  window.arenaReplay = function () { if (S && S.q) tts(S.q.speakText); };
  window.arenaTeacher = function () { tts("同学们，准备开始答题闯关！"); };
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
  /* 自检探针：供热更自检面板/自动化测试确认「本科目出的是本科目的题」 */
  window.__arenaProbe = function (n) {
    var out = [], subj = curSubj();
    for (var i = 0; i < (n || 5); i++) {
      var q = makeQuestion();
      out.push({ q: q.qText, a: q.opts[q.correct] && q.opts[q.correct].label, subj: subj, opts: q.opts.length });
    }
    return { subj: subj, samples: out };
  };
  registerGame({
    id: "arena2",
    name: "知识圈竞赛2",
    icon: "🏆",
    desc: "6 人答题生存赛：老师带队去操场，答对活、掉星回教室罚站！",
    start: startArena
  });

  /* ===================== 一键热更（电视端救命入口） =====================
   * ★ 2026-09-21 用户反馈：电视端热更「从没成功过」，手机端正常。
   *   根因不在下载本身，而在 boot.js 的后台更新时机（启动 3 秒后才开始拉，
   *   两个 zip 合计 ~4.2MB，装完才提示「下次打开生效」）——
   *   电视端看完就关机，4.2MB 没下完就被中断，而 boot.js 本轮直接放弃重试。
   *   boot.js 是冻结文件，改不得（手册 §0 铁律），所以在这里重做一遍：
   *   用户主动点 → 立刻下载 → 进度可见 → 失败可重试 → 装完提示重启。
   *   用的还是原生桥那几个公开方法（httpGet / installPack），不碰任何冻结文件。 */
  var _hotPend = [], _hotBase = "", _hotBuild = "", _hotMine = false;
  window.hotNowCheck = function () {
    var H = window.AndroidHot;
    if (!H || typeof H.httpGet !== "function") { hotSetMsg("❌ 本机没有热更桥（浏览器预览模式）"); return; }
    hotSetMsg("🔍 正在检查更新…");
    var base = window.HOT_BASE || "";
    if (!base) { hotSetMsg("❌ 取不到热更源地址"); return; }
    _hotBase = base;
    try { H.httpGet(base + "pack/manifest.json?t=" + Date.now(), "__hotNowManifest"); }
    catch (e) { hotSetMsg("❌ 检查失败：" + e.message); }
  };
  function hotSetMsg(s) {
    var t = document.getElementById("hotNowMsg");
    if (t) t.innerHTML = T(s);
  }
  window.__hotNowManifest = function (txt) {
    if (txt == null) { hotSetMsg("❌ 连不上热更源，请检查电视网络后重试"); return; }
    var m = null; try { m = JSON.parse(txt); } catch (e) { hotSetMsg("❌ 清单格式异常"); return; }
    if (!m || !m.build) { hotSetMsg("❌ 清单缺少 build"); return; }
    var cur = "";
    try { cur = (window.AndroidHot && window.AndroidHot.manifest && JSON.parse(window.AndroidHot.manifest() || "{}").build) || ""; } catch (e) {}
    if (!cur) cur = window.__HOT_BUILD || "";
    if (cur === m.build) { hotSetMsg("✅ 已是最新（build=" + m.build + "）"); return; }
    _hotBuild = m.build;
    _hotPend = (m.packs && m.packs.length) ? m.packs.slice() : [];
    if (!_hotPend.length) { hotSetMsg("❌ 清单里没有分包"); return; }
    _hotMine = true;                     /* 标记：接下来这一串回调属于本次手动更新 */
    hotSetMsg("⬇️ 开始下载 " + _hotPend.length + " 个分包…");
    hotInstallNext();
  };
  function hotInstallNext() {
    if (!_hotPend.length) {
      _hotMine = false;
      hotSetMsg("🎉 下载完成！<b>请完全退出 App 再重新打开</b>，新内容即生效。");
      try { if (typeof window.toast === "function") window.toast("新内容已就绪，请重启 App"); } catch (e) {}
      return;
    }
    var pk = _hotPend.shift();
    hotSetMsg("⬇️ 正在下载 " + T(pk.name) + "（剩 " + (_hotPend.length + 1) + " 个）… " +
      Math.round((num(pk.size, 0) / 1048576) * 10) / 10 + "MB");
    try {
      /* ★ 原生桥 installPack(url, sha256) 只有两个参数，回调名硬编码为
         window.__onHotPack / window.__onHotProgress，无法自定义第三个参数。
         所以这里必须复用同一组回调，靠 _hotMine 标记分流：
         是我发起的 → 推进我自己的面板；是 boot.js 的 → 交回给 boot.js。
         下面在 installPack 之后包一层 __onHotPack，两条通道互不打断。 */
      _installHook();
      window.AndroidHot.installPack(_hotBase + pk.name + "?b=" + _hotBuild, pk.sha256 || "");
    } catch (e) { _hotMine = false; hotSetMsg("❌ 下载失败：" + e.message); }
  }
  /* 把 __onHotPack / __onHotProgress 包一层：我这条线优先，其余原样交给 boot.js */
  var _origPack = null, _origProg = null;
  function _installHook() {
    if (_origPack) return;                       /* 只包一次 */
    _origPack = window.__onHotPack || null;
    _origProg = window.__onHotProgress || null;
    window.__onHotPack = function (st, msg) {
      if (_hotMine) {
        if (st === "ok" || st === true) { hotInstallNext(); return; }
        _hotMine = false;
        hotSetMsg("❌ 分包安装失败（" + T(st) + (msg ? " " + T(msg) : "") + "），可再点一次重试");
        return;
      }
      if (typeof _origPack === "function") return _origPack.apply(this, arguments);
    };
    window.__onHotProgress = function (done) {
      if (_hotMine && done > 0) { hotSetMsg("⬇️ 已下载 " + (done / 1048576).toFixed(1) + "MB…"); return; }
      if (typeof _origProg === "function") return _origProg.apply(this, arguments);
    };
  }
  try { if (typeof log === "function") log("arena registered, GAMES=" + ((window.GAMES && window.GAMES.length) || 0)); } catch (e) {}
})();
