/* ===================== 数据装配 ===================== */
/* 兜底快照：必须在 var GRADES 之前取 —— 下一行会把 window.GRADES 覆盖成空数组 */
var __G0 = (window.GRADES || []).slice();
var GRADES = [];
var DATA = { grades: GRADES };
/* 内容包热更新：远程分片注入后调 setGrades() 重建。
   只原地增删 GRADES，数组引用保持不变，DATA.grades 自动同步。 */
function setGrades(){
  var src = (window.CP && window.CP.list) ? window.CP.list() : __G0;
  GRADES.length = 0;
  Array.prototype.push.apply(GRADES,
    src.slice().sort(function(a, b){ return a.g - b.g; }));
  if (typeof state !== "undefined" && state && state.gi >= GRADES.length){
    state.gi = 0; state.view = "grades";
  }
}
setGrades();

/* ===================== 状态 & 进度 ===================== */
var MODES = [
  { id:"listen",    name:"听音选图",   icon:"🔊", desc:"听发音，选正确的图" },
  { id:"picture",   name:"看图识词",   icon:"👀", desc:"看图片，选正确单词" },
  { id:"spelling",  name:"单词拼写",   icon:"✏️", desc:"听一听，拼出单词" },
  { id:"memory",    name:"翻牌配对",   icon:"🃏", desc:"翻牌记忆，配对图与词" },
  { id:"read",      name:"跟读打分",   icon:"🎤", desc:"跟着读，AI 来打分" },
  { id:"sentence",  name:"连词成句",   icon:"🧩", desc:"把词块排成一句话" },
  { id:"fill",      name:"句型填空",   icon:"📝", desc:"给句型选个合适的词" },
  { id:"dialog",    name:"情景对话",   icon:"💬", desc:"补全对话，开口说" },
  { id:"sound",     name:"听音辨词",   icon:"👂", desc:"近音词辨析，仔细听" },
  { id:"cn2en",     name:"看中文选英文", icon:"🇨🇳", desc:"看中文，选英文单词" },
  { id:"eliminate", name:"单词消消乐", icon:"💥", desc:"图文配对，消掉它们" },
  { id:"sort",      name:"分类归筐",   icon:"🗂️", desc:"把单词放进主题筐" },
  { id:"challenge", name:"限时挑战",   icon:"⏱️", desc:"60秒连击，挑战最高分" }
];
var GRADE_ICONS = ["🍎","🌟","📘","🏆","🚀","🎓"];
var state = { view:"home", gi:0, bi:0, ui:0, mode:null };
var settings = JSON.parse(localStorage.getItem("el_settings") || '{"tts":true,"rate":0.9}');
var progress = JSON.parse(localStorage.getItem("el_progress") || '{}');

function saveSettings(){ localStorage.setItem("el_settings", JSON.stringify(settings)); }
function saveProgress(){ localStorage.setItem("el_progress", JSON.stringify(progress)); }
/* 进度备份 / 恢复 —— 换签名、换手机、重装都能救回星星 */
function progressJSON(){
  return JSON.stringify({ v:1, app:"el", ts:Date.now(), settings:settings, progress:progress });
}
function exportProgress(){
  var box = document.getElementById("backupBox");
  box.value = progressJSON();
  box.classList.remove("hidden");
  /* ★ 电视上绝对不能 focus 这个文本框：焦点一旦进了纯文本框，遥控器就出不来，
       用户只能杀进程重开（2026-09-20 语文侧反馈的第二个问题，这里是同一个坑）。
       TV 下不抢焦点，改为提示一句，焦点继续由共享的 js/tv.js 托管。 */
  var isTV = !!(window.__isTV || (document.body && document.body.classList.contains("tv")));
  if (isTV) {
    toast("已生成备份文本，可用遥控器复制或从手机上获取更多方式");
  } else {
    box.focus(); box.select();
    try { box.setSelectionRange(0, 999999); } catch(e){}
    var ok = false;
    try { ok = document.execCommand("copy"); } catch(e){}
    toast(ok ? "已复制 " + totalStars() + " 颗星的记录，粘贴到备忘录/微信收藏" : "请长按全选框内文本复制");
  }
}
function importProgress(){
  var box = document.getElementById("backupBox");
  box.classList.remove("hidden");
  var txt = (box.value || "").trim();
  if (!txt){ toast("先把备份内容粘进框里，再点恢复"); return; }
  var d;
  try { d = JSON.parse(txt); } catch(e){ toast("格式不对，不是有效的备份"); return; }
  if (!d || !d.progress){ toast("备份里没有进度数据"); return; }
  var n = 0;
  for (var k in d.progress){ if (Object.prototype.hasOwnProperty.call(d.progress, k)){ progress[k] = d.progress[k]; n++; } }
  saveProgress();
  if (d.settings){ settings = d.settings; saveSettings(); }
  toast("已恢复 " + n + " 个单元，共 " + totalStars() + " 颗星");
  if (typeof render === "function") render();
}
function uKey(gi, bi, ui){ return gi + "-" + bi + "-" + ui; }
function getStars(gi, bi, ui){ return progress[uKey(gi, bi, ui)] || 0; }
function setStars(gi, bi, ui, n){
  var k = uKey(gi, bi, ui);
  if((progress[k] || 0) < n){ progress[k] = n; saveProgress(); }
}
/* 全部解锁：不再限制进度，星星仅作为成就反馈 */
function isUnlocked(){ return true; }
function gradeStars(gi){
  var s = 0;
  DATA.grades[gi].books.forEach(function(b, bi){
    b.u.forEach(function(u, ui){ s += getStars(gi, bi, ui); });
  });
  return s;
}
function totalStars(){
  var s = 0;
  DATA.grades.forEach(function(g, gi){
    g.books.forEach(function(b, bi){
      b.u.forEach(function(u, ui){ s += getStars(gi, bi, ui); });
    });
  });
  return s;
}

/* ===================== 工具 ===================== */
function shuffle(a){
  a = a.slice();
  for(var i = a.length - 1; i > 0; i--){
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i]; a[i] = a[j]; a[j] = t;
  }
  return a;
}
function $(s, r){ return (r || document).querySelector(s); }
function $all(s, r){ return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function esc(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function toast(msg){
  var t = $("#toast"); t.textContent = msg; t.classList.add("show");
  setTimeout(function(){ t.classList.remove("show"); }, 1100);
}
function stars(n){ return "⭐".repeat(n) + "☆".repeat(3 - n); }
function curUnit(){ return DATA.grades[state.gi].books[state.bi].u[state.ui]; }

/* ===================== 渲染 ===================== */
var app;
function topbar(title, showBack, extra){
  /* extra：需要把顶栏右侧按钮点成别的行为时传 onclick 字符串，默认就是进热更自检。
     🛠️ 必须排在 ⚙️ 之前 —— 焦点导航按「↑」从内容吸附到顶栏时落在第一个 gear 上，
     也就是这个自检入口，一步就能选中。这是电视上唯一能触发更新的地方。 */
  var extraOnclick = (typeof extra === "string") ? extra : "renderHotDiag()";
  return '<div class="topbar">' +
    (showBack ? '<button class="back" onclick="goBack()">←</button>' : '<div class="spacer"></div>') +
    '<div class="title">' + title + '</div>' +
    '<button class="gear hot" title="热更自检" onclick="' + extraOnclick + '">🛠️</button>' +
    '<button class="gear" title="设置" onclick="openSettings()">⚙️</button>' +
    '</div>';
}
function render(){
  if(state.view === "home") return renderHome();
  if(state.view === "grades") return renderGrades();
  if(state.view === "units") return renderUnits();
  if(state.view === "modes") return renderModes();
}

function renderHome(){
  app.innerHTML =
    topbar("英语乐园", false) +
    '<div class="hero">' +
      '<div class="mascot">🦊</div>' +
      '<h1>英语乐园</h1>' +
      '<p>人教版 · 新起点 1–6 年级 · 边玩边学</p>' +
      '<div class="stars-total">🌟 我的星星 <span>' + totalStars() + '</span></div>' +
    '</div>' +
    '<div style="margin-top:24px">' +
      '<button class="btn" onclick="state.view=\'grades\';render()">🚀 开始学习</button>' +
    '</div>' +
    '<div class="foot">共 6 个年级 · 72 个单元 · 13 种玩法 · 全部解锁</div>';
}
function renderGrades(){
  var cards = DATA.grades.map(function(g, gi){
    return '<div class="grade-card" onclick="enterGrade(' + gi + ')">' +
      '<div class="g-emoji">' + (GRADE_ICONS[gi] || "📗") + '</div>' +
      '<div class="g-name">' + (gi + 1) + ' 年级</div>' +
      '<div class="g-stars">⭐ ' + gradeStars(gi) + '</div>' +
    '</div>';
  }).join("");
  app.innerHTML = topbar("选择年级", true) +
    '<div class="sec-title">🎒 你要学几年级？</div>' +
    '<div class="grade-grid">' + cards + '</div>';
}
function enterGrade(gi){ state.gi = gi; state.view = "units"; render(); }

function renderUnits(){
  var g = DATA.grades[state.gi];
  var html = topbar((state.gi + 1) + " 年级 · 单元", true);
  html += '<div class="sec-title">🌟 我的星星 ' + gradeStars(state.gi) + ' · 全部已解锁</div>';
  g.books.forEach(function(b, bi){
    html += '<div class="book-label">📚 ' + b.n + '</div><div class="unit-grid">';
    b.u.forEach(function(u, ui){
      var st = getStars(state.gi, bi, ui);
      html += '<div class="unit-card" onclick="enterUnit(' + bi + ',' + ui + ')">' +
        '<div class="u-name">' + esc(u.n) + '</div>' +
        '<div class="u-stars">' + stars(st) + '</div>' +
      '</div>';
    });
    html += '</div>';
  });
  app.innerHTML = html;
}
function enterUnit(bi, ui){ state.bi = bi; state.ui = ui; state.view = "modes"; render(); }

function renderModes(){
  var u = curUnit();
  /* 注册表优先：热更下发的新玩法（js/game-*.js 里 registerGame）自动进首页 */
  var list = (window.GAMES && window.GAMES.length) ? window.GAMES : MODES;
  var cards = list.map(function(m){
    return '<div class="mode-card" onclick="startGame(\'' + m.id + '\')">' +
      '<div class="m-icon">' + m.icon + '</div>' +
      '<div class="m-name">' + m.name + '</div>' +
      '<div class="m-desc">' + m.desc + '</div>' +
    '</div>';
  }).join("");
  app.innerHTML = topbar(esc(u.n), true) +
    '<div class="sec-title">🎮 选一种玩法</div>' +
    '<div class="mode-grid">' + cards + '</div>' +
    '<div class="foot">共 ' + u.w.length + ' 个单词 · ' + u.s.length + ' 个句型</div>';
}

/* ===================== 游戏公共外壳 ===================== */
function gameShell(inner, title){
  app.innerHTML = topbar(title, true) + '<div id="gameArea">' + inner + '</div>';
}
function finishGame(correct, total, modeName){
  var acc = total ? Math.round(correct / total * 100) : 0;
  var earned = acc >= 90 ? 3 : acc >= 60 ? 2 : acc > 0 ? 1 : 0;
  setStars(state.gi, state.bi, state.ui, earned);
  var next = nextUnit();
  /* 夸奖语 + 满分特效：praise.js 由热更下发，没加载上时自动退回原来的样子 */
  var P = window.PRAISE;
  var lv = P ? P.level(acc, earned) : "";
  var head = P ? P.block(lv) : '<div style="font-size:46px">' + (earned > 0 ? '🎉' : '💪') + '</div>';
  var starLine = (P && (lv === "perfect" || lv === "great")) ? "" : '<div class="result-stars">' + stars(earned) + '</div>';
  app.innerHTML = topbar("闯关结果", true) +
    '<div class="result-box">' + head + starLine +
      '<div style="font-size:16px;color:var(--sub)">' + modeName + ' · 正确率 ' + acc + '%</div>' +
      '<div style="margin-top:6px;font-weight:700">本单元累计 ⭐ ' + getStars(state.gi, state.bi, state.ui) + '</div>' +
      '<div class="row">' +
        '<button class="btn ghost" onclick="state.view=\'modes\';render()">🔁 再玩</button>' +
        (next
          ? '<button class="btn green" onclick="gotoUnit(' + next.bi + ',' + next.ui + ')">➡️ 下一关</button>'
          : '<button class="btn green" onclick="state.view=\'units\';render()">🏠 单元</button>') +
      '</div>' +
      '<button class="btn pink" style="margin-top:12px" onclick="state.view=\'units\';render()">返回单元列表</button>' +
    '</div>';
  if (P && lv) setTimeout(function(){ P.fx(lv); }, 60);
}
function nextUnit(){
  var g = DATA.grades[state.gi];
  if(state.ui < g.books[state.bi].u.length - 1) return { bi: state.bi, ui: state.ui + 1 };
  if(state.bi < g.books.length - 1) return { bi: state.bi + 1, ui: 0 };
  return null;
}
function gotoUnit(bi, ui){ state.bi = bi; state.ui = ui; state.view = "modes"; render(); }

/* ===================== 玩法分发 ===================== */
function startGame(mode){
  state.mode = mode;
  state.view = "game";
  var map = {
    listen: startListen, picture: startPicture, spelling: startSpelling,
    memory: startMemory, read: startRead, sentence: startSentence,
    fill: startFill, dialog: startDialog, sound: startSound,
    cn2en: startCn2en, eliminate: startEliminate, sort: startSort,
    challenge: startChallenge
  };
  var fn = null, G = window.GAMES || [];
  for (var i = 0; i < G.length; i++) if (G[i].id === mode) { fn = G[i].start; break; }
  if (!fn) fn = map[mode];                       // 注册表里没有 → 回退内置硬编码
  if(fn) fn();
  else toast("玩法暂未开放");
}

/* ===================== 设置 & 导航 ===================== */
function openSettings(){ $("#settingsModal").classList.remove("hidden"); var b = document.getElementById("backupBox"); if (b) b.classList.add("hidden"); syncSettings(); }
function closeSettings(){ $("#settingsModal").classList.add("hidden"); }
/* 供遥控器返回键 / 原生返回键调用：关掉最上层的弹层（目前只有设置）。
   关掉了返回 true（这次返回被弹层消费掉，不要再退页面），没有弹层返回 false。
   共享的 js/tv.js 里 doBack() 第一步就找它 —— 哪一科没有它，
   那个学科的电视版就会重现「设置关不掉、按返回只退菜单」。 */
function closeTopLayer(){
  var m = document.getElementById("settingsModal");
  if (m && !m.classList.contains("hidden")) { closeSettings(); return true; }
  return false;
}
window.closeTopLayer = closeTopLayer;
function syncSettings(){
  $("#ttsSwitch").classList.toggle("on", settings.tts);
  $("#rateRange").value = settings.rate;
}
function goBack(){
  /* ① 设置弹层开着 → 这次返回只用来关弹层，别动背后的页面 */
  if (typeof window.closeTopLayer === "function") {
    try { if (window.closeTopLayer()) return; } catch (e) {}
  }
  /* ② 玩法自己在跑 → 让它先收尾（清计时器、停朗读） */
  if (typeof window.__gameExit === "function") {
    try { if (window.__gameExit()) return; } catch (e) { window.__gameExit = null; }
  }
  /* ③ 兜底：英语的限时挑战把 id 挂在 window.__enTimer 上，这里必须掐掉 ——
        不清的话退出后每秒还在 tick，一秒就把界面抢回游戏里。 */
  if(window.__enTimer){ clearInterval(window.__enTimer); window.__enTimer = null; }
  if(state.view === "grades"){ state.view = "home"; render(); }
  else if(state.view === "units"){ state.view = "grades"; render(); }
  else if(state.view === "modes"){ state.view = "units"; render(); }
  else if(state.view === "game" || state.mode){ state.view = "modes"; render(); }
  else render();
}
/* 供安卓壳返回键调用：在首页返回 false（退出应用），否则逐级回退并返回 true */
function tvBack(){
  if(state.view === "home") return false;
  goBack();
  return true;
}
window.tvBack = tvBack;

/* ===================== 热更自检 =====================
   电视上没有控制台，热更到底生效没生效、本机跑的是哪个包，
   只能靠一个肉眼能看到的面板 —— 而且必须能用遥控器点到。
   2.4.1 起入口从右下角飘浮圆钮搬进顶栏（遥控器选不中飘浮圆钮），
   这里另留一个「点设置标题 3 次」的隐形入口，方便手机上也进得来。 */
function renderHotDiag(){
  /* 旧版拿 !!window.PRAISE 判断「已热更」是假的 —— PRAISE 是内置全局、恒为真，
     结果永远显示「已热更」却拿不出任何本机信息。改成看实际来源 + 真玩法列表。 */
  var localBuild = window.__HOT_BUILD || "";
  var remoteBuild = window.__REMOTE_BUILD || "(未测试)";
  var games = window.GAMES || [];
  var ids = games.map(function (g) { return g.id; });
  var base = window.HOT_BASE || "(未知)";
  var source = localBuild ? ("热更包（build=" + localBuild + "）") : "内置版（无本地热更包）";
  /* 【显示尺寸实测】电视上没有控制台，比例出问题时只能靠这行读数判断。
     实现放在共享层 js/tv.js 的 window.tvDiagHtml()，三科共用一份，避免三份漂移。 */
  var dim = (typeof window.tvDiagHtml === "function")
    ? window.tvDiagHtml()
    : '(当前不是电视模式，未采集显示参数)';

  app.innerHTML = topbar("热更自检", true) +
    '<div class="result-box" style="text-align:left;font-size:15px;line-height:2">' +
      '本机运行来源：' + source + '<br>' +
      '本地已装 build：' + (localBuild || "(无)") + '<br>' +
      '远程最新 build：' + remoteBuild + '<br>' +
      '玩法列表（window.GAMES 实际注册）：' + (ids.length ? ids.join("、") : "（空）") + '<br>' +
      '玩法总数：' + ids.length + '<br>' +
      '热更源：<span style="word-break:break-all">' + base + '</span><br>' +
      '连通性：<span id="hotCon">未测试</span><br>' +
      '<span style="color:var(--sub);font-size:13px">判读：本机运行来源=代码实际来自内置还是已装热更包；' +
      '玩法列表=这次热更真正注册进来的玩法。新增玩法要在这里出现才算生效。</span>' +
    '</div>' +
    '<div class="result-box" style="text-align:left;font-size:15px;line-height:2;margin-top:12px">' +
      '<b>📐 显示尺寸实测</b><br>' + dim +
      '<span style="color:var(--sub);font-size:13px">比例不对时看「容器实测宽」与「横向溢出」两行：' +
      '溢出为正说明页面比屏幕宽、两侧被裁。修显示参数只改 js/tv-tune.js 与 css/tv.css，' +
      '两者都能热更，不用装包。</span>' +
    '</div>' +
    '<div class="row" style="margin-top:12px">' +
      '<button class="btn ghost" onclick="hotTestConn()">🔌 测试连通</button>' +
      '<button class="btn green" onclick="hotForceReload()">🔄 强制重新下载</button>' +
    '</div>' +
    '<button class="btn pink" style="margin-top:10px" onclick="state.view=\'home\';render()">返回</button>';
}
window.hotTestConn = function () {
  var el = document.getElementById("hotCon");
  if (el) el.textContent = "测试中…";
  try {
    if (!window.AndroidHot) { if (el) el.textContent = "❌ 浏览器预览无原生桥"; return; }
    var url = (window.HOT_BASE || "") + "pack/manifest.json?t=" + Date.now();
    window.AndroidHot.httpGet(url, "__hotDiag");
  } catch (e) { if (el) el.textContent = "❌ 调用失败"; }
};
window.__hotDiag = function (txt) {
  var el = document.getElementById("hotCon");
  if (!el) return;
  if (txt == null) { el.textContent = "❌ 拉取失败（手机够不到该地址）"; return; }
  try {
    var m = JSON.parse(txt);
    window.__REMOTE_BUILD = m.build || "?";
    el.textContent = "✅ 可达，线上 build=" + (m.build || "?");
  } catch (e) { el.textContent = "⚠️ 返回了非预期内容"; }
};
window.hotForceReload = function () {
  try {
    if (!window.AndroidHot) { toast("浏览器预览无法下载"); return; }
    window.AndroidHot.reset();
    toast("已清除本地标记，请关闭 App 再重新打开以拉取内容");
  } catch (e) { toast("操作失败"); }
};
/* 设置标题点 3 次的隐形入口：电视走顶栏 🛠️ 按钮，这个只是手机上的备用通道 */
(function () {
  var taps = 0, last = 0;
  function hook() {
    var h = document.querySelector("#settingsModal .modal-card h3");
    if (!h || h.__diagHooked) return;
    h.__diagHooked = true;
    h.addEventListener("click", function () {
      var now = Date.now();
      if (now - last > 900) taps = 0;
      last = now; taps++;
      if (taps >= 3) { taps = 0; try { closeSettings(); renderHotDiag(); } catch (e) {} }
    });
  }
  try {
    document.addEventListener("click", function (e) {
      var t = e.target;
      if (t && t.classList && t.classList.contains("gear") && t.title === "设置") setTimeout(hook, 60);
    }, true);
    window.addEventListener("load", function () { setTimeout(hook, 300); });
  } catch (e) {}
})();

/* ===================== 启动 ===================== */
app = $("#app");
$("#ttsSwitch").addEventListener("click", function(){
  settings.tts = !settings.tts; saveSettings();
  $("#ttsSwitch").classList.toggle("on", settings.tts);
});
$("#rateRange").addEventListener("input", function(e){
  settings.rate = parseFloat(e.target.value); saveSettings();
});
render();
