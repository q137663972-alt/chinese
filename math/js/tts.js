/* ===================== 中文朗读引擎（原生 zh-CN + 有道音频兜底） ===================== */
// 微信内置浏览器（X5 内核）基本不支持 Web Speech API，统一走真实音频
var isWeChat = /micromessenger/i.test(navigator.userAgent);
var voiceReady = false;

/* 本文件默认语种：cn/math=zh-CN，en=en-US。
   speak(text, lang) 始终优先用调用方显式传入的 lang（知识圈 v2 按学科算 curLang 传入），
   只在没传时才回落到本文件默认 —— 这样「中文题用中文嗓音、英文题用英文嗓音」由调用方决定，
   三科共用同一套健壮逻辑，根治「只读前半句」与卡顿。 */
var TTS_DEFAULT_LANG = "zh-CN";

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

/* —— 音频兜底：有道词典 TTS 返回 MP3；中文 le=zh，英文 type=2 ——
   ★★ 2026-09-22 重写播放核心（根治「只读前半句 / 后半程台词全部无声」）
   旧实现：一个共享 Audio + audioBusy 标志，靠 onended 串起下一段。
   安卓 WebView 上 onended 经常不触发（或被后来的 src 覆盖吞掉），audioBusy 便永久停在 true：
     ① 第一段「同学们，」播完，onended 不来 →「去操场集合！」永远不播   ← 用户反馈的现象
     ② 此后每次 speakAudio 都被 `if(audioBusy) return` 挡掉 → 罚站点名、得分反馈全部无声
   新实现三重保险：
     ① 每段用一个独立 Audio 对象（互不覆盖，ended 回调归属明确）
     ② ended / error / play 被拒 / 时长兜底定时器 四路推进，任一路先到就继续下一段
     ③ 打断令牌 _aToken：被新场景打断的旧队列回调见到令牌变了立即退出，绝不与新队列抢播
   另加 mode 参数：'cut'（默认，清队立刻播，用于开场/读题等场景切换）、
   'queue'（排队不打断，用于罚站点名、得分反馈这类绝不能丢的台词）。 */
var _aQ = [], _aBusy = false, _aCur = null, _aToken = 0;

function youdaoURL(w, lang){
  return 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(w) +
         (isEnLang(lang) ? '&type=2' : '&le=zh');
}
/* 按文本长度估算播放时长：onended 不触发时靠它兜底推进（宁可早一点，也不卡死整条队列） */
function estMs(s, lang){
  s = String(s);
  if(isEnLang(lang)) return 1300 + s.split(/\s+/).length * 420;   /* 英文按词算 */
  return 1200 + s.length * 260;                                   /* 中文按字算 */
}

/* 播一段：无论发生什么，next() 最多触发一次，且一定会让队列继续往下走 */
function playOne(url, token, cap){
  var a = new Audio();
  _aCur = a;
  try { a.preload = 'auto'; } catch (e) {}
  try { a.src = url; } catch (e) {}                        /* ★ 必设：漏了就等于整场静音 */
  var done = false, guard = null;
  function next(){
    if (done) return; done = true;
    if (guard) clearTimeout(guard);
    if (_aCur === a) _aCur = null;
    if (token !== _aToken) return;                         /* 已被新场景打断 → 交给新令牌的队列 */
    _aBusy = false;
    setTimeout(function () { flushAudio(token); }, 50);    /* 段间留 50ms：安卓上连播不间隔会互吞 */
  }
  a.onended = next; a.onerror = next;
  guard = setTimeout(next, cap);
  a.onloadedmetadata = function () {                       /* 拿到真实时长就换成精确兜底 */
    try {
      var d = a.duration;
      if (isFinite(d) && d > 0 && d < 40) { if (guard) clearTimeout(guard); guard = setTimeout(next, d * 1000 + 900); }
    } catch (e) {}
  };
  try {
    var p = a.play();
    if (p && p.catch) p.catch(function () { setTimeout(next, 300); });   /* 被拒 → 跳过，绝不卡住整条队列 */
  } catch (e) { setTimeout(next, 300); }
}

/* 供调用方（game-battle-v2 的 say）验活：现在是否真的有一段在播 / 待播。
   返回 false 表示队列空且无当前段 —— 说明刚才那次 speakAudio 很可能没出得了声。 */
window.__ttsBusy = function(){
  try { return !!(_aBusy || _aCur || (_aQ && _aQ.length)); } catch (e) { return null; }
};

function flushAudio(token){
  if (token !== _aToken || _aBusy) return;
  var it = _aQ.shift();
  if (!it) return;
  _aBusy = true;
  playOne(it.u, token, it.cap);
}

/* 按语种切分：中文按标点+12字；英文按句子边界、按词且不切碎单词（有道对超长串会拒）。
   ★ 2026-09-22 新增「短文本整段一次合成」：单次请求 → 单段 MP3 →
     从根上就不可能再出现「只读出前半句」（"同学们，去操场集合！"以前被按逗号切成两段靠 onended 衔接，
     安卓一旦丢回调，后半句就永久不播）。 */
function splitText(text, lang){
  text = String(text);
  var _en = isEnLang(lang);
  if(_en && text.length <= 160) return [text];
  if(!_en && text.replace(/[\s，。！？；、,.!?;:：]/g, "").length <= 24) return [text];
  if(_en){
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
/* mode='queue'：把这段话排到队尾、不打断已在播的内容（罚站点名 / 得分反馈等绝不能丢的台词）；
   默认 'cut'：清空待播队列并停掉当前段（开场、读题等场景切换）。 */
function speakAudio(text, times, lang, mode){
  text = String(text === undefined || text === null ? "" : text);
  if(!text) return;
  var L = lang || TTS_DEFAULT_LANG;
  var n = times || 1;
  if(mode !== 'queue'){
    _aToken++;
    _aQ = [];
    try { if(_aCur) _aCur.pause(); } catch(e){}
    _aCur = null; _aBusy = false;
  }
  var token = _aToken;
  var segs = splitText(text, L);
  for(var i = 0; i < n; i++){
    for(var j = 0; j < segs.length; j++) _aQ.push({ u: youdaoURL(segs[j], L), cap: estMs(segs[j], L) });
  }
  if(_aQ.length > 8) _aQ = _aQ.slice(_aQ.length - 8);   /* 防止积压太久导致语音严重滞后 */
  flushAudio(token);
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
