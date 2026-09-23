/* ===================== 英语朗读引擎（原生 en-US + 有道音频兜底） ===================== */
// 微信内置浏览器（X5/腾讯浏览服务内核）基本不支持 Web Speech API，统一走真实音频
var isWeChat = /micromessenger/i.test(navigator.userAgent);
var voiceReady = false;

/* 本文件默认语种：cn/math=zh-CN，en=en-US。
   speak(text, lang) 始终优先用调用方显式传入的 lang（知识圈 v2 按学科算 curLang 传入），
   只在没传时才回落到本文件默认 —— 这样「中文题用中文嗓音、英文题用英文嗓音」由调用方决定，
   三科共用同一套健壮逻辑，根治「只读前半句」与卡顿。 */
var TTS_DEFAULT_LANG = "en-US";

function isEnLang(l){ return l && /^en/i.test(String(l)); }

/* 按文本语种挑系统嗓音：中文文本优先 zh 嗓音（否则英文嗓音读不出中文→静音）；
   英文文本优先 en 嗓音，缺 en 嗓音时退回任意可用嗓音，保证英文题也能出声。 */
function pickVoice(lang){
  if(!('speechSynthesis' in window)) return null;
  var vs = speechSynthesis.getVoices();
  if(!vs.length) return null;
  var fam = isEnLang(lang) ? 'en' : 'zh';
  var same = vs.filter(function(v){ return v.lang && v.lang.toLowerCase().indexOf(fam) === 0; });
  if(same.length) return same[0];
  return vs[0] || null;
}
if('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = function(){ voiceReady = true; };
}

/* —— 音频兜底：有道词典 TTS 返回 MP3；中文 le=zh，英文 type=2 —— */
var ttsAudio = new Audio(); ttsAudio.preload = 'none';
var audioQueue = [], audioBusy = false;

function youdaoURL(w, lang){
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(w) +
         (isEnLang(lang) ? '&type=2' : '&le=zh');
}
function flushAudio(){
  if(audioBusy) return;
  var url = audioQueue.shift();
  if(!url){ audioBusy = false; return; }
  audioBusy = true; ttsAudio.src = url;
  var p = ttsAudio.play();
  if(p && p.catch) p.catch(function(){ audioBusy = false; flushAudio(); });
}
ttsAudio.onended = function(){ audioBusy = false; flushAudio(); };
ttsAudio.onerror = function(){ audioBusy = false; flushAudio(); };

/* 按语种切分：中文按标点+12字；英文按句子边界、按词且不切碎单词（有道对超长串会拒）。 */
function splitText(text, lang){
  text = String(text);
  if(isEnLang(lang)){
    var parts = text.match(/[^.!?]+[.!?]?/g) || [text];
    var out = [];
    parts.forEach(function(p){
      p = p.trim(); if(!p) return;
      var words = p.split(/\s+/), chunk = '';
      words.forEach(function(wd){
        if((chunk + ' ' + wd).length > 180){ if(chunk) out.push(chunk); chunk = wd; }
        else chunk = chunk ? chunk + ' ' + wd : wd;
      });
      if(chunk) out.push(chunk);
    });
    return out.length ? out : [text];
  }
  var cparts = text.match(/[^，。！？；、\n]+[，。！？；、]?/g) || [text];
  var cout = [];
  cparts.forEach(function(p){
    p = p.trim(); if(!p) return;
    while(p.length > 12){ cout.push(p.slice(0,12)); p = p.slice(12); }
    if(p) cout.push(p);
  });
  return cout.length ? cout : [text];
}
function speakAudio(text, times, lang){
  audioQueue = [];
  var L = lang || TTS_DEFAULT_LANG;
  var n = times || 1;
  for (var i = 0; i < n; i++) {
    splitText(text, L).forEach(function(seg){ audioQueue.push(youdaoURL(seg, L)); });
  }
  audioBusy = false; flushAudio();
}

function speak(text, lang){
  if(!settings.tts || !text) return;
  var L = lang || TTS_DEFAULT_LANG;
  // TV / 机顶盒（无系统语音包）统一走有道 MP3 兜底（按语种选 le/type）
  if(!isWeChat && !window.__isTV && ('speechSynthesis' in window)){
    try{
      try{ speechSynthesis.cancel(); }catch(e){}
      var clauses = splitText(text, L);
      var v = pickVoice(L);
      var ci = 0;
      function next(){
        if(ci >= clauses.length) return;
        var u = new SpeechSynthesisUtterance(clauses[ci++]);
        if(v){ u.voice = v; } else { u.lang = L; }
        u.rate = settings.rate; u.pitch = 1;
        /* 引擎卡住兜底：到点没推进就 cancel，再延迟 60ms 朗读下一句 ——
           避开「cancel 后立即 speak」在安卓被整句吞掉的经典 bug（"只读前半句"根因之一）。 */
        var fired = false;
        var adv = function(){ if(fired) return; fired = true; clearTimeout(guard); next(); };
        var guard = setTimeout(function(){
          if(fired) return; fired = true;
          try{ speechSynthesis.cancel(); }catch(e){}
          setTimeout(next, 60);
        }, 4000);
        u.onend = adv; u.onerror = adv;
        try{ speechSynthesis.speak(u); }catch(e){ if(!fired){ fired = true; clearTimeout(guard); next(); } }
      }
      /* 首句前留 60ms：让初始 cancel 生效、首个 utterance 的 onend 能正常触发
         （否则安卓常出现"首句播得出、回调却永远不来"→ 只能靠 4s 兜底，体验割裂且易截断）。 */
      setTimeout(next, 60);
      return;
    }catch(e){ /* 原生失败则落到音频兜底 */ }
  }
  /* 电视版读两遍：遥控器操作慢、孩子常没听清。
     音频队列是串行的，第一遍播完会自动接上第二遍，不会互相打断。 */
  speakAudio(text, window.__isTV ? 2 : 1, L);
}

/* 首次交互解锁音频。
   ★ 修「电视端全程静音」：原实现只监听 pointerdown（触屏/鼠标），但电视是遥控器——
   用户从头到尾只发 keydown，从不 pointerdown，于是音频上下文永远停在"未解锁"，
   有道 MP3 与 Web Speech 全部静默。这里补上 keydown 解锁，并主动 resume AudioContext。 */
function unlockAudio(which){
  if('speechSynthesis' in window){
    try{ speechSynthesis.speak(new SpeechSynthesisUtterance('')); }catch(e){}
  }
  try {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (AC) { var c = AC._uK || (AC._uK = new AC()); if (c && c.state === "suspended") c.resume(); }
  } catch (e) {}
  if (which !== "keydown") { document.removeEventListener('pointerdown', unlockAudio); }
  document.removeEventListener('keydown', unlockAudio);
}
document.addEventListener('pointerdown', unlockAudio);
document.addEventListener('keydown', unlockAudio);
