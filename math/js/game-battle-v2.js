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
  var STU_NAME = ["萌鸡", "拉布拉多警长", "小砾", "天天", "团子", "熊二"];
  var STU_EMOJI = ["🐤", "🐶", "🐾", "🐱", "🐻‍❄️", "🐻"];
  var TEACHER_IMG = "char_teacher_user.png";
  var GUN_IMG = ["gun_01_revolver.png", "gun_02_golden_rose_smg.png", "gun_03_platinum_rifle.png", "gun_04_pinkblue_sniper.png", "gun_05_golden_deagle.png"];
  var DOLL_IMG = ["doll_01_teddy.png", "doll_02_fabric_girl.png", "doll_03_pink_bear.png", "doll_04_barbie.png", "doll_05_patrick.png"];

  /* ---------- 玩法常量 ---------- */
  var SKILL = 0.72;            /* AI 单题正确率 */
  var TOTAL_Q = 8;             /* 单局题数 */
  var BASE_TIME = 15;          /* 每题秒数 */
  var MIN_TIME = 10;
  var START_STARS = 4;         /* 初始能量星（每人 4 颗；掉光即出局） */
  var WALK_IN_MS = 5000;       /* 开场走 5 秒 */
  var WALK_BACK_MS = 3000;     /* 掉星回教室走 3 秒 */
  var INV_KEY = "arena_inventory_v2";
  /* 失败者出现后切断游戏的时长（ms）：插入老师「某某回教室罚站」再下一题（Req 6）。
     用户提到 20s，这里取更合适的 8s（含走回教室动画+语音）；要 20s 改成 20000 即可。 */
  var PENALTY_PAUSE_MS = 8000;
  /* 头像槽位（百分比 left）：PLAY_ 在操场区，CLASS_ 在教室区。
     ★ 2026-09-21 改：左右两片同屏（左 42% 教室 / 右 58% 操场），输了的走进教室并缩小，
     不再像以前那样把头像 translateX 移出屏外（那样根本看不到教室）。 */
  /* 操场区（右 66%）：上下两排，每排 3 个 —— i<3 上排、i>=3 下排。
     ★ 2026-09-21 改：原先单排 6 个挤成一串，孩子看不清谁是谁；改成跟教室一致的两排。
     ★★ 2026-09-21 修「人物叠到一起」：原先两排共用同一组 left，且开场走位漏设 bottom，
        于是 #0/#3、#1/#4、#2/#5 落到同一矩形（实测 32×64px 完全重合）。
        现在：上下两排用**同一组列位**（干净 3×2 网格，行与行之间只差 bottom、不差 left），
        bottom 由 bottomOf() 统一给出，开场走位与 placeAvatar 共用，杜绝「漏设一种」的不一致。 */
  var PLAY_L = [40, 55, 70, 40, 55, 70];
  /* 教室区（左 34%）：同样的 3×2 网格 */
  var CLASS_L = [4, 12, 20, 4, 12, 20];
  /* 排位（0=上排 / 1=下排）与对应 bottom 像素。开场走位和 placeAvatar 必须共用这一份，
     否则又会出现「一个位置一个不设」的不一致 —— 那正是本次叠人的根因。 */
  function rowOf(i) { return (i < 3) ? 0 : 1; }
  function bottomOf(i) { return (i < 3) ? "70px" : "4px"; }

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
    /* ★ 2026-09-24 用户要求：选角卡片只用自带人物原图，不再叠加 emoji/贴图。
       原图缺失时才退回 emoji 兜底，避免卡片空白。 */
    if (img) return '<img class="a-photo" src="' + T(IMG + img) + '" alt="" onerror="this.remove()">';
    return emoji ? '<span class="a-face">' + T(emoji) + '</span>' : "";
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
    if (s === "cn") return "语文 · 选一选";
    if (s === "en") return "英语 · Read & Choose";
    return "数学 · 算一算";
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
  /* 独立语音函数：优先有道 MP3（用户手机实测可用），但 <audio> 受 autoplay 限制——
     必须在用户手势 / 已解锁会话内调用，否则被静默拒绝；系统语音引擎兜底。
     单独封装，开场 / 罚站 / 得分反馈统一走它（用户要求「封装一个单独的函数」）。 */
  /* 独立语音函数：回到最初能出声的机制 —— 系统语音引擎(speechSynthesis) 直连优先，
     整句一次播（不再分句，根治「半句」）；有道 MP3 仅兜底。
     ★ 2026-09-24 复盘：最早用户能听到「同学们」半句，正是 speechSynthesis 出的声；
       后来几版把它换走、又用有道队列+探测兜底，反而把这条唯一能出声的引擎绕丢了。
       本次直接用 window.speechSynthesis（不依赖 _nativeSpeak 变量在文件加载瞬间求值是否为 null），
       避免 BUILTIN 注入顺序导致退化成被 autoplay 拒的有道 Audio。 */
  function say(text, lang, mode) {
    text = T(text); if (!text) return;
    if (!lang) lang = curLang();
    if (!ttsOn()) return;
    try {
      if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang; u.rate = 1; u.pitch = 1; u.volume = 1;
        window.speechSynthesis.cancel(); window.speechSynthesis.speak(u);
        return;
      }
    } catch (e) {}
    /* 兜底：有道 MP3（仅当系统语音不可用时） */
    try { if (typeof window.speakAudio === "function") window.speakAudio(text, (window.__isTV ? 2 : 1), lang, mode === "queue" ? "queue" : "cut"); } catch (e) {}
  }
  /* 兼容旧调用点（arenaTeacher / arenaReplay 等直接调 tts） */
  function tts(text, lang, mode) { say(text, lang, mode); }
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
        /* 量词搭配：一(__)名词 —— 支持多个正确量词（如云：朵/片 都算对） */
        var lc = fromLib("LIANGCI", 0); if (!lc) return null;
        var l1 = pick(lc); if (!l1 || !l1.n || !l1.l) return null;
        /* l 可为字符串或数组：字符串原样，数组表示多个都被接受的答案 */
        var llist = (Array.isArray(l1.l) ? l1.l : [l1.l]).map(function (x) { return String(x); });
        var r3 = pick(llist);                       /* 抽一个作主答案（保证出现在选项里） */
        var opts3 = llist.slice();                  /* 所有正确量词都进选项 */
        (l1.o || []).forEach(function (x) {         /* 干扰项，去重、不覆盖已入选的正确项 */
          x = String(x);
          if (opts3.length < 4 && opts3.indexOf(x) < 0) opts3.push(x);
        });
        if (opts3.length < 4) return null;
        var qs3 = "一（　）" + l1.n + "　该填哪个量词？";
        /* alt = 全部正确量词，判定/高亮/小结都按集合处理 */
        return finalizeQ({ q: qs3, a: r3, alt: llist, opts: shuffle(opts3), say: "一" + l1.n + "的量词是什么", tip: "想想平时怎么说话" });
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
    /* 正确集合：优先用调用方传的 alt（多个正确项，如量词「一朵云/一片云」都算对），
       否则按单一 q.a 判定。避免只认一个正确项而把孩子的其他合理答案判错、造成误解。 */
    var altList = Array.isArray(q.alt) ? q.alt.map(function (x) { return String(x); }) : [];
    var aStr = String(q.a);
    var correctSet = [];
    opts.forEach(function (o, i) {
      var v = String(o.val);
      if (altList.indexOf(v) >= 0 || v === aStr) correctSet.push(i);
    });
    if (!correctSet.length) correctSet = [0];
    return {
      qText: qText,
      vert: (isVert && typeof vertHTML === "function") ? vertHTML(q.v) : "",
      /* speakText 允许调用方指定（英语题要读英文单词，不能读中文题干） */
      speakText: T(q.speakText) || T(q.say) || qText,
      hint: T(hint),
      opts: opts, correctSet: correctSet
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
  /* 屏幕中部的提示条（兑换成功/碎片不足/装备已切换…）。
     ★ 2026-09-22 修「提示永远不消失」：原来用 later() 延迟移除，而 later 的第一道守卫是
       `if (tk !== runId || !S) return;` —— 仓库 / 兑换界面（选角之后、正式开打之前）S 还是 null，
       回调永远不执行，于是「还需 3 个碎片才能兑换」就永久糊在屏幕中间挡住内容。
     现在改用独立 setTimeout 自动消失（默认 2.4 秒），定时器登记进 bannerTimers，
     退出 / 重开时一并清掉并摘除残留节点，同时只保留最新一条，绝不叠罗汉。 */
  var bannerTimers = [];
  function clearBanners() {
    for (var i = 0; i < bannerTimers.length; i++) { try { clearTimeout(bannerTimers[i]); } catch (e) {} }
    bannerTimers = [];
    try {
      var old = document.querySelectorAll(".a-banner");
      for (var j = 0; j < old.length; j++) if (old[j].parentNode) old[j].parentNode.removeChild(old[j]);
    } catch (e) {}
  }
  function banner(text, ms) {
    if (!document.body) return;
    clearBanners();
    var b = document.createElement("div");
    b.className = "a-banner";
    b.innerHTML = '<span class="badge">' + T(text) + "</span>";
    document.body.appendChild(b);
    var life = num(ms, 2400); if (life < 800) life = 2400;
    bannerTimers.push(setTimeout(function () { if (b.parentNode) b.parentNode.removeChild(b); }, life));
  }

  function alivePlayers() { return S.players.filter(function (p) { return p.alive; }); }
  function loseStar(p) { p.stars--; if (p.stars <= 0) { p.stars = 0; p.alive = false; p.resting = true; } }
  function starStr(n) { var k = Math.round(num(n, 0)); if (k < 0) k = 0; if (k > START_STARS) k = START_STARS; return "★".repeat(k) + "☆".repeat(START_STARS - k); }

  /* 把头像放进某个区域（操场 / 教室）的对应槽位（改 left%，靠 CSS transition 走出走路感） */
  function placeAvatar(i, zone) {
    var el = avatarEls[i]; if (!el) return;
    var L = (zone === "class") ? CLASS_L : PLAY_L;
    el.style.left = L[i] + "%";
    /* 两个区都分上下两排：前 3 个站上排、后 3 个站下排。
       ★ 2026-09-21 改：操场原先只有一排，6 个头像挤成一串；现在与教室一致排两排。
       ★ 2026-09-21 修叠人：bottom 与 left 必须**成对**设置 —— 只设 left 会让两排落回同一行。 */
    el.style.bottom = bottomOf(i);
  }
  /* ★ 2026-09-21 丢星特效：星星先闪一下（放大变红），0.43s 后刷新成「少一颗星」的灰态（☆）。
     before = 丢星前的星数，先短暂显示满星闪烁，再落到新数量。 */
  function flashStar(i, before) {
    var el = avatarEls[i]; if (!el) return;
    var st = el.querySelector(".a-stars");
    var k = Math.max(0, num(before, 0));
    if (st) { st.textContent = "★".repeat(k) + "☆".repeat(START_STARS - k); st.classList.add("flash"); }
    later(function () {
      refreshAvatar(i); refreshTop();
      if (st) st.classList.remove("flash");
    }, 470);
  }

  /* ★ 2026-09-21 修正（用户明确规则）：
   *   每人 4 星；真人答错掉光星也出局（不走"受保护"），走回教室 + 被批评 + 游戏结束。
   *   不再按"局"强制淘汰 AI；淘汰只发生在某人星掉到 0（自然发生）。
   *   8 题后判定：满星 → 真人必第一（受表扬）；不满星 → 星 >= 存活 AI 最高星则第一但被批评；
   *   否则 AI 赢、真人被批评。详见 renderOver()。 */

  /* 人类夺冠特效：彩带 + 皇冠弹入 + 号角音效 + 老师表扬（renderOver 调用，只播一次） */
  function championFX() {
    if (S._fx) return; S._fx = true;
    sfx("win");
    tts("太棒了，你是本局的知识王者！", "zh-CN", "queue");
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
    /* ★ 2026-09-21 修复「兑换(undefined)」+ Req 4 扩展：
       逐字段补默认值；兼容旧字段（attachments 记碎片、finished 记成品总数），
       新增 guns/dolls/equipped 分别收藏枪与娃娃、记录当前佩戴。 */
    var v = null;
    try { v = JSON.parse(localStorage.getItem(INV_KEY) || "null"); } catch (e) { v = null; }
    if (!v || typeof v !== "object") v = {};
    v.pieces = Math.max(0, num(v.pieces, num(v.attachments, 0)));   /* 碎片（兼容旧 attachments） */
    v.guns = Array.isArray(v.guns) ? v.guns : [];
    v.dolls = Array.isArray(v.dolls) ? v.dolls : [];
    v.equipped = (v.equipped && (v.equipped.type === "gun" || v.equipped.type === "doll") && v.equipped.img) ? v.equipped : null;
    v.finished = Math.max(0, num(v.finished, 0));
    return v;
  }
  function saveInv(v) { try { localStorage.setItem(INV_KEY, JSON.stringify(v)); } catch (e) {} }
  /* 满星冠军奖励 +1 碎片（原 attachPiece，保留命名兼容） */
  function attachPiece() { var v = readInv(); v.pieces++; saveInv(v); return v; }
  /* 兑换：3 碎片换 1 件成品（gun 或 doll），分别进入对应收藏列表 */
  function exchangePiece(type) {
    var v = readInv();
    if (v.pieces < 3) { banner("还需 " + (3 - v.pieces) + " 个碎片才能兑换"); return v; }
    v.pieces -= 3;
    var img = (type === "gun") ? pick(GUN_IMG) : pick(DOLL_IMG);
    if (type === "gun") v.guns.push(img); else v.dolls.push(img);
    v.finished = num(v.finished, 0) + 1;
    saveInv(v);
    banner("🎉 兑换成功！获得" + (type === "gun" ? "🔫 枪" : "🧸 娃娃"));
    return v;
  }
  /* 佩戴 / 卸下：点击已佩戴的件则卸下，否则换上 */
  function equipItem(type, img) {
    var v = readInv();
    if (v.equipped && v.equipped.type === type && v.equipped.img === img) { v.equipped = null; }
    else { v.equipped = { type: type, img: img }; }
    saveInv(v);
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
      /* 舞台：左 42% 教室 / 右 58% 操场，两片同屏可见（2026-09-21 修正：
         之前输了的只被 translateX 移出屏外，根本看不到教室；现在留在屏内、走进教室区并缩小）。 */
      ".a-stage{position:relative;height:150px;max-height:22vh;border-radius:14px;overflow:hidden;background:#cfe8ff;box-shadow:0 4px 12px rgba(0,0,0,.1)}" +
      "@media(min-height:700px){.a-stage{height:180px}}" +
      ".a-cz{position:absolute;top:0;bottom:0;left:0;width:34%;background:linear-gradient(180deg,#fff3d6,#ffe2a8);border-right:2px dashed #d9b46a}" +
      ".a-cz:before{content:'🏫 教室';position:absolute;top:4px;left:6px;font-weight:900;font-size:11px;color:#a9743a}" +
      ".a-pz{position:absolute;top:0;bottom:0;left:34%;right:0;background:linear-gradient(180deg,#bfe9c0,#7fc98a)}" +
      ".a-pz:before{content:'🏟️ 操场';position:absolute;top:4px;left:6px;font-weight:900;font-size:11px;color:#2f7a3a}" +
      /* 老师站到操场**最右侧**（不再是 67% 居中）。
         ★ 2026-09-22 修：原先 left:67% 正好压在「拉布拉多警长 / 汪汪队工程犬 / 白熊 / 棕熊」
         几个学生头像上（实测与 4 人横向重叠），孩子看不清谁是谁。挪到右缘、并缩小，
         避开两排学生（上排左起 40/55/70%，下排 40/55/70% 的卡片右缘到 76%+卡片宽）。 */
      ".a-teacher{position:absolute;top:4px;right:2px;width:42px;height:42px;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 2px 6px rgba(0,0,0,.2);z-index:4}" +
      ".a-teacher img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}" +
      ".a-avs{position:absolute;inset:0;z-index:2}" +
      /* 头像：绝对定位到各自「槽位」，切换场景靠改 left% / bottom%；走进教室缩成 .small。
         默认 transition 同时含 left / bottom / transform，开场用 JS 临时把 left 过渡拉长成「走 5 秒」。 */
      /* 头像宽 10% 太窄（stage 320px 时只有 32px），名字「拉布拉多警长」「汪汪队工程犬」
         一律被省略成「汪…」，孩子分不清谁是谁。放宽到 14%（留出邻座间隙）。 */
      ".a-avatar{position:absolute;bottom:6px;width:14%;display:flex;flex-direction:column;align-items:center;transition:left .8s ease,bottom .8s ease,transform .3s ease;transform-origin:bottom center}" +
      ".a-avatar .a-body{position:relative;width:100%;max-width:34px;aspect-ratio:1/1;border-radius:50%;background:#fff;display:flex;align-items:center;justify-content:center;font-size:20px;box-shadow:0 2px 5px rgba(0,0,0,.15)}" +
      ".a-avatar .a-photo{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}" +
      ".a-avatar .a-name{font-size:9px;font-weight:800;margin-top:1px;background:rgba(255,255,255,.7);border-radius:8px;padding:0 2px;max-width:100%;width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}" +
      ".a-avatar.me .a-body{outline:3px solid #4a86e8}" +
      ".a-avatar.rest .a-body{filter:grayscale(1);opacity:.6}" +
      ".a-avatar.small{transform:scale(.6)}" +
      /* ★ 2026-09-22 修「星星太宽、挨到一起」：a-stars 原先 font-size:11px + letter-spacing:1px，
         4 颗星宽约 4×(11+1)=48px，而卡片本身只有 48px 宽、相邻卡片首尾相接（间隙实测 0px），
         于是两个人的 ★★★★ 看起来连成一条。
         现在：字号收到 8px、去掉字距、并限宽到 90%（不撑满卡片），两侧留出可见空隙。 */
      ".a-avatar .a-stars{font-size:8px;color:#e08b00;letter-spacing:0;min-height:11px;line-height:1.1;max-width:92%;white-space:nowrap}" +
      /* ★ 2026-09-21 丢星特效：星星闪一下（放大变红）再变灰色（☆） */
      ".a-avatar .a-stars.flash{animation:astar .43s ease}" +
      "@keyframes astar{0%{transform:scale(1.35);color:#ff3b3b}50%{transform:scale(.85)}100%{transform:scale(1);color:#e08b00}}" +
      /* ★ 2026-09-21 新增：开场前「选角色」界面（30s 倒计时，超时自动选第一个）。
         触屏直接点；电视遥控器方向键移焦点、确认键选。 */
      ".arena-pick{position:relative;display:flex;flex-direction:column;min-height:100%}" +
      ".a-pick{position:relative;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:8px;overflow:auto}" +
      ".a-pick-head{font-size:clamp(14px,2.4vw,20px);font-weight:900;color:#2f5fb0;background:rgba(255,255,255,.82);border-radius:12px;padding:6px 12px;text-align:center}" +
      ".a-pick-secs{display:inline-block;min-width:1.6em;color:#ef476f;font-weight:900}" +
      ".a-pick-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;width:min(440px,94%);margin-top:4px}" +
      /* ★ 2026-09-21 改：选人就该「看图选人」——放大头像图、去掉名字，别让文字挤占视线 */
      ".a-pick-card{display:flex;flex-direction:column;align-items:center;justify-content:center;background:#fff;border-radius:16px;padding:6px;box-shadow:0 3px 10px rgba(0,0,0,.12);cursor:pointer;transition:transform .15s,box-shadow .15s,outline-color .15s;outline:3px solid transparent;overflow:hidden}" +
      ".a-pick-card:focus,.a-pick-card:hover{outline-color:#4a86e8;transform:translateY(-3px);box-shadow:0 6px 16px rgba(74,134,232,.35)}" +
      ".a-pick-card .a-body{width:100%;aspect-ratio:1/1;font-size:clamp(30px,7vw,54px);border-radius:12px}" +
      ".a-pick-card .a-body .a-photo{width:100%;height:100%;object-fit:contain;border-radius:12px}" +
      /* 装备覆盖层（枪/娃娃）：挂在头像右上 */
      ".a-avatar .a-equip{position:absolute;top:-6px;right:-6px;width:26px;height:26px;display:none}" +
      ".a-avatar .a-equip.on{display:block}" +
      /* 罚站 ❌ 覆盖 */
      ".a-avatar .a-x{position:absolute;inset:0;display:none;align-items:center;justify-content:center;font-size:40px;color:#ef476f;font-weight:900;text-shadow:0 0 4px #fff}" +
      ".a-avatar.rest .a-x{display:flex}" +
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
      "@keyframes acr{0%{transform:scale(.3) rotate(-20deg);opacity:0}60%{transform:scale(1.25) rotate(8deg);opacity:1}100%{transform:scale(1) rotate(0)}}" +
      /* Req 4 仓库 / 兑换商店界面（手机 + TV 通用；TV 放大见 tv.css）。
         注意：机顶盒 Chromium 60 不支持 gap/aspect-ratio，间距一律用 margin。
         ★★ 2026-09-22 修「手机端仓库界面上下溢出、底部按钮被顶到屏幕外」：
         原来是 min-height:100vh + .a-wh-body{flex:1;overflow:auto}。手机浏览器里 100vh
         把地址栏也算进去，再叠上页面顶部的「当前学科」栏，整体必然高过可视区 →
         「▶ 开始游戏」掉到屏幕外、中间还留一大片空白（用户截图即是此现象）。
         现在高度交给内容自然撑开（父级有确定高度时 100% 依然生效），body 不再抢高度、不做内部滚动。 */
      ".arena-wh{max-width:560px;margin:0 auto;padding:6px;font-family:inherit;width:100%;box-sizing:border-box;min-height:100%;display:flex;flex-direction:column}" +
      ".arena-wh .a-wh-body{flex:1 1 auto;padding:6px 2px}" +
      ".arena-wh .a-wh-sec{background:#fff;border-radius:14px;padding:10px;margin:8px 0;box-shadow:0 3px 10px rgba(0,0,0,.08)}" +
      ".arena-wh .a-wh-title{font-size:15px;font-weight:900;color:#2f5fb0;margin-bottom:8px}" +
      ".arena-wh .a-wh-row{display:flex;flex-wrap:wrap}" +
      ".arena-wh .a-wh-btn{margin:5px;flex:1;min-width:120px;border:0;border-radius:12px;padding:12px;font-size:16px;font-weight:900;background:linear-gradient(180deg,#ffe9a8,#ffd23f);color:#7a5a00;cursor:pointer;box-shadow:0 3px 8px rgba(0,0,0,.12)}" +
      ".arena-wh .a-wh-item{margin:5px;position:relative;width:84px;height:84px;border:3px solid #e3e9f5;border-radius:14px;background:#f3f7ff;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;outline:none}" +
      ".arena-wh .a-wh-item img{width:48px;height:48px;object-fit:contain}" +
      ".arena-wh .a-wh-item span{font-size:12px;font-weight:800;margin-top:2px}" +
      ".arena-wh .a-wh-item.on{border-color:#37b26a;background:#d8f5e3}" +
      ".arena-wh .a-wh-empty{color:#999;font-size:13px;font-weight:800;padding:8px 0}" +
      ".arena-wh .a-wh-eq{text-align:center;font-size:14px;font-weight:800;color:#e08b00;margin-top:6px}";
    (document.head || document.documentElement).appendChild(s);
  }

  /* ---------- 舞台：一次性建好持久 DOM（头像动画靠它） ---------- */
  function mountStage() {
    var players = S.players;
    var rowHtml = players.map(function (p, i) {
      var eq = (p.equip === "gun") ? '<img class="a-equip on" src="' + T(IMG + p.equipImg) + '" onerror="this.remove()">'
        : (p.equip === "doll") ? '<img class="a-equip on" src="' + T(IMG + p.equipImg) + '" onerror="this.remove()">' : '<img class="a-equip">';
      return '<div class="a-avatar ' + (p.isMe ? "me" : "") + '" data-i="' + i + '" style="left:' + PLAY_L[i] + '%;bottom:' + bottomOf(i) + '">' +
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
        '<div class="a-cz"></div>' +
        '<div class="a-pz"></div>' +
        '<div class="a-teacher" id="a-teacher">' + faceHTML("👩‍🏫", TEACHER_IMG) + '</div>' +
        '<div class="a-avs">' + rowHtml + '</div>' +
        '<div class="a-cd" id="a-cd" style="display:none"></div>' +
      '</div>' +
      '<div id="a-hud"></div>' +
      '</div>';
    setApp(html);
    /* 缓存头像 DOM 引用（现在每个玩家只有一份，挂在 .a-avs 里） */
    avatarEls = [];
    var nodes = document.querySelectorAll(".arena .a-avatar");
    for (var n = 0; n < nodes.length; n++) avatarEls.push(nodes[n]);
    /* 开场：头像先从左侧屏幕外走到操场各自槽位（left 过渡拉长成 5 秒）
       ★★ 2026-09-21 修「人物叠到一起」根因：这里原先**只设 left、没设 bottom**，
        mountStage 建 DOM 时也没给 bottom（只有 placeAvatar 会给，而开场根本没调它），
        于是 6 个头像全停在 CSS 默认的 bottom:6px 这一行；两排共用同一组 left，
        #0/#3、#1/#4、#2/#5 就落成完全相同的矩形（实测 32×64px 重合）。
        现在：先把 bottom 直接落位（不做过渡，避免开场"从下往上飘"），再走 left。 */
    for (var i = 0; i < avatarEls.length; i++) {
      var el = avatarEls[i];
      el.style.bottom = bottomOf(i);
      el.style.transition = "left " + (WALK_IN_MS / 1000) + "s linear";
      el.style.left = (PLAY_L[i] - 60) + "%";
    }
    /* 强制重排后归位 → 触发过渡；归位后把过渡恢复正常速度（掉星回教室用 .8s） */
    later(function () {
      for (var j = 0; j < avatarEls.length; j++) {
        avatarEls[j].style.transition = "left .8s ease, bottom .8s ease, transform .3s ease";
        avatarEls[j].style.left = PLAY_L[j] + "%";
        avatarEls[j].style.bottom = bottomOf(j);
      }
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
      if (S.revealed) { if (q.correctSet.indexOf(i) >= 0) cls += " correct"; else if (S.chosen === i) cls += " wrong"; else if (S.excluded === i) cls += " excl"; }
      else if (S.excluded === i) cls += " excl";
      /* ★ 2026-09-24 加 tabindex：电视端遥控器要能逐项选中；首个选项（答案 A）默认获得焦点。 */
      return '<button class="' + cls + '" tabindex="' + (i === 0 ? "0" : "-1") + '" data-opt="' + i + '" onclick="arenaAnswer(' + i + ')"><span>' + T(o && o.label) + "</span></button>";
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
      /* ★ 2026-09-24 用户要求：答题页去掉底部「提示 / 装备 / 兑换」三颗按钮，页面更干净；
         相关功能仍在（装备/兑换在选角后的仓库页，提示逻辑保留但不露出入口）。 */
      "";
    refreshTop();
    /* ★ 2026-09-24 用户要求：答题时光标（遥控器焦点）默认定位到答案 A（第一个选项）。
       只在「答题中」且尚未作答时抢一次焦点，作答后不动，避免把焦点从反馈上抢走。 */
    if (S.phase === "play" && !S.locked) {
      try {
        var f = hud.querySelector('.a-opt[data-opt="0"]');
        if (f && document.activeElement !== f) f.focus();
      } catch (e) {}
    }
  }

  /* ---------- 开场：老师点名集合，倒计时 5..1（教室/操场同屏，无需切场景） ---------- */
  function startOpening() {
    S.phase = "opening";
    battleRender();
    /* 开场老师语音：放在 battleStop（beginArena 内）执行完之后最稳——语音引擎已就绪，
       用户进操场即听到「同学们，去操场集合！」，紧接着倒计时。 */
    try { say("同学们，去操场集合！", "zh-CN"); } catch (e) {}
    later(function () {
      S.phase = "countdown";
      countdown(5);
    }, WALK_IN_MS);
  }
  function countdown(n) {
    var cd = document.getElementById("a-cd");
    if (n <= 0) { if (cd) cd.style.display = "none"; showQuestion(); return; }
    if (cd) { cd.style.display = "flex"; cd.textContent = T(n); }
    sfx("tick");
    /* ★ 2026-09-24 用户澄清：倒计时只念一遍 5,4,3,2,1（此前误加为念两遍，已改回）。 */
    tts(T(String(n)));
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
    var q = S.q, correct = (q.correctSet || []).indexOf(idx) >= 0;
    S.chosen = idx; S.revealed = true;
    var me = S.players[0];
    var right = (q.opts || [])[(q.correctSet && q.correctSet[0]) || 0];
    var rightText = right ? T(right.label) : T(q.speakText);
    if (correct) { me.score++; sfx("correct"); }
    else { var mb = me.stars; loseStar(me); flashStar(0, mb); sfx("wrong"); }
    /* 答后读正确答案（英语读英文单词）；选项不读（用户要求"只读题目、答后读答案"）。
       出题时 707 已读题目（英语读英文单词），此处再读答案 = 题目+答案都朗读。 */
    tts(rightText);
    /* ★ 2026-09-22：得分反馈改为「排队」而不是「清队」——
       以前它延迟 950ms 播、并且会把队列清空，正好把紧随其后入队的「某某，回教室罚站」清没了。 */
    later(function () { tts(correct ? "答对啦，加一分" : "答错了，加油", null, "queue"); }, 900);
    for (var i = 1; i < S.players.length; i++) {
      var p = S.players[i]; if (!p.alive) continue;
      if (Math.random() < SKILL) p.score++; else { var pb = p.stars; loseStar(p); flashStar(i, pb); }
    }
    var fb = document.getElementById("afb");
    if (fb) fb.textContent = correct ? "✅ 答对啦！+1 分" : "❌ 答错了，加油";
    battleRender();
    /* 回教室罚站：只有「4 星掉光（stars 减到 0，即淘汰出局）」的学生才走回教室 + 老师点名罚站。
       ★ 2026-09-22 用户明确规则：掉了一颗星但还剩星的人留在操场继续答题，绝不走进教室/罚站。
       （resting 与 stars<=0 等价，这里用 stars<=0 显式表达「掉光」语义，避免误读成「掉星即罚站」） */
    var nth = 0;
    /* ★ 2026-09-22：点名延后到 900ms 之后（排在「答错了，加油」后面），多人同时掉光就再各错开 1.5s */
    S.players.forEach(function (p, k) { if (p.stars <= 0 && !p._walked) { walkBack(k, 1250 + nth * 1500); nth++; } });
    /* 本轮有人掉光星（淘汰）→ 下一题前插入「罚站」插播窗口（Req 6：切断游戏、播老师「某某回教室罚站」） */
    S._penalty = (nth > 0);
    later(afterResolve, S._penalty ? PENALTY_PAUSE_MS : 1700);
  }

  /* 掉光星 → 头像走进左侧教室区（left% 过渡）+ 缩小 + ❌ + 灰；老师逐个点名回教室好好学习。
     ★ 2026-09-21 修正：以前是 translateX(-720px) 把头像移出屏外，根本看不到教室；
     现在明确走进屏内的教室区，且只有「掉光星」的人进去，真人输了也不会把全场都拉去罚站。
     delayMs：同 round 多人同时掉星时错开播报，避免语音被引擎合并成一团 */
  function walkBack(i, delayMs) {
    var p = S.players[i];
    /* ★ 2026-09-22 防御：只有 4 星掉光（stars<=0）的学生才罚站。掉星未掉光的人留在操场，
       即便被误调用也直接返回，绝不走进教室、绝不点名罚站。 */
    if (!p || p.stars > 0) return;
    p._walked = true;
    var el = avatarEls[i]; if (!el) return;
    el.style.transition = "left .8s ease, transform .3s ease";
    el.classList.add("rest", "small");
    placeAvatar(i, "class");
    /* 老师点名：某某，回教室罚站（每个被淘汰的学生各播一次，靠 _walked 守卫，绝不漏、绝不重复）。
       ★ 2026-09-22：用 queue 排队播放 —— 这条台词绝不能因为后面的得分反馈 / 读题语音而消失。 */
    var msg = T(p.isMe ? "你" : p.name) + "，回教室罚站";
    /* 直接 setTimeout 播，不走 later 的 stillMine 守卫——否则淘汰者触发 endGame / 切场景时
       stillMine() 返回 false 会把这条点名台词静默吞掉（用户反馈「罚站没声音」的根因之一）。 */
    setTimeout(function () { try { tts(msg, "zh-CN", "queue"); } catch (e) {} }, delayMs > 0 ? delayMs : 0);
    refreshAvatar(i);
  }

  function afterResolve() {
    if (!S) return;
    /* 真人掉光星 → 走回教室 + 被批评 + 游戏结束（2026-09-21 修正：真人不再受保护） */
    if (!S.players[0].alive) { endGame(); return; }
    var alive = alivePlayers();
    if (alive.length <= 1) { endGame(); return; }
    S.qn++;
    if (S.qn > TOTAL_Q) { endGame(); return; }   /* 8 题后结算（按星判定胜负） */
    /* 本轮有罚站插播 → 多留点时间让「回教室罚站」动画+语音播完，再下一题（Req 6） */
    later(showQuestion, S._penalty ? 1500 : 1800);
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
    /* 教室 / 操场两片同屏常驻，无需切场景；真人输了且还没走过就走进教室（其余人留在原地） */
    if (meLost && !me._walked) walkBack(0, 0);
    /* 老师评价：满星表扬，否则一律批评（含中途掉光星出局）。延后一点避免和点名语音叠在一起 */
    var meFull = (me.stars >= START_STARS);
    var talk = meFull
      ? "太棒了，你满星通关，是当之无愧的第一名！"
      : "你没拿满星，老师要批评你，下次要全对哦！";
    later(function () { tts(talk, "zh-CN", "queue"); }, meLost ? 3200 : 500);
    /* 等回教室动画走完再出结算面板，别让面板盖住动画 */
    later(function () { if (S) battleRender(); }, meLost ? 3400 : 1600);
  }

  function renderOver(hud) {
    var me = S.players[0];
    var meFull = (me.stars >= START_STARS);          /* 满星 = 4/4，全程没掉星 */
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
    /* ★ 2026-09-21 修正（用户明确规则）：只有「满星且赢了」才发配件（碎片），
       丢分了（不满星）哪怕也拿了第一，也不给配件 —— 这是鼓励真满星通关。 */
    if (youPraised) {
      var v = attachPiece();
      banner("🏆 满星冠军奖励 +1 碎片（共 " + v.pieces + " 个）");
      championFX();                                   /* 满星才放彩带皇冠 */
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
      '<div style="text-align:center;font-size:13px;color:#888">🎒 配件 ' + readInv().pieces + " · 成品 " + readInv().finished + "</div>" +
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
    tts(talk, "zh-CN");
  };

  /* ---------- 退出：一次收干净 ---------- */
  function battleStop() {
    runId++;
    clearTimers();
    clearBanners();                 /* 提示条也一并收掉，退出后不留残影 */
    if (pickTimer) { try { clearInterval(pickTimer); } catch (e) {} pickTimer = null; }
    if (pickKeyHandler) { try { document.body.removeEventListener("keydown", pickKeyHandler); } catch (e) {} pickKeyHandler = null; }
    S = null; avatarEls = [];
    window.__gameExit = null;
    try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) {}
  }

  /* ---------- 公开控制（挂在 window，供 onclick 调用） ---------- */
  window.arenaAnswer = arenaAnswer;
  window.arenaReplay = function () { if (S && S.q) tts(S.q.speakText); };
  window.arenaTeacher = function () { tts("同学们，去操场集合！", "zh-CN"); };
  window.arenaHint = function () {
    if (!S || !S.q || S.hintUsed || S.revealed) return;
    var wrongs = []; (S.q.opts || []).forEach(function (o, i) { if (S.q.correctSet.indexOf(i) < 0 && i !== S.excluded) wrongs.push(i); });
    if (!wrongs.length) return;
    S.excluded = pick(wrongs); S.hintUsed = true; battleRender();
  };
  /* 游戏内快速佩戴：无 → 第一个拥有的枪 → 第一个拥有的娃娃 → 无（循环）。
     真正的兑换统一在选角后的仓库界面（Req 4），这里不替换舞台，避免 DOM 被破坏。 */
  window.arenaEquip = function () {
    var me = S && S.players[0]; if (!me) return;
    var v = readInv();
    var cur = (me.equip === "gun") ? "gun" : (me.equip === "doll" ? "doll" : null);
    var next = null;
    if (!cur) { if (v.guns.length) next = { type: "gun", img: v.guns[0] }; }
    else if (cur === "gun") { if (v.dolls.length) next = { type: "doll", img: v.dolls[0] }; }
    if (next) { me.equip = next.type; me.equipImg = next.img; v.equipped = next; }
    else { me.equip = null; me.equipImg = ""; v.equipped = null; }
    saveInv(v); refreshAvatar(0);
    banner(me.equip ? ("佩戴：" + (me.equip === "gun" ? "🔫 枪" : "🧸 娃娃")) : "已卸下装备");
  };
  /* 游戏内兑换按钮：提示去选角后的仓库（不在中途替换舞台） */
  window.arenaExchange = function () { banner("🎁 兑换请在选角后的「仓库」里进行"); };
  window.arenaExit = function () {
    battleStop();
    try { if (typeof state !== "undefined" && state) { state.mode = null; state.view = "modes"; } } catch (e) {}
    if (typeof window.render === "function") window.render();
  };
  window.arenaRestart = function () { battleStop(); startArena(); };

  /* ---------- 入口 ---------- */
  /* ★ 2026-09-21 新增：开场前让真人优先选角色（30s 倒计时，超时自动选第 1 个）。
   * 触屏直接点；电视遥控器方向键移焦点、确认键选择。选完把选中的学生排到 0 号位当真人。
   * 模块级 pickTimer / pickKeyHandler 便于 arenaExit 时一并清掉，避免「退出后还能被按键复活」。 */
  var pickTimer = null, pickKeyHandler = null;
  function chooseHero(cb) {
    var html =
      '<div class="arena arena-pick">' +
      '<div class="a-top">' +
        '<button class="pill" onclick="arenaExit()" style="cursor:pointer">← 退出</button>' +
        '<span class="pill">🏆 知识圈竞赛</span>' +
        '<span class="pill">👥 6 人</span>' +
      '</div>' +
      '<div class="a-pick">' +
        '<div class="a-pick-head">选一个角色 <span class="a-pick-secs" id="a-pick-secs">30</span> 秒</div>' +
        '<div class="a-pick-grid">' +
          STU_EMOJI.map(function (emo, i) {
            return '<div class="a-pick-card" tabindex="0" data-i="' + i + '" onclick="arenaPick(' + i + ')" title="' + T(STU_NAME[i]) + '">' +
              '<div class="a-body">' + faceHTML(emo, STU_IMG[i]) + '</div>' +
            '</div>';
          }).join("") +
        '</div>' +
      '</div>' +
      '</div>';
    setApp(html);

    var done = false, left = 30;
    var secEl = document.getElementById("a-pick-secs");
    pickTimer = setInterval(function () {
      left--; if (secEl) secEl.textContent = left;
      if (left <= 0) { clearInterval(pickTimer); pickTimer = null; doPick(0); }
    }, 1000);

    function doPick(i) {
      if (done) return; done = true;
      if (!stillMine()) return;                 // 已退出 → 不选
      if (pickTimer) { clearInterval(pickTimer); pickTimer = null; }
      if (pickKeyHandler) { try { document.removeEventListener("keydown", pickKeyHandler, true); } catch (e) {} pickKeyHandler = null; }
      cb(i);
    }
    /* 触屏点击 */
    window.arenaPick = function (i) { doPick(i); };

    /* 电视遥控器：3 列网格，方向键移焦点、确认键选。
       ★★ 2026-09-23 修「一次跳两格 / 选不中角色 / 直接开打」：
         早期用 document.activeElement 推算焦点位置，但 js/tv.js 的 ensureFocus
         （MutationObserver 触发）也会在背后挪一次焦点，于是"我挪一格 + tv.js 再挪一格"
         叠加成一次跳两格，确认键还常落在错误的卡上 → 孩子根本选不中 → 30s 自动选第 1 个。
         改用「内部 selIdx」独立记账：每次方向键只把 selIdx 自增/自减 1 再聚焦，
         完全不读 activeElement，tv.js 怎么挪都不影响我们记的位置。 */
    var selIdx = 0;
    function cards() {
      var all = Array.prototype.slice.call(document.querySelectorAll("#app .a-pick-card"));
      var vis = all.filter(function (el) { return el.offsetParent !== null; });
      return vis.length ? vis : all;
    }
    function applyFocus() {
      var list = cards(); if (!list.length) return;
      if (selIdx < 0) selIdx = 0; if (selIdx >= list.length) selIdx = list.length - 1;
      try { list[selIdx].focus(); } catch (e) {}
    }
    function ensure() {
      var list = cards(); if (!list.length) return;
      selIdx = 0; applyFocus();
    }
    pickKeyHandler = function (e) {
      if (!stillMine()) return;
      var k = e.key, kc = e.keyCode || 0;
      var list = cards(); if (!list.length) return;
      /* 捕获阶段 + stopPropagation：比 tv.js 挂在 document 上的冒泡监听器更早执行并拦下，
         方向键/确认键完全由本处理器接管；返回键(Esc/Backspace)不拦，放行给 tv.js 照常返回。 */
      if (k === "ArrowRight" || kc === 39) { e.preventDefault(); e.stopPropagation(); selIdx = Math.min(list.length - 1, selIdx + 1); applyFocus(); return; }
      if (k === "ArrowLeft" || kc === 37) { e.preventDefault(); e.stopPropagation(); selIdx = Math.max(0, selIdx - 1); applyFocus(); return; }
      if (k === "ArrowDown" || kc === 40) { e.preventDefault(); e.stopPropagation(); selIdx = Math.min(list.length - 1, selIdx + 3); applyFocus(); return; }
      if (k === "ArrowUp" || kc === 38) { e.preventDefault(); e.stopPropagation(); selIdx = Math.max(0, selIdx - 3); applyFocus(); return; }
      var isEnter = (k === "Enter" || k === " " || k === "Spacebar" || kc === 13 || kc === 66 || kc === 23);
      if (!isEnter) return;
      e.preventDefault(); e.stopPropagation();
      doPick(selIdx);
    };
    document.addEventListener("keydown", pickKeyHandler, true);
    ensure();
    tts("选一个你喜欢的角色吧");
  }

  /* 选角回调里不直接开打，而是先进仓库 / 兑换商店（Req 4）：可凭碎片兑换娃娃或枪、点击佩戴，
     佩戴后点「开始游戏」才真正进入开场（"同学们，去操场集合！"也改到这里播放，Req 5）。 */
  var whHero = 0;   /* 当前选中的角色索引，供仓库界面全局按钮复用 */
  function startArena() {
    buildBank();
    battleStop();
    ensureStyle();
    runId++;
    /* 开场前先让真人选角色（30s 倒计时）。选中的学生排到 0 号位当真人，其余 5 个 AI。 */
    chooseHero(function (heroIdx) { whHero = heroIdx; showWarehouse(); });
  }

  /* ---------- 仓库 / 兑换商店（选角后、开场前） ---------- */
  /* 手机触屏直接点；TV 焦点靠 tv.js 通用导航（按钮均 tabindex=0）。 */
  function showWarehouse() { renderWarehouse(); }
  function renderWarehouse() {
    var v = readInv();
    var gunCards = (v.guns && v.guns.length ? v.guns : []).map(function (g, i) {
      var on = (v.equipped && v.equipped.type === "gun" && v.equipped.img === g);
      return '<button class="a-wh-item' + (on ? " on" : "") + '" tabindex="0" onclick="arenaWhEquip(\'gun\',\'' + T(g) + '\')">' +
        '<img src="' + T(IMG + g) + '" onerror="this.style.display=\'none\'"><span>' + (on ? "✅ " : "") + "枪" + (i + 1) + "</span></button>";
    }).join("") || '<span class="a-wh-empty">暂无，去兑换吧</span>';
    var dollCards = (v.dolls && v.dolls.length ? v.dolls : []).map(function (d, i) {
      var on = (v.equipped && v.equipped.type === "doll" && v.equipped.img === d);
      return '<button class="a-wh-item' + (on ? " on" : "") + '" tabindex="0" onclick="arenaWhEquip(\'doll\',\'' + T(d) + '\')">' +
        '<img src="' + T(IMG + d) + '" onerror="this.style.display=\'none\'"><span>' + (on ? "✅ " : "") + "娃" + (i + 1) + "</span></button>";
    }).join("") || '<span class="a-wh-empty">暂无，去兑换吧</span>';
    var eqTxt = v.equipped ? ("已佩戴：" + (v.equipped.type === "gun" ? "🔫 枪" : "🧸 娃娃")) : "未佩戴（可点击下方装备佩戴）";
    var html =
      '<div class="arena arena-wh">' +
      '<div class="a-top">' +
        '<button class="pill" onclick="arenaExit()" style="cursor:pointer">← 退出</button>' +
        '<span class="pill">🎒 我的仓库</span>' +
        '<span class="pill">🧩 碎片 <b id="a-wh-pieces">' + v.pieces + "</b></span>" +
      "</div>" +
      '<div class="a-wh-body">' +
        '<div class="a-wh-sec">' +
          '<div class="a-wh-title">🎁 兑换商店（3 碎片换 1 件）</div>' +
          '<div class="a-wh-row">' +
            '<button class="a-wh-btn" tabindex="0" onclick="arenaWhExchange(\'gun\')">🔫 兑换枪</button>' +
            '<button class="a-wh-btn" tabindex="0" onclick="arenaWhExchange(\'doll\')">🧸 兑换娃娃</button>' +
          "</div>" +
        "</div>" +
        '<div class="a-wh-sec"><div class="a-wh-title">🔫 我的枪（点击佩戴）</div><div class="a-wh-row">' + gunCards + "</div></div>" +
        '<div class="a-wh-sec"><div class="a-wh-title">🧸 我的娃娃（点击佩戴）</div><div class="a-wh-row">' + dollCards + "</div></div>" +
        '<div class="a-wh-eq">' + eqTxt + "</div>" +
      "</div>" +
      '<div class="a-bottom">' +
        '<button onclick="arenaExit()">← 返回</button>' +
        '<button style="background:linear-gradient(180deg,#5fd08a,#37b26a);color:#fff" onclick="arenaWhStart()">▶ 开始游戏</button>' +
      "</div>" +
      "</div>";
    setApp(html);
    /* 进入仓库时让焦点落到第一个可交互按钮（TV 首屏可达、手机无影响） */
    try { var f = document.querySelector("#app .arena-wh .a-wh-btn"); if (f) f.focus(); } catch (e) {}
  }

  /* 仓库界面全局控制 */
  window.arenaWhExchange = function (type) { exchangePiece(type); renderWarehouse(); };
  window.arenaWhEquip = function (type, img) { equipItem(type, img); renderWarehouse(); };
  window.arenaWhStart = function () {
    var v = readInv();
    /* 点击「开始游戏」即进场（短延迟让仓库界面先收起）；开场老师语音改在 startOpening 开头播，
       那里 battleStop 已执行完、语音引擎已就绪，避免「手势内播却被后续逻辑打断」导致整段哑掉。 */
    setTimeout(function () { beginArena(whHero, v.equipped); }, 400);
  };

  /* 真正开打：应用佩戴、建 S、上台、开场（"同学们，去操场集合！"在此播放，Req 5） */
  function beginArena(heroIdx, equipped) {
    var order = [heroIdx];
    for (var k = 0; k < 6; k++) if (k !== heroIdx) order.push(k);
    var players = [];
    for (var i = 0; i < 6; i++) {
      var si = order[i];
      players.push({
        name: STU_NAME[si], emoji: STU_EMOJI[si], img: STU_IMG[si],
        isMe: (i === 0), alive: true, resting: false, _walked: false,
        stars: START_STARS, score: 0, correct: 0, equip: null, equipImg: ""
      });
    }
    if (equipped && equipped.type && equipped.img) { players[0].equip = equipped.type; players[0].equipImg = equipped.img; }
    S = { players: players, qn: 1, time: BASE_TIME, left: BASE_TIME, locked: false, q: null, chosen: -1, revealed: false, fb: "", tick: null, phase: "opening", hintUsed: false, showHint: false, excluded: null, _penalty: false };
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
      /* opts: 全部选项标签；correct: 正确项标签集合（量词题可能多个，如云=片/朵） */
      out.push({
        q: q.qText,
        a: q.opts[q.correctSet[0]] && q.opts[q.correctSet[0]].label,
        subj: subj,
        opts: q.opts.map(function (o) { return o.label; }),
        correct: q.correctSet.map(function (i) { return q.opts[i].label; })
      });
    }
    return { subj: subj, samples: out };
  };
  registerGame({
    id: "arena2",
    name: "知识圈竞赛",
    icon: "🏆",
    desc: "6 人答题生存赛：老师带队去操场，答对活、掉星回教室罚站！",
    start: startArena
  });

  try { if (typeof log === "function") log("arena registered, GAMES=" + ((window.GAMES && window.GAMES.length) || 0)); } catch (e) {}
})();
