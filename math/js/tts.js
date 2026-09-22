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
function speakAudio(text){
  audioQueue = [];
  splitZh(text).forEach(function(seg){ audioQueue.push(youdaoURL(seg)); });
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
         缺对应语种嗓音时退回可用嗓音，避免英文题因无 en 嗓音而整段静音。 */
      var clauses = String(text).match(/[^，。！？；、\n]+[，。！？；、]?/g) || [String(text)];
      var ci = 0;
      function sayNext(){
        if(ci >= clauses.length) return;
        var u = new SpeechSynthesisUtterance(clauses[ci++]);
        var v = pickVoice();
        if(v){ u.voice = v; } else { u.lang = lang || 'zh-CN'; }
        u.rate = settings.rate; u.pitch = 1;
        var done = false;
        var adv = function(){ if(done) return; done = true; sayNext(); };
        u.onend = adv; u.onerror = adv;
        speechSynthesis.speak(u);
      }
      sayNext();
      return;
    }catch(e){ /* 原生失败则落到音频兜底 */ }
  }
  speakAudio(text);
}

/* 首次交互解锁音频 */
function unlockAudio(){
  if('speechSynthesis' in window){
    try{ speechSynthesis.speak(new SpeechSynthesisUtterance('')); }catch(e){}
  }
  document.removeEventListener('pointerdown', unlockAudio);
}
document.addEventListener('pointerdown', unlockAudio);
