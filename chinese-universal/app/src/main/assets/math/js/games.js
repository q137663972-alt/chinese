/* ===================== 数学乐园 · 玩法 =====================
   出题统一走 gen.js 的 genQ(cfg) / genV(cfg)，题目自带 4 个选项 */
function bindReplay(text){ window.replayCurrent = function(){ speak(text); }; }

function headPill(left){
  return '<div class="game-head"><div class="progress-pill">' + left + '</div>' +
    '<button class="replay" onclick="replayCurrent()">🔊</button></div>';
}

/* 通用单题渲染：{ q, a, opts, say, v }  showVert=true 时渲染竖式 */
function renderQ(q, headLabel, optCls, onAnswer, showVert){
  var cls = optCls || "opt-num";
  gameShell(
    headPill(headLabel) +
    '<div id="qSlot">' +
      (q.img ? q.img : '') +
      (showVert && q.v ? vertHTML(q.v) : '<div class="big-word math-q">' + esc(q.q) + '</div>') +
    '</div>' +
    '<div class="options">' + q.opts.map(function(o, i){
      return '<div class="opt ' + cls + '" onclick="answerM(' + i + ')">' + esc(o) + '</div>';
    }).join("") + '</div>' +
    '<div class="feedback" id="fb"></div>', "答题");
  window.answerM = onAnswer;
  bindReplay(q.say || q.q);
}

/* 竖式渲染 */
function vertHTML(v){
  if(v.op === "÷"){
    var blank = v.miss === "r" ? '<span class="v-blank">？</span>' : String(v.r);
    return '<div class="big-word math-q">' + v.a + ' ÷ ' + v.b + ' = ' + blank + '</div>' +
      '<div class="prompt">用乘法口诀求商</div>';
  }
  function pad(n, w){ n = String(n); while(n.length < w) n = "&nbsp;" + n; return n; }
  var w = Math.max(String(v.a).length, String(v.b).length + 1, String(v.r).length + 1);
  var opCell = v.miss === "op" ? '<span class="v-blank">？</span>' : v.op;
  var aCell = pad(v.a, w + 1);
  var bCell = v.miss === "b" ? opCell + pad("？", w).replace("？", '<span class="v-blank">？</span>') : opCell + pad(v.b, w);
  var rCell = v.miss === "r" ? pad("？", w + 1).replace("？", '<span class="v-blank">？</span>') : pad(v.r, w + 1);
  return '<div class="vert-wrap"><div class="vert mono">' +
    '<div class="v-row">' + aCell + '</div>' +
    '<div class="v-row">' + bCell + '</div>' +
    '<div class="v-line"></div>' +
    '<div class="v-row v-res">' + rCell + '</div>' +
  '</div></div>' +
  '<div class="prompt">想一想，竖式空白处应该填什么？</div>';
}

/* ===================== 1. 口算练习（8 题闯关） ===================== */
function startPractice(){
  var u = curUnit();
  var TOTAL = 8, cur = 0, correct = 0, locked = false;
  function nextRound(){
    locked = false;
    var q = genQ(u.gen);
    renderQ(q, (cur + 1) + "/" + TOTAL, "opt-num", function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb");
      if(String(q.opts[i]) === String(q.a)){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 答对啦！"; fb.className = "feedback ok"; speak(q.say);
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ 正确答案：" + q.a; fb.className = "feedback no";
        $all(".opt").forEach(function(o, j){ if(String(q.opts[j]) === String(q.a)) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < TOTAL) nextRound(); else finishGame(correct, TOTAL, "口算练习");
      }, 1000);
    });
  }
  nextRound();
}

/* ===================== 2. 限时口算 ===================== */
function startOral(){
  var u = curUnit();
  var TIME = 60, left = TIME, score = 0, streak = 0, locked = false, q = null;
  var best = parseInt(localStorage.getItem("math_best_oral") || "0", 10) || 0;
  function mk(){
    q = genQ(u.gen);
    var pct = Math.max(0, left / TIME * 100);
    gameShell(
      '<div class="game-head"><div class="progress-pill">⏱️ ' + left + 's</div><div class="progress-pill">💯 ' + score + '</div></div>' +
      '<div class="timer-wrap"><div class="timer-bar ' + (pct < 25 ? "low" : "") + '" style="width:' + pct + '%"></div></div>' +
      '<div class="combo" id="combo">' + (streak >= 3 ? "🔥 连击 x" + streak : "") + '</div>' +
      '<div id="qSlot"><div class="big-word math-q">' + esc(q.q) + '</div></div>' +
      '<div class="options">' + q.opts.map(function(o, i){
        return '<div class="opt opt-num" onclick="answerM(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "限时口算");
    bindReplay(q.say || q.q);
  }
  function tick(){
    left--;
    if(left <= 0){ end(); return; }
    var bar = $(".timer-bar");
    if(bar){ bar.style.width = Math.max(0, left / TIME * 100) + "%"; if(left / TIME < 0.25) bar.classList.add("low"); }
    var pill = $(".progress-pill");
    if(pill) pill.textContent = "⏱️ " + left + "s";
  }
  window.answerM = function(i){
    if(locked) return; locked = true;
    var el = $all(".opt")[i], fb = $("#fb");
    if(String(q.opts[i]) === String(q.a)){
      el.classList.add("correct"); streak++; score += 10 + (streak >= 3 ? 5 : 0);
      fb.textContent = "✅ +" + (10 + (streak >= 3 ? 5 : 0)); fb.className = "feedback ok";
    } else {
      el.classList.add("wrong"); streak = 0;
      fb.textContent = "❌ " + q.a; fb.className = "feedback no";
      $all(".opt").forEach(function(o, j){ if(String(q.opts[j]) === String(q.a)) o.classList.add("correct"); });
    }
    setTimeout(function(){ locked = false; mk(); }, 550);
  };
  function end(){
    clearInterval(timer);
    var rec = score > best;
    if(rec){ best = score; localStorage.setItem("math_best_oral", String(best)); }
    setStars(state.gi, state.bi, state.ui, score >= 120 ? 3 : score >= 60 ? 2 : score > 0 ? 1 : 0);
    /* 挑战没有满分概念，用「打破纪录」当最高光；praise.js 没加载上时退回原来的样子 */
    var P = window.PRAISE;
    var lv = P ? P.levelOfScore(score, rec) : "";
    var head = P
      ? P.block(lv, rec ? '<div style="margin-top:4px;font-weight:900;color:#e08b00">🎊 新纪录！</div>' : "")
      : '<div style="font-size:46px">' + (score >= 60 ? "🏆" : "⏱️") + '</div>';
    app.innerHTML = topbar("挑战结束", true) +
      '<div class="result-box">' + head +
        '<div class="read-score">' + score + '</div>' +
        '<div style="font-size:16px;color:var(--sub)">限时口算 · 60 秒得分</div>' +
        '<div class="best">🏅 历史最高：' + best + '</div>' +
        '<div class="row">' +
          '<button class="btn ghost" onclick="startOral()">🔁 再来一次</button>' +
          '<button class="btn green" onclick="state.view=\'modes\';render()">🎮 换玩法</button>' +
        '</div>' +
        '<button class="btn pink" style="margin-top:12px" onclick="state.view=\'units\';render()">返回单元列表</button>' +
      '</div>';
    if (P && lv) setTimeout(function(){ P.fx(lv); }, 60);
  }
  if(window.__mathTimer) clearInterval(window.__mathTimer);
  var timer = setInterval(tick, 1000);
  window.__mathTimer = timer;
  mk();
}

/* ===================== 3. 竖式填空 ===================== */
function startVertical(){
  var u = curUnit();
  var TOTAL = 6, cur = 0, correct = 0, locked = false;
  function nextRound(){
    locked = false;
    var q = genV(u.gen);
    renderQ(q, (cur + 1) + "/" + TOTAL, "opt-num", function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb");
      if(String(q.opts[i]) === String(q.a)){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 竖式填对啦！"; fb.className = "feedback ok"; speak(q.say);
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ 正确答案：" + q.a; fb.className = "feedback no";
        $all(".opt").forEach(function(o, j){ if(String(q.opts[j]) === String(q.a)) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < TOTAL) nextRound(); else finishGame(correct, TOTAL, "竖式填空");
      }, 1200);
    }, true);
  }
  nextRound();
}

/* ===================== 4. 口诀接龙 ===================== */
function startKousj(){
  var TOTAL = 8, cur = 0, correct = 0, locked = false;
  function nextRound(){
    locked = false;
    var q = genQ({ t: "mult", max: 9 });
    renderQ(q, (cur + 1) + "/" + TOTAL, "opt-num", function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb");
      if(String(q.opts[i]) === String(q.a)){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ " + q.q.replace(" = ?", "") + "，背得熟！"; fb.className = "feedback ok"; speak(q.say);
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ " + q.q.replace(" = ?", "") + " = " + q.a; fb.className = "feedback no";
        $all(".opt").forEach(function(o, j){ if(String(q.opts[j]) === String(q.a)) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < TOTAL) nextRound(); else finishGame(correct, TOTAL, "口诀接龙");
      }, 1000);
    });
  }
  nextRound();
}

/* ===================== 5. 应用题闯关 ===================== */
function startApp(){
  var pool = (window.APPQ || []).filter(function(x){ return x.g === state.gi + 1; });
  if(!pool.length) pool = window.APPQ || [];
  var list = shuffle(pool).slice(0, Math.min(6, pool.length));
  var cur = 0, correct = 0, locked = false;
  function nextRound(){
    locked = false;
    var it = list[cur];
    var opts = shuffle(numOpts(it.a, 4, Math.max(1, Math.abs(it.a) * 0.2)));
    gameShell(
      '<div class="game-head"><div class="progress-pill">' + (cur + 1) + '/' + list.length + '</div>' +
        '<button class="replay" onclick="replayCurrent()">🔊</button></div>' +
      '<div class="app-box"><div class="app-q">' + esc(it.q) + '</div></div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-num" onclick="answerM(' + i + ')">' + esc(o) +
          (it.u ? '<span class="opt-u">' + esc(it.u) + '</span>' : '') + '</div>';
      }).join("") + '</div>' +
      '<div class="hint-box" id="hint" style="display:none">💡 思路：' + esc(it.hint) + '</div>' +
      '<div class="feedback" id="fb"></div>', "应用题闯关");
    bindReplay(it.q);
    window.answerM = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb"), hint = $("#hint");
      var ok = parseFloat(opts[i]) === parseFloat(it.a);
      if(ok){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 真会分析！"; fb.className = "feedback ok";
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ 正确答案：" + it.a + (it.u || ""); fb.className = "feedback no";
        if(hint) hint.style.display = "block";
        $all(".opt").forEach(function(o, j){ if(parseFloat(opts[j]) === parseFloat(it.a)) o.classList.add("correct"); });
      }
      speak((ok ? "答对了。" : "") + it.q);
      setTimeout(function(){
        cur++;
        if(cur < list.length) nextRound(); else finishGame(correct, list.length, "应用题闯关");
      }, ok ? 1500 : 3200);
    };
  }
  nextRound();
}

/* ===================== 6. 图形分类 ===================== */
function startShape(){
  var shapes = (window.SHAPES || []).filter(function(s){ return (s.g || 1) <= state.gi + 1; });
  if(shapes.length < 3) shapes = window.SHAPES || [];
  var TOTAL = 8, cur = 0, correct = 0, locked = false;
  function mkQ(){
    var kind = Math.random();
    var s = shapes[Math.floor(Math.random() * shapes.length)];
    if(kind < 0.4 && s.edges > 0){
      /* 干扰项必须排除相同边/棱数的图形，否则会出现两个一样且都对的选项 */
      var others = shapes.filter(function(x){ return x.n !== s.n && x.edges > 0 && x.edges !== s.edges; });
      var unit = s.solid ? "棱" : "边";
      var opts = [String(s.edges)];
      shuffle(others).forEach(function(x){ if(opts.length < 4 && opts.indexOf(String(x.edges)) < 0) opts.push(String(x.edges)); });
      while(opts.length < 4){
        var g = parseInt(opts[opts.length - 1], 10) + 1;
        if(opts.indexOf(String(g)) < 0) opts.push(String(g)); else break;
      }
      return { q: s.n + " 有几" + unit + "？", pic: shapePic(s), a: String(s.edges), opts: shuffle(opts),
        say: s.n + "有几" + unit };
    }
    if(kind < 0.7){
      var ans = s.solid ? "立体图形" : "平面图形";
      var pool = ["立体图形", "平面图形"].filter(function(x){ return x !== ans; });
      return { q: s.n + " 属于哪一类？", pic: shapePic(s), a: ans, opts: shuffle([ans].concat(pool)),
        say: s.n + "属于哪一类", small: true };
    }
    /* 「哪一个是立体图形」：选项里带图，v 是比对用的名字，h 是渲染用的 HTML */
    function optHtml(x){
      var sv = (window.SHAPE_SVG || {})[x.n];
      return '<span class="shape-mini">' + (sv || '<span class="shape-emoji">' + x.k + '</span>') + '</span>' +
             '<span>' + esc(x.n) + '</span>';
    }
    var solids = shapes.filter(function(x){ return x.solid; });
    var flats = shapes.filter(function(x){ return !x.solid; });
    var wantSolid = Math.random() < 0.5;
    var rights = wantSolid ? solids : flats;
    var wrongs = shuffle(wantSolid ? flats : solids).slice(0, 3);
    if(!rights.length || !wrongs.length) return mkQ();
    var right = rights[Math.floor(Math.random() * rights.length)];
    var list = shuffle([right].concat(wrongs));
    return { q: "下面哪一个" + (wantSolid ? "是立体图形？" : "是平面图形？"), a: right.n,
      opts: list.map(function(x){ return { v: x.n, h: optHtml(x) }; }), small: true,
      say: "哪一个是" + (wantSolid ? "立体图形" : "平面图形") };
  }
  function nextRound(){
    locked = false;
    var q = mkQ();
    gameShell(
      headPill((cur + 1) + "/" + TOTAL) +
      (q.pic ? q.pic : '') +
      '<div class="big-word math-q">' + esc(q.q) + '</div>' +
      '<div class="options">' + q.opts.map(function(o, i){
        return '<div class="opt ' + (q.small ? "opt-text" : "opt-num") + '" onclick="answerM(' + i + ')">' +
          (typeof o === "string" ? esc(o) : o.h) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "图形分类");
    bindReplay(q.say);
    /* 选项可能是 {v,h}（带图），统一取 v 做比对 */
    function valOf(i){ var o = q.opts[i]; return typeof o === "string" ? o : o.v; }
    window.answerM = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb");
      if(String(valOf(i)) === String(q.a)){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 认得真准！"; fb.className = "feedback ok"; speak(q.say + "，答对了");
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ 正确答案：" + q.a; fb.className = "feedback no";
        $all(".opt").forEach(function(o, j){ if(String(valOf(j)) === String(q.a)) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < TOTAL) nextRound(); else finishGame(correct, TOTAL, "图形分类");
      }, 1100);
    };
  }
  nextRound();
}

/* ===================== 7. 单位换算 ===================== */
function startUnit(){
  var pool = (window.UNITS || []).filter(function(x){ return x.g <= state.gi + 1; });
  if(!pool.length) pool = window.UNITS || [];
  var TOTAL = 8, cur = 0, correct = 0, locked = false;
  function nextRound(){
    locked = false;
    var it = pool[Math.floor(Math.random() * pool.length)];
    var opts = shuffle(numOpts(it.a, 4, Math.max(2, Math.abs(parseFloat(it.a)) * 0.5)));
    gameShell(
      headPill((cur + 1) + "/" + TOTAL) +
      '<div class="big-word math-q">' + esc(it.q) + '</div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-num" onclick="answerM(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "单位换算");
    bindReplay(it.q.replace("?", "等于多少"));
    window.answerM = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb");
      if(parseFloat(opts[i]) === parseFloat(it.a)){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 换算没错！"; fb.className = "feedback ok"; speak(it.q.replace("?", "等于" + it.a));
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ 正确答案：" + it.a; fb.className = "feedback no";
        $all(".opt").forEach(function(o, j){ if(parseFloat(opts[j]) === parseFloat(it.a)) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < TOTAL) nextRound(); else finishGame(correct, TOTAL, "单位换算");
      }, 1100);
    };
  }
  nextRound();
}

/* ===================== 8. 分数比大小 ===================== */
function startFrac(){
  var TOTAL = 8, cur = 0, correct = 0, locked = false;
  function nextRound(){
    locked = false;
    var g = state.gi + 1;
    var q;
    if(g <= 2) q = GEN.frac0({});
    else if(g <= 4) q = (Math.random() < 0.5 ? GEN.frac({}) : GEN.frac0({}));
    else q = (Math.random() < 0.5 ? GEN.fracMix({}) : GEN.fracadd({}));
    renderQ(q, (cur + 1) + "/" + TOTAL, "opt-num", function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i], fb = $("#fb");
      if(String(q.opts[i]) === String(q.a)){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 比得又快又对！"; fb.className = "feedback ok"; speak(q.say);
      } else {
        el.classList.add("wrong");
        fb.textContent = "❌ 应该填 " + q.a; fb.className = "feedback no";
        $all(".opt").forEach(function(o, j){ if(String(q.opts[j]) === String(q.a)) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < TOTAL) nextRound(); else finishGame(correct, TOTAL, "分数比大小");
      }, 1100);
    });
  }
  nextRound();
}

/* ===================== 9. 综合挑战 ===================== */
function startChallenge(){
  var TIME = 60, left = TIME, score = 0, streak = 0, locked = false, q = null, kind = 3;
  var best = parseInt(localStorage.getItem("math_best_challenge") || "0", 10) || 0;
  var u = curUnit();
  function mk(){
    kind = (kind + 1) % 4;
    var g = state.gi + 1;
    if(kind === 0){ q = genQ(u.gen); q.title = "口算"; }
    else if(kind === 1){
      var pool = (window.UNITS || []).filter(function(x){ return x.g <= g; });
      if(!pool.length) pool = window.UNITS || [];
      var it = pool[Math.floor(Math.random() * pool.length)];
      q = { q: it.q, a: it.a, opts: shuffle(numOpts(it.a, 4, Math.max(2, Math.abs(parseFloat(it.a)) * 0.5))),
        say: it.q.replace("?", "等于多少"), title: "单位换算" };
    }
    else if(kind === 2){
      var shapes = (window.SHAPES || []).filter(function(s){ return (s.g || 1) <= g && s.edges > 0; });
      if(!shapes.length) shapes = (window.SHAPES || []).filter(function(s){ return s.edges > 0; });
      s = shapes[Math.floor(Math.random() * shapes.length)];
      q = { q: s.n + " 有几" + (s.solid ? "棱" : "边") + "？", a: String(s.edges), img: shapePic(s, "mini"),
        opts: shuffle(numOpts(s.edges, 4, 2)), say: s.n + "有几" + (s.solid ? "棱" : "边"), title: "图形" };
    }
    else {
      q = g <= 3 ? GEN.frac({}) : GEN.fracMix({});
      q.title = "分数";
    }
    var pct = Math.max(0, left / TIME * 100);
    gameShell(
      '<div class="game-head"><div class="progress-pill">⏱️ ' + left + 's</div><div class="progress-pill">💯 ' + score + '</div></div>' +
      '<div class="timer-wrap"><div class="timer-bar ' + (pct < 25 ? "low" : "") + '" style="width:' + pct + '%"></div></div>' +
      '<div class="combo" id="combo">' + (streak >= 3 ? "🔥 连击 x" + streak : "") + '</div>' +
      '<div class="mini-tag">' + q.title + '</div>' +
      (q.img ? q.img : '') +
      '<div class="big-word math-q">' + esc(q.q) + '</div>' +
      '<div class="options">' + q.opts.map(function(o, i){
        return '<div class="opt opt-num" onclick="answerM(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "综合挑战");
    bindReplay(q.say || q.q);
  }
  function tick(){
    left--;
    if(left <= 0){ end(); return; }
    var bar = $(".timer-bar");
    if(bar){ bar.style.width = Math.max(0, left / TIME * 100) + "%"; if(left / TIME < 0.25) bar.classList.add("low"); }
    var pill = $(".progress-pill");
    if(pill) pill.textContent = "⏱️ " + left + "s";
  }
  window.answerM = function(i){
    if(locked) return; locked = true;
    var el = $all(".opt")[i], fb = $("#fb");
    if(String(q.opts[i]) === String(q.a)){
      el.classList.add("correct"); streak++; score += 10 + (streak >= 3 ? 5 : 0);
      fb.textContent = "✅ +" + (10 + (streak >= 3 ? 5 : 0)); fb.className = "feedback ok";
    } else {
      el.classList.add("wrong"); streak = 0;
      fb.textContent = "❌ " + q.a; fb.className = "feedback no";
      $all(".opt").forEach(function(o, j){ if(String(q.opts[j]) === String(q.a)) o.classList.add("correct"); });
    }
    setTimeout(function(){ locked = false; mk(); }, 600);
  };
  function end(){
    clearInterval(timer);
    var rec = score > best;
    if(rec){ best = score; localStorage.setItem("math_best_challenge", String(best)); }
    setStars(state.gi, state.bi, state.ui, score >= 120 ? 3 : score >= 60 ? 2 : score > 0 ? 1 : 0);
    /* 挑战没有满分概念，用「打破纪录」当最高光；praise.js 没加载上时退回原来的样子 */
    var P = window.PRAISE;
    var lv = P ? P.levelOfScore(score, rec) : "";
    var head = P
      ? P.block(lv, rec ? '<div style="margin-top:4px;font-weight:900;color:#e08b00">🎊 新纪录！</div>' : "")
      : '<div style="font-size:46px">' + (score >= 60 ? "🏆" : "⏱️") + '</div>';
    app.innerHTML = topbar("挑战结束", true) +
      '<div class="result-box">' + head +
        '<div class="read-score">' + score + '</div>' +
        '<div style="font-size:16px;color:var(--sub)">综合挑战 · 60 秒得分</div>' +
        '<div class="best">🏅 历史最高：' + best + '</div>' +
        '<div class="row">' +
          '<button class="btn ghost" onclick="startChallenge()">🔁 再来一次</button>' +
          '<button class="btn green" onclick="state.view=\'modes\';render()">🎮 换玩法</button>' +
        '</div>' +
        '<button class="btn pink" style="margin-top:12px" onclick="state.view=\'units\';render()">返回单元列表</button>' +
      '</div>';
    if (P && lv) setTimeout(function(){ P.fx(lv); }, 60);
  }
  if(window.__mathTimer) clearInterval(window.__mathTimer);
  var timer = setInterval(tick, 1000);
  window.__mathTimer = timer;
  mk();
}

/* ===================== 玩法注册表（新增玩法支持热更） =====================
 * 新增玩法不用出新 APK：把新玩法写进 js/game-xxx.js，在文件里调用
 *   registerGame({ id:"mygame", name:"新玩法", icon:"🎯", desc:"一句话说明", start: startMy });
 * tools/gen-pack.mjs 会自动扫到它（从 registerGame({id:"…"}) 读出 id），
 * boot.js 把这类文件插在 js/games.js 之后加载 —— 首页自动出现入口。
 * ======================================================================== */
window.GAMES = window.GAMES || [];
window.registerGame = function (g) {
  if (!g || !g.id) return null;
  for (var i = 0; i < window.GAMES.length; i++) {
    if (window.GAMES[i].id === g.id) { window.GAMES[i] = g; return g; }   // 同 id 覆盖（热更改玩法）
  }
  window.GAMES.push(g);
  return g;
};
window.getGame = function (id) {
  for (var i = 0; i < window.GAMES.length; i++) if (window.GAMES[i].id === id) return window.GAMES[i];
  return null;
};
registerGame({ id:"practice", name:"口算练习", icon:"🧮", desc:"8 道题闯关，稳扎稳打", start: startPractice });
registerGame({ id:"oral", name:"限时口算", icon:"⏱️", desc:"60 秒速算，看看多快", start: startOral });
registerGame({ id:"vertical", name:"竖式填空", icon:"📐", desc:"竖式里缺了谁？", start: startVertical });
registerGame({ id:"kousj", name:"口诀接龙", icon:"✖️", desc:"乘法口诀张口就来", start: startKousj });
registerGame({ id:"app", name:"应用题闯关", icon:"📖", desc:"生活中的数学题", start: startApp });
registerGame({ id:"shape", name:"图形分类", icon:"🔷", desc:"认图形，比特征", start: startShape });
registerGame({ id:"unit", name:"单位换算", icon:"📏", desc:"米厘米、元角分", start: startUnit });
registerGame({ id:"frac", name:"分数比大小", icon:"🍰", desc:"几分之几谁更大", start: startFrac });
registerGame({ id:"challenge", name:"综合挑战", icon:"🏆", desc:"口算+图形+单位大混战", start: startChallenge });
