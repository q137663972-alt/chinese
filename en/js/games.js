/* ===================== 出题工具 ===================== */
function buildRounds(unit, n){
  var pool = unit.w;
  var list = shuffle(pool).slice(0, Math.min(n, pool.length));
  return list.map(function(c){ return { correct: c }; });
}
function distractors(unit, correct, n){
  var others = unit.w.filter(function(w){ return w.e !== correct.e; });
  var pick = shuffle(others).slice(0, n - 1);
  return shuffle([correct].concat(pick));
}
/* 近音/形近干扰：优先同首字母，其次长度相近 */
function nearDistractors(unit, correct, n){
  var others = unit.w.filter(function(w){ return w.e !== correct.e; });
  var first = correct.e.replace(/[^A-Za-z]/g, "").charAt(0).toLowerCase();
  var same = others.filter(function(w){ return w.e.replace(/[^A-Za-z]/g, "").charAt(0).toLowerCase() === first; });
  var rest = others.filter(function(w){ return w.e.replace(/[^A-Za-z]/g, "").charAt(0).toLowerCase() !== first; });
  var pick = shuffle(same).concat(shuffle(rest)).slice(0, n - 1);
  return shuffle([correct].concat(pick));
}
/* 把本轮要读的文本挂到全局，供“再听一次”按钮调用（避免内联 onclick 里的引号问题） */
function bindReplay(text){ window.replayCurrent = function(){ speak(text); }; }

/* ===================== 1. 听音选图 ===================== */
function startListen(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur]; var opts = distractors(u, r.correct, 4);
    bindReplay(r.correct.e);
    gameShell(`
      <div class="game-head">
        <div class="progress-pill">${cur + 1}/${rounds.length}</div>
        <button class="replay" onclick="replayCurrent()">🔊</button>
      </div>
      <div class="big-emoji">🔊</div>
      <div class="prompt">听一听，选出正确的图片～</div>
      <div class="options">${opts.map(function(o, i){ return `
        <div class="opt" data-i="${i}" onclick="answerListen(${i})">
          <div>${o.k}</div><div class="opt-zh">${esc(o.z)}</div>
        </div>`; }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "听音选图");
    setTimeout(function(){ speak(r.correct.e); }, 350);
    window.answerListen = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var chosen = opts[i]; speak(chosen.e);
      var fb = $("#fb");
      if(chosen.e === r.correct.e){ el.classList.add("correct"); correct++; fb.textContent = "✅ 答对啦！"; fb.className = "feedback ok"; }
      else{
        el.classList.add("wrong"); fb.textContent = "❌ 再听一次～"; fb.className = "feedback no";
        speak(r.correct.e);
        $all(".opt").forEach(function(o, j){ if(opts[j].e === r.correct.e) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "听音选图");
      }, 1700);
    };
  }
  renderRound();
}

/* ===================== 2. 看图识词 ===================== */
function startPicture(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur]; var opts = distractors(u, r.correct, 4);
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${rounds.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="big-emoji">${r.correct.k}</div>
      <div class="prompt">这是「${esc(r.correct.z)}」，选出它的英文</div>
      <div class="options">${opts.map(function(o, i){ return `
        <div class="opt opt-text" onclick="answerPicture(${i})">${esc(o.e)}</div>`; }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "看图识词");
    bindReplay(r.correct.e);
    window.answerPicture = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var chosen = opts[i]; speak(chosen.e);
      var fb = $("#fb");
      if(chosen.e === r.correct.e){ el.classList.add("correct"); correct++; fb.textContent = "✅ 太棒了！"; fb.className = "feedback ok"; }
      else{
        el.classList.add("wrong"); fb.textContent = "❌ 正确答案在下面"; fb.className = "feedback no";
        speak(r.correct.e);          /* 答错也念，别让孩子只看到字母听不到音 */
        $all(".opt").forEach(function(o, j){ if(opts[j].e === r.correct.e) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "看图识词");
      }, 1700);
    };
  }
  renderRound();
}

/* ===================== 3. 单词拼写 ===================== */
function startSpelling(){
  var u = curUnit();
  var spellable = u.w.filter(function(w){ return !w.e.includes(" ") && w.e.length >= 2 && w.e.length <= 10; });
  var rounds = (spellable.length ? spellable : u.w).slice();
  var list = shuffle(rounds).slice(0, Math.min(8, rounds.length));
  var cur = 0, correct = 0;
  function renderRound(){
    var w = list[cur];
    var letters = shuffle(w.e.split(""));
    bindReplay(w.e);
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${list.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="big-emoji">${w.k}</div>
      <div class="prompt">拼出单词：${esc(w.z)}</div>
      <div class="answer-box" id="ans"></div>
      <div class="tiles" id="tiles">${letters.map(function(c, i){
        return `<div class="tile" data-c="${esc(c)}" data-i="${i}" onclick="pickLetter(${i})">${esc(c)}</div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>
      <button class="btn ghost" style="margin-top:14px" onclick="resetSpelling()">🔄 清空重拼</button>`, "单词拼写");
    setTimeout(function(){ speak(w.e); }, 350);
    window.pickLetter = function(i){
      var el = $all("#tiles .tile")[i];
      if(el.classList.contains("used")) return;
      el.classList.add("used");
      var ans = $("#ans"); var span = document.createElement("span");
      span.textContent = el.dataset.c; span.dataset.i = i; ans.appendChild(span);
      if(ans.children.length === w.e.length){
        var typed = Array.prototype.map.call(ans.children, function(s){ return s.textContent; }).join("");
        var fb = $("#fb");
        if(typed === w.e){ correct++; fb.textContent = "✅ 拼对啦！"; fb.className = "feedback ok"; speak(w.e); }
        else{ fb.textContent = "❌ 再试试"; fb.className = "feedback no"; speak(w.e); }
        setTimeout(function(){
          if(fb.className.indexOf("ok") >= 0){
            cur++;
            if(cur < list.length) renderRound(); else finishGame(correct, list.length, "单词拼写");
          } else resetSpelling();
        }, 1600);
      }
    };
    window.resetSpelling = function(){
      $("#ans").innerHTML = "";
      $all("#tiles .tile").forEach(function(t){ t.classList.remove("used"); });
      var fb = $("#fb"); fb.textContent = ""; fb.className = "feedback";
    };
  }
  renderRound();
}

/* ===================== 4. 翻牌配对 ===================== */
function startMemory(){
  var u = curUnit();
  var words = shuffle(u.w).slice(0, Math.min(6, u.w.length));
  if(words.length < 2) words = shuffle(u.w.concat(u.w)).slice(0, 6);
  var cards = [];
  words.forEach(function(w, idx){
    cards.push({ type: "emoji", word: w, key: idx });
    cards.push({ type: "text", word: w, key: idx });
  });
  cards = shuffle(cards);
  var first = null, lock = false, matched = 0;
  function renderGrid(){
    gameShell(`
      <div class="game-head"><div class="progress-pill">已配对 ${matched}/${words.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="prompt">翻开两张卡，找出「图—词」好朋友</div>
      <div class="mem-grid" id="mg">${cards.map(function(c, i){ return `
        <div class="mem-card" onclick="flip(${i})">
          <div class="back">❓</div>
          <div class="face">${c.type === "emoji" ? c.word.k : esc(c.word.e)}</div>
        </div>`; }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "翻牌配对");
    bindReplay("Find the matching pair");
  }
  window.flip = function(i){
    if(lock) return;
    var el = $all("#mg .mem-card")[i];
    if(el.classList.contains("flipped") || el.classList.contains("matched")) return;
    el.classList.add("flipped");
    var c = cards[i]; speak(c.word.e);
    if(!first){ first = { i: i, c: c, el: el }; return; }
    var f = first, el2 = f.el;
    if(f.c.key === c.key && f.c.type !== c.type){
      setTimeout(function(){
        el.classList.add("matched"); el2.classList.add("matched"); matched++;
        var fb = $("#fb"); fb.textContent = "✅ 配对成功！"; fb.className = "feedback ok";
        first = null;
        if(matched === words.length) setTimeout(function(){ finishGame(matched, words.length, "翻牌配对"); }, 700);
      }, 450);
    } else {
      lock = true;
      setTimeout(function(){
        el.classList.remove("flipped"); el2.classList.remove("flipped");
        first = null; lock = false;
      }, 900);
    }
  };
  renderGrid();
}

/* ===================== 5. 跟读打分 ===================== */
function startRead(){
  var u = curUnit();
  var list = shuffle(u.w).slice(0, Math.min(8, u.w.length));
  var cur = 0, total = 0, sumScore = 0;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  // 原生桥（安卓壳注入的 window.AndroidSR）让带麦遥控器也能真跟读打分；
  // 无桥 / 不支持 / 拒授权时回落手动。TV 的 WebView 不支持网页语音识别，故走此桥。
  function hasNativeSR(){
    if(!window.AndroidSR) return false;
    try { return window.AndroidSR.isAvailable ? !!window.AndroidSR.isAvailable() : true; }
    catch(e){ return false; }
  }
  var nativeSR = hasNativeSR();
  var noMic = (!SR && !nativeSR); // 既有 webkit 路径，也有原生桥路径；都不可用才走手动
  function renderRound(){
    var w = list[cur];
    bindReplay(w.e);
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${list.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="big-emoji">${w.k}</div>
      <div class="big-word">${esc(w.e)}</div>
      <div class="prompt">${esc(w.z)} · 先听示范，再跟我读</div>
      ${noMic ? "" : `<button class="mic-btn" id="mic" onclick="startRec()">🎤</button>`}
      <div class="read-score" id="score"></div>
      <div class="read-hint" id="hint">${noMic ? "听完示范，点「我读啦，过关」即可" : "点麦克风开始跟读"}</div>
      ${noMic ? "" : `<button class="btn ghost" style="margin-top:10px" onclick="nextRead()">跳过 ➡️</button>`}
      <div class="row" id="manualRow" style="display:${noMic ? "flex" : "none"}">
        <button class="btn green" onclick="manualPass()">✅ 我读啦，过关</button>
      </div>`, "跟读打分");
    setTimeout(function(){ speak(w.e); }, 350);
  }
  /* 麦克风不可用/被拒时，兜底放出「我读啦」按钮，避免卡住 */
  function showManual(msg){
    var mr = $("#manualRow"); if(mr) mr.style.display = "flex";
    var h = $("#hint"); if(h && msg) h.textContent = msg;
  }
  var gotResult = false;
  window.startRec = function(){
    // 原生桥路径（带麦遥控器的安卓壳）：交给原生 SpeechRecognizer，结果经回调回传
    if(nativeSR && window.AndroidSR){
      var mic = $("#mic"); if(mic) mic.classList.add("listening");
      var h = $("#hint"); if(h) h.textContent = "正在聆听…大声读出来吧！";
      window.__onNativeSRResult = function(t){
        gotResult = true;
        var m = $("#mic"); if(m) m.classList.remove("listening");
        finishRec(t || "");
      };
      window.__onNativeSRError = function(m){
        var m2 = $("#mic"); if(m2) m2.classList.remove("listening");
        showManual(m || "没听清，可以直接点「我读啦，过关」");
      };
      try{ window.AndroidSR.start(); }catch(err){
        var m3 = $("#mic"); if(m3) m3.classList.remove("listening");
        showManual("麦克风启动失败，可以直接点「我读啦，过关」");
      }
      // 8 秒还听不到声音也放行，避免孩子卡在这一题
      setTimeout(function(){
        if(!gotResult){ var m4 = $("#mic"); if(m4) m4.classList.remove("listening"); showManual("没听到声音，可以直接点「我读啦，过关」"); }
      }, 8000);
      return;
    }
    if(!SR){ toast("当前浏览器不支持语音识别"); return; }
    var mic = $("#mic"); mic.classList.add("listening"); $("#hint").textContent = "正在聆听…大声读出来吧！";
    var rec = new SR(); rec.lang = "en-US"; rec.interimResults = false; rec.maxAlternatives = 1;
    gotResult = false;
    rec.onresult = function(e){ gotResult = true; finishRec(e.results[0][0].transcript); };
    rec.onerror = function(e){ mic.classList.remove("listening"); showManual(e && e.error === "not-allowed" ? "麦克风被禁用了，可以直接点「我读啦，过关」" : "没听清，可以直接点「我读啦，过关」"); };
    rec.onend = function(){ mic.classList.remove("listening"); };
    try{ rec.start(); }catch(err){ mic.classList.remove("listening"); showManual("麦克风启动失败，可以直接点「我读啦，过关」"); }
    // 8 秒还听不到声音也放行，避免孩子卡在这一题
    setTimeout(function(){
      if(!gotResult){ mic.classList.remove("listening"); showManual("没听到声音，可以直接点「我读啦，过关」"); }
    }, 8000);
  };
  function finishRec(txt){
    var w = list[cur]; var sc = scoreRead(w.e, txt);
    var scEl = $("#score");
    scEl.textContent = sc + "分";
    scEl.style.color = sc >= 80 ? "#3fc26b" : sc >= 50 ? "#ffd166" : "#ff6f91";
    $("#hint").textContent = txt ? "你说的是：" + txt : "没听清";
    total++; sumScore += sc;
    setTimeout(nextRead, 1200);
  }
  window.manualPass = function(){ total++; sumScore += 100; nextRead(); };
  function nextRead(){
    cur++;
    if(cur < list.length) renderRound();
    else{
      var avg = total ? Math.round(sumScore / total) : 0;
      var earned = avg >= 80 ? 3 : avg >= 50 ? 2 : total > 0 ? 1 : 0;
      finishGame(earned, 1, "跟读打分");
    }
  }
  window.nextRead = nextRead;
  function scoreRead(target, transcript){
    if(!transcript) return 0;
    var t = target.toLowerCase().replace(/[^a-z]/g, "");
    var h = transcript.toLowerCase().replace(/[^a-z]/g, "");
    if(!h) return 0;
    if(h.indexOf(t) >= 0 || t.indexOf(h) >= 0) return 100;
    return Math.round((1 - lev(t, h) / Math.max(t.length, h.length)) * 100);
  }
  function lev(a, b){
    var m = a.length, n = b.length;
    var d = [];
    for(var i = 0; i <= m; i++){ d[i] = [i]; for(var j = 1; j <= n; j++) d[i][j] = j; }
    for(var j2 = 0; j2 <= n; j2++) d[0][j2] = j2;
    for(var i2 = 1; i2 <= m; i2++)
      for(var j3 = 1; j3 <= n; j3++)
        d[i2][j3] = Math.min(d[i2 - 1][j3] + 1, d[i2][j3 - 1] + 1, d[i2 - 1][j3 - 1] + (a[i2 - 1] === b[j3 - 1] ? 0 : 1));
    return d[m][n];
  }
  renderRound();
}

/* ===================== 6. 连词成句（句型） ===================== */
function startSentence(){
  var u = curUnit();
  var pool = (u.s && u.s.length) ? u.s : [];
  if(!pool.length){ toast("本单元暂无句型"); return; }
  var list = shuffle(pool).slice(0, Math.min(6, pool.length));
  var cur = 0, correct = 0;
  function renderRound(){
    var s = list[cur];
    var words = s.e.trim().split(/\s+/);
    var bank = shuffle(words.slice());
    var usedIdx = [];
    function build(){ return usedIdx.map(function(i){ return bank[i]; }); }
    function draw(){
      gameShell(`
        <div class="game-head"><div class="progress-pill">${cur + 1}/${list.length}</div>
        <button class="replay" onclick="replayCurrent()">🔊</button></div>
        <div class="prompt">点词块，把它们排成一句话</div>
        <div class="sent-slots">${usedIdx.map(function(i, k){
          return `<span class="sw" onclick="unpickWord(${k})">${esc(bank[i])}</span>`;
        }).join("")}</div>
        <div class="sent-zh">中文：${esc(s.z)}</div>
        <div class="sent-bank">${bank.map(function(w, i){
          return `<span class="bw ${usedIdx.indexOf(i) >= 0 ? "used" : ""}" onclick="pickWord(${i})">${esc(w)}</span>`;
        }).join("")}</div>
        <div class="feedback" id="fb"></div>`, "连词成句");
    }
    bindReplay(s.e);
    window.pickWord = function(i){
      if(usedIdx.indexOf(i) >= 0) return;
      usedIdx.push(i);
      draw();
      if(usedIdx.length === words.length){
        var built = build().join(" ");
        var fb = $("#fb");
        if(built === words.join(" ")){
          correct++; fb.textContent = "✅ 排对啦！"; fb.className = "feedback ok"; speak(s.e);
        } else { fb.textContent = "❌ 顺序不对，再试"; fb.className = "feedback no"; speak(s.e); }
        setTimeout(function(){
          if(fb.className.indexOf("ok") >= 0){
            cur++;
            if(cur < list.length) renderRound(); else finishGame(correct, list.length, "连词成句");
          } else { usedIdx = []; draw(); }
        }, 1800);
      }
    };
    window.unpickWord = function(k){ usedIdx.splice(k, 1); draw(); };
    draw();
    setTimeout(function(){ speak(s.e); }, 350);
  }
  renderRound();
}

/* ===================== 7. 句型填空（句型） ===================== */
function startFill(){
  var u = curUnit();
  var pool = (u.s && u.s.length) ? u.s : [];
  var rounds = [];
  shuffle(pool).slice(0, 8).forEach(function(s){
    var words = s.e.trim().split(/\s+/);
    var cands = [];
    words.forEach(function(w, i){
      var clean = w.replace(/[^A-Za-z']/g, "");
      if(clean.length >= 3) cands.push({ w: clean, i: i });
    });
    if(cands.length) rounds.push({ s: s, blank: cands[Math.floor(Math.random() * cands.length)], words: words });
  });
  if(!rounds.length){ toast("本单元句型不适合填空"); return; }
  var list = rounds.slice(0, Math.min(6, rounds.length));
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = list[cur];
    var opts = shuffle([r.blank.w].concat(
      shuffle(u.w.map(function(w){ return w.e; }).filter(function(e){
        return e.toLowerCase() !== r.blank.w.toLowerCase();
      })).slice(0, 3)
    ));
    var shown = r.words.slice();
    shown[r.blank.i] = "____";
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${list.length}</div></div>
      <div class="prompt">给句子选一个合适的词</div>
      <div class="big-word" style="font-size:22px;line-height:1.5;padding:0 6px">${esc(shown.join(" "))}</div>
      <div class="sent-zh">中文：${esc(r.s.z)}</div>
      <div class="options">${opts.map(function(o, i){
        return `<div class="opt opt-text" onclick="answerFill(${i})">${esc(o)}</div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "句型填空");
    window.answerFill = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      if(opts[i].toLowerCase() === r.blank.w.toLowerCase()){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 对啦：" + r.s.e; fb.className = "feedback ok"; speak(r.s.e);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确词是 " + r.blank.w; fb.className = "feedback no";
        speak(r.blank.w);
        $all(".opt").forEach(function(o, j){ if(opts[j].toLowerCase() === r.blank.w.toLowerCase()) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "句型填空");
      }, 2000);
    };
  }
  renderRound();
}

/* ===================== 8. 情景对话补全（句型） ===================== */
function startDialog(){
  var u = curUnit();
  var pool = (u.s && u.s.length) ? u.s : [];
  if(pool.length < 2){ toast("本单元句型不足"); return; }
  // 相邻两句组成一问一答
  var pairs = [];
  for(var i = 1; i < pool.length; i++) pairs.push({ a: pool[i - 1], b: pool[i] });
  var list = [];
  while(list.length < Math.min(5, Math.max(3, pairs.length * 2))) list.push(pairs[list.length % pairs.length]);
  // 干扰句：本年级其它单元的句子
  var others = [];
  DATA.grades[state.gi].books.forEach(function(b){
    b.u.forEach(function(un){ (un.s || []).forEach(function(s){ if(s.e !== u.s[0].e) others.push(s); }); });
  });
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var p = list[cur];
    var opts = shuffle([p.b].concat(shuffle(others).slice(0, 3)));
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${list.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="prompt">读一读，选出合适的回答</div>
      <div class="dlg">
        <div class="bubble a"><span class="who">A</span>${esc(p.a.e)}</div>
      </div>
      <div class="options">${opts.map(function(o, i){
        return `<div class="opt opt-text" onclick="answerDialog(${i})">${esc(o.e)}</div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "情景对话");
    bindReplay(p.a.e);
    setTimeout(function(){ speak(p.a.e); }, 350);
    window.answerDialog = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      if(opts[i].e === p.b.e){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 说得真好！"; fb.className = "feedback ok"; speak(opts[i].e);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 看看正确的回答"; fb.className = "feedback no";
        speak(p.b.e);
        $all(".opt").forEach(function(o, j){ if(opts[j].e === p.b.e) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "情景对话");
      }, 2000);
    };
  }
  renderRound();
}

/* ===================== 9. 听音辨词 ===================== */
function startSound(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur]; var opts = nearDistractors(u, r.correct, 4);
    bindReplay(r.correct.e);
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${rounds.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="big-emoji">👂</div>
      <div class="prompt">仔细听，是哪个单词？</div>
      <div class="options">${opts.map(function(o, i){
        return `<div class="opt opt-text" onclick="answerSound(${i})">${esc(o.e)}</div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "听音辨词");
    setTimeout(function(){ speak(r.correct.e); }, 350);
    window.answerSound = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      if(opts[i].e === r.correct.e){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ 耳朵真灵！"; fb.className = "feedback ok"; speak(opts[i].e);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 是 " + r.correct.e; fb.className = "feedback no";
        speak(r.correct.e);
        $all(".opt").forEach(function(o, j){ if(opts[j].e === r.correct.e) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "听音辨词");
      }, 1900);
    };
  }
  renderRound();
}

/* ===================== 10. 看中文选英文 ===================== */
function startCn2en(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur]; var opts = distractors(u, r.correct, 4);
    gameShell(`
      <div class="game-head"><div class="progress-pill">${cur + 1}/${rounds.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="big-emoji">${r.correct.k}</div>
      <div class="big-word" style="font-size:26px">${esc(r.correct.z)}</div>
      <div class="prompt">选出对应的英文单词</div>
      <div class="options">${opts.map(function(o, i){
        return `<div class="opt opt-text" onclick="answerCn2en(${i})">${esc(o.e)}</div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "看中文选英文");
    bindReplay(r.correct.e);
    window.answerCn2en = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var chosen = opts[i]; speak(chosen.e);
      var fb = $("#fb");
      if(chosen.e === r.correct.e){ el.classList.add("correct"); correct++; fb.textContent = "✅ 答对啦！"; fb.className = "feedback ok"; }
      else{
        el.classList.add("wrong"); fb.textContent = "❌ 正确答案在下面"; fb.className = "feedback no";
        speak(r.correct.e);          /* 中文题干 → 必须把英文答案念出来 */
        $all(".opt").forEach(function(o, j){ if(opts[j].e === r.correct.e) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "看中文选英文");
      }, 1700);
    };
  }
  renderRound();
}

/* ===================== 11. 单词消消乐 ===================== */
function startEliminate(){
  var u = curUnit();
  var words = shuffle(u.w).slice(0, Math.min(6, Math.max(2, Math.floor(u.w.length / 2))));
  if(words.length < 2) words = shuffle(u.w).slice(0, 2);
  var cells = [];
  words.forEach(function(w, idx){
    cells.push({ type: "emoji", word: w, key: idx, gone: false });
    cells.push({ type: "text", word: w, key: idx, gone: false });
  });
  cells = shuffle(cells);
  var sel = -1, matched = 0, lock = false;
  function draw(){
    gameShell(`
      <div class="game-head"><div class="progress-pill">已消 ${matched}/${words.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="prompt">点「图」和「词」，配成一对消掉</div>
      <div class="xgrid" id="xg">${cells.map(function(c, i){
        return `<div class="xcell ${c.gone ? "gone" : ""} ${sel === i ? "sel" : ""}" onclick="tapCell(${i})">
          ${c.type === "emoji"
            ? `<div style="font-size:34px">${c.word.k}</div>`
            : `<div class="cx">${esc(c.word.e)}</div>`}
        </div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "单词消消乐");
    bindReplay("Match the picture and the word");
  }
  window.tapCell = function(i){
    if(lock) return;
    var c = cells[i];
    if(c.gone) return;
    if(sel === i){ sel = -1; draw(); return; }
    if(sel < 0){ sel = i; speak(c.word.e); draw(); return; }
    var a = cells[sel];
    if(a.key === c.key && a.type !== c.type){
      a.gone = true; c.gone = true; matched++; sel = -1;
      speak(c.word.e);
      var fb = $("#fb"); fb.textContent = "✅ 消掉一对！"; fb.className = "feedback ok";
      draw();
      if(matched === words.length) setTimeout(function(){ finishGame(matched, words.length, "单词消消乐"); }, 700);
    } else {
      lock = true; var prev = sel; sel = i; draw();
      setTimeout(function(){ sel = -1; lock = false; draw(); }, 600);
    }
  };
  draw();
}

/* ===================== 12. 分类归筐 ===================== */
function startSort(){
  var book = DATA.grades[state.gi].books[state.bi];
  var units = book.u;
  if(units.length < 2){ toast("单元数量不足"); return; }
  var idxs = [state.ui];
  for(var i = 0; i < units.length && idxs.length < 3; i++) if(idxs.indexOf(i) < 0) idxs.push(i);
  idxs = shuffle(idxs).slice(0, Math.min(3, units.length));
  if(idxs.indexOf(state.ui) < 0) idxs[0] = state.ui;
  var groups = idxs.map(function(ui){
    var un = units[ui];
    return {
      label: un.n.replace(/^Unit\s*\d+\s*/, ""),
      emoji: (un.w[0] && un.w[0].k) || "📘",
      words: shuffle(un.w).slice(0, 3),
      got: []
    };
  });
  var pool = [];
  groups.forEach(function(g, gi){ g.words.forEach(function(w){ pool.push({ w: w, gi: gi, done: false }); }); });
  pool = shuffle(pool);
  var sel = -1, correct = 0;
  function draw(){
    gameShell(`
      <div class="game-head"><div class="progress-pill">已归类 ${correct}/${pool.length}</div>
      <button class="replay" onclick="replayCurrent()">🔊</button></div>
      <div class="prompt">先点一个单词，再点它属于哪个主题筐</div>
      <div class="word-pool">${pool.map(function(p, i){
        return `<span class="wp-item ${p.done ? "gone" : ""} ${sel === i ? "sel" : ""}" onclick="tapWord(${i})">${esc(p.w.e)}</span>`;
      }).join("")}</div>
      <div class="buckets">${groups.map(function(g, gi){
        return `<div class="bucket" onclick="tapBucket(${gi})">
          <div class="bk-emoji">${g.emoji}</div>
          <div class="bk-name">${esc(g.label)}</div>
          <div class="bk-count">${g.got.length}</div>
        </div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "分类归筐");
    bindReplay("Put the words into the right group");
  }
  window.tapWord = function(i){
    if(pool[i].done) return;
    sel = i; speak(pool[i].w.e); draw();
  };
  window.tapBucket = function(gi){
    if(sel < 0){ toast("先选一个单词"); return; }
    var p = pool[sel];
    var fb = $("#fb");
    var bEl = $all(".bucket")[gi];
    if(p.gi === gi){
      p.done = true; groups[gi].got.push(p.w); correct++; sel = -1;
      fb.textContent = "✅ 放对啦！"; fb.className = "feedback ok";
      bEl.classList.add("hit");
      draw();
      if(correct === pool.length) setTimeout(function(){ finishGame(correct, pool.length, "分类归筐"); }, 700);
    } else {
      fb.textContent = "❌ 这个不属于这里"; fb.className = "feedback no";
      speak(p.w.e);
      bEl.classList.add("miss");
      setTimeout(function(){ bEl.classList.remove("miss"); }, 600);
    }
  };
  draw();
}

/* ===================== 13. 限时挑战 ===================== */
function startChallenge(){
  var u = curUnit();
  var TIME = 60;
  var left = TIME, score = 0, streak = 0, best = parseInt(localStorage.getItem("el_best_challenge") || "0", 10) || 0;
  var timer = null, locked = false, q = null;
  var rounds = shuffle(u.w).slice(0, Math.min(12, u.w.length));
  if(rounds.length < 4) rounds = shuffle(u.w.concat(u.w)).slice(0, 8);
  var qi = 0;
  function nextQ(){
    var w = rounds[qi % rounds.length]; qi++;
    var opts = distractors(u, w, 4);
    var isCn = Math.random() < 0.5;
    return { w: w, opts: opts, isCn: isCn };
  }
  function draw(){
    var pct = Math.max(0, left / TIME * 100);
    gameShell(`
      <div class="game-head">
        <div class="progress-pill">⏱️ ${left}s</div>
        <div class="progress-pill">💯 ${score}</div>
      </div>
      <div class="timer-wrap"><div class="timer-bar ${pct < 25 ? "low" : ""}" style="width:${pct}%"></div></div>
      <div class="combo" id="combo">${streak >= 3 ? "🔥 连击 x" + streak : ""}</div>
      ${q.isCn
        ? `<div class="big-emoji">${q.w.k}</div><div class="big-word" style="font-size:26px">${esc(q.w.z)}</div>`
        : `<div class="big-emoji">${q.w.k}</div>`}
      <div class="prompt">${q.isCn ? "选出英文单词" : "这是哪个单词？"}</div>
      <div class="options">${q.opts.map(function(o, i){
        return `<div class="opt opt-text" onclick="answerChallenge(${i})">${esc(o.e)}</div>`;
      }).join("")}</div>
      <div class="feedback" id="fb"></div>`, "限时挑战");
  }
  function tick(){
    /* ★ 自杀保护：界面已经不是本玩法了就停掉自己。
       只在 goBack() 里 clearInterval 盖不全所有出口 —— 结算页的「🎮 换玩法 /
       返回单元列表」这类按钮直接改 state.view 再 render()，压根不经过 goBack，
       计时器会继续每秒跑、把界面重新抢回游戏里，表现就是「退出后自动跳回去」。 */
    if (state.view !== "game" || state.mode !== "challenge") {
      clearInterval(timer); window.__enTimer = null; return;
    }
    left--;
    if(left <= 0){ endChallenge(); return; }
    var bar = $(".timer-bar");
    if(bar){ bar.style.width = Math.max(0, left / TIME * 100) + "%"; if(left / TIME < 0.25) bar.classList.add("low"); }
    var pill = $(".progress-pill");
    if(pill) pill.textContent = "⏱️ " + left + "s";
  }
  window.answerChallenge = function(i){
    if(locked) return; locked = true;
    var el = $all(".opt")[i]; var fb = $("#fb");
    if(q.opts[i].e === q.w.e){
      el.classList.add("correct"); streak++; score += 10 + (streak >= 3 ? 5 : 0);
      fb.textContent = "✅ +" + (10 + (streak >= 3 ? 5 : 0)); fb.className = "feedback ok";
      speak(q.w.e);
    } else {
      el.classList.add("wrong"); streak = 0;
      fb.textContent = "❌ " + q.w.e; fb.className = "feedback no";
      speak(q.w.e);
      $all(".opt").forEach(function(o, j){ if(q.opts[j].e === q.w.e) o.classList.add("correct"); });
    }
    setTimeout(function(){ q = nextQ(); locked = false; draw(); }, 1300);
  };
  function endChallenge(){
    clearInterval(timer);
    window.__enTimer = null;
    var rec = score > best;
    if(rec){ best = score; localStorage.setItem("el_best_challenge", String(best)); }
    setStars(state.gi, state.bi, state.ui, score >= 120 ? 3 : score >= 60 ? 2 : score > 0 ? 1 : 0);
    /* 挑战没有满分概念，用「打破纪录」当最高光；praise.js 没加载上时退回原来的样子 */
    var P = window.PRAISE;
    var lv = P ? P.levelOfScore(score, rec) : "";
    var head = P
      ? P.block(lv, rec ? '<div style="margin-top:4px;font-weight:900;color:#e08b00">🎊 新纪录！</div>' : "")
      : '<div style="font-size:46px">' + (score >= 60 ? "🏆" : "⏱️") + '</div>';
    app.innerHTML = topbar("挑战结束", true) + `
      <div class="result-box">
        ${head}
        <div class="read-score">${score}</div>
        <div style="font-size:16px;color:var(--sub)">限时挑战 · 60 秒得分</div>
        <div class="best">🏅 历史最高：${best}</div>
        <div class="row">
          <button class="btn ghost" onclick="startChallenge()">🔁 再来一次</button>
          <button class="btn green" onclick="state.view='modes';render()">🎮 换玩法</button>
        </div>
        <button class="btn pink" style="margin-top:12px" onclick="state.view='units';render()">返回单元列表</button>
      </div>`;
    if (P && lv) setTimeout(function(){ P.fx(lv); }, 60);
  }
  if (window.__enTimer) clearInterval(window.__enTimer);   // 重入时先掐掉上一轮
  q = nextQ();
  draw();
  timer = setInterval(tick, 1000);
  /* ★ 必须挂到 window 上：只放在闭包变量里的话，goBack() 根本摸不到它，
     退出玩法后计时器照跑，一秒后又把界面抢回游戏（用户反馈的「自动跳回去」）。 */
  window.__enTimer = timer;
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
registerGame({ id:"listen", name:"听音选图", icon:"🔊", desc:"听发音，选正确的图", start: startListen });
registerGame({ id:"spelling", name:"单词拼写", icon:"✏️", desc:"听一听，拼出单词", start: startSpelling });
registerGame({ id:"read", name:"跟读打分", icon:"🎤", desc:"跟着读，AI 来打分", start: startRead });
registerGame({ id:"sentence", name:"连词成句", icon:"🧩", desc:"把词块排成一句话", start: startSentence });
registerGame({ id:"fill", name:"句型填空", icon:"📝", desc:"给句型选个合适的词", start: startFill });
registerGame({ id:"dialog", name:"情景对话", icon:"💬", desc:"补全对话，开口说", start: startDialog });
registerGame({ id:"sound", name:"听音辨词", icon:"👂", desc:"近音词辨析，仔细听", start: startSound });
registerGame({ id:"cn2en", name:"看中文选英文", icon:"🇨🇳", desc:"看中文，选英文单词", start: startCn2en });
registerGame({ id:"eliminate", name:"单词消消乐", icon:"💥", desc:"图文配对，消掉它们", start: startEliminate });
registerGame({ id:"sort", name:"分类归筐", icon:"🗂️", desc:"把单词放进主题筐", start: startSort });
registerGame({ id:"challenge", name:"限时挑战", icon:"⏱️", desc:"60秒连击，挑战最高分", start: startChallenge });
