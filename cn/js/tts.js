/* ===================== 中文朗读引擎（原生 zh-CN + 有道音频兜底） ===================== */
// 微信内置浏览器（X5 内核）基本不支持 Web Speech API，统一走真实音频
var isWeChat = /micromessenger/i.test(navigator.userAgent);
var voiceReady = false;

function pickVoice(){
  if(!('speechSynthesis' in window)) return null;
  var vs = speechSynthesis.getVoices();
  if(!vs.length) return null;
  return vs.find(function(v){ return v.lang && /^zh/i.test(v.lang); })
      || vs.find(function(v){ return v.lang && v.lang.toLowerCase().indexOf('zh') === 0; })
      || vs[0] || null;
}
if('speechSynthesis' in window){
  speechSynthesis.onvoiceschanged = function(){ voiceReady = true; };
}

/* —— 音频兜底：有道词典 TTS 返回 MP3，中文用 le=zh —— */
var ttsAudio = new Audio(); ttsAudio.preload = 'none';
var audioQueue = [], audioBusy = false;

function youdaoURL(w){
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(w) + '&le=zh';
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

/* 中文按标点切分成短句，逐段请求，避免过长被拒 */
function splitZh(text){
  var parts = String(text).match(/[^，。！？；、\n]+[，。！？；、]?/g) || [String(text)];
  var out = [];
  parts.forEach(function(p){
    p = p.trim();
    if(!p) return;
    while(p.length > 12){ out.push(p.slice(0, 12)); p = p.slice(12); }
    if(p) out.push(p);
  });
  return out.length ? out : [String(text)];
}
function speakAudio(text, times){
  audioQueue = [];
  var n = times || 1;
  for (var i = 0; i < n; i++) {
    splitZh(text).forEach(function(seg){ audioQueue.push(youdaoURL(seg)); });
  }
  audioBusy = false; flushAudio();
}

function speak(text, lang){
  if(!settings.tts || !text) return;
  // TV / 机顶盒（无系统语音包）统一走有道 MP3 兜底
  if(!isWeChat && !window.__isTV && ('speechSynthesis' in window)){
    try{
      speechSynthesis.cancel();
      /* 按中文标点切成短句、逐句 onend 串联朗读：部分安卓 WebView 一次性朗读带标点的
         长句会在标点处截断（只读出前半句，如"同学们，"之后没了）。逐句衔接可根治；
         缺对应语种嗓音时退回可用嗓音，避免英文题因无 en 嗓音而整段静音。
         ★ 2026-09-23 修「只读前半句」：某些机顶盒 WebView 的 SpeechSynthesisUtterance
         onend/onerror 不触发或只触发一次，导致链路在首句后中断（只听到"同学们"）。
         因此给每句加一个 4s 安全网（guardT）：到点没推进就强制 cancel+下一句，
         保证整段一定读完；同时句间留 120ms 间隔，让引擎把上一句切干净再开始。 */
      var clauses = String(text).match(/[^，。！？；、\n]+[，。！？；、]?/g) || [String(text)];
      var ci = 0, guardT = null, busy = false;
      function sayNext(){
        if(ci >= clauses.length){ if(guardT){ clearTimeout(guardT); guardT = null; } busy = false; return; }
        busy = true;
        var u = new SpeechSynthesisUtterance(clauses[ci++]);
        var v = pickVoice();
        if(v){ u.voice = v; } else { u.lang = lang || 'zh-CN'; }
        u.rate = settings.rate; u.pitch = 1;
        var done = false, fired = false;
        var adv = function(){ if(fired) return; fired = true; if(guardT){ clearTimeout(guardT); guardT = null; } sayNext(); };
        u.onend = adv; u.onerror = adv;
        guardT = setTimeout(function(){
          if(fired) return; fired = true;       // onend 没收到的兜底推进
          try{ speechSynthesis.cancel(); }catch(e){}
          sayNext();
        }, 4000);
        try{ speechSynthesis.speak(u); }catch(e){ sayNext(); }
      }
      sayNext();
      return;
    }catch(e){ /* 原生失败则落到音频兜底 */ }
  }
  /* 电视版读两遍：遥控器操作慢、孩子常没听清。
     音频队列是串行的，第一遍播完会自动接上第二遍，不会互相打断。 */
  speakAudio(text, window.__isTV ? 2 : 1);
}

/* 首次交互解锁音频。
   ★ 2026-09-23 修「电视端全程静音」：原实现只监听 pointerdown（触屏/鼠标），
     但电视是遥控器——用户从头到尾只发 keydown，从不 pointerdown，
     于是音频上下文（<audio> 自动播放策略 / WebAudio AudioContext）永远停在"未解锁"，
     结果有道 MP3 与 Web Speech 全部静默。这里补上 keydown 解锁，并主动 resume AudioContext。 */
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
