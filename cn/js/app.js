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
  { id:"listen",    name:"听音选字",   icon:"🔊", desc:"听读音，选出那个字" },
  { id:"picture",   name:"看图识字",   icon:"👀", desc:"看图片，认出对应的字" },
  { id:"pinyin",    name:"拼音配对",   icon:"🔤", desc:"读拼音，找出汉字" },
  { id:"wordfill",  name:"组词填空",   icon:"📝", desc:"把词语补完整" },
  { id:"eliminate", name:"生字消消乐", icon:"💥", desc:"字和词语配成一对消掉" },
  { id:"stroke",    name:"笔画数练习", icon:"✍️", desc:"数一数这字有几画" },
  { id:"write",     name:"笔顺演示",   icon:"🖌️", desc:"一笔一画看笔顺" },
  { id:"poemfill",  name:"诗句填空",   icon:"📜", desc:"接出古诗的下一句" },
  { id:"poemsort",  name:"连句成诗",   icon:"🧩", desc:"把打乱的诗句排好" },
  { id:"idiom",     name:"成语填空",   icon:"🏮", desc:"补字 / 看义猜成语" },
  { id:"nearfar",   name:"近反义词",   icon:"⚖️", desc:"找出近义词和反义词" },
  { id:"liangci",   name:"量词搭配",   icon:"🥄", desc:"选一个合适的量词" },
  { id:"read",      name:"朗读跟读",   icon:"🎤", desc:"大声读，AI 来打分" },
  { id:"challenge", name:"限时挑战",   icon:"⏱️", desc:"60秒连击，挑战最高分" }
];
var GRADE_ICONS = ["🍎","🌟","📘","🏆","🚀","🎓"];
var state = { view:"home", gi:0, bi:0, ui:0, mode:null };
var settings = JSON.parse(localStorage.getItem("cn_settings") || '{"tts":true,"rate":0.85}');
var progress = JSON.parse(localStorage.getItem("cn_progress") || '{}');

function saveSettings(){ localStorage.setItem("cn_settings", JSON.stringify(settings)); }
function saveProgress(){ localStorage.setItem("cn_progress", JSON.stringify(progress)); }
/* 进度备份 / 恢复 —— 换签名、换手机、重装都能救回星星 */
function progressJSON(){
  return JSON.stringify({ v:1, app:"cn", ts:Date.now(), settings:settings, progress:progress });
}
function exportProgress(){
  var box = document.getElementById("backupBox");
  box.value = progressJSON();
  box.classList.remove("hidden");
  /* ★ 电视上绝对不能 focus 这个文本框：焦点一旦进去纯文本框，遥控器就出不来，
       用户只能杀进程重开（2026-09-20 反馈的第二个问题）。
       TV 下不抢焦点，只在必要时给 select 全选以便文本框自己的复制行为，
       然后把焦点交还给「导出」按钮，由 js/tv.js 的焦点管理接管。 */
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
function totalUnits(){
  var n = 0;
  DATA.grades.forEach(function(g){ g.books.forEach(function(b){ n += b.u.length; }); });
  return n;
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
/* 顶栏右侧的第二个图标按钮：「热更自检」入口。
   以前是 body 上一个 position:fixed 的飘浮圆钮（🛠️），电视上遥控器几乎选不中
   —— 它离主内容太远，几何最近邻算出的分数永远排不到。放进顶栏后与 ⚙️ 同排，
   方向键天然可以走到。手机上外观基本不变（仍是圆形小按钮）。
   传 true 表示「是否显示热更自检入口」；传字符串则作为附加的 onclick。 */
function topbar(title, showBack, extra){
  var extraOnclick = (typeof extra === "string") ? extra : "renderHotDiag()";
  return '<div class="topbar">' +
    (showBack ? '<button class="back" onclick="goBack()">←</button>' : '<div class="spacer"></div>') +
    '<div class="title">' + title + '</div>' +
    '<button class="gear hot" title="热更自检" onclick="' + extraOnclick + '">🛠️</button>' +
    '<button class="gear" title="设置" onclick="openSettings()">⚙️</button>' +
    '</div>';
}
/* 首页在手机上把 🛠️ 藏起来（手机上长按/多次点设置标题也能进自检，界面更干净）；
   电视上必须显示 —— 那里才是遥控器唯一走得通的入口。 */
function homeTopbar(){
  var isTV = !!(window.__isTV || (document.body && document.body.classList.contains("tv")));
  return topbar("语文乐园", false, isTV ? "renderHotDiag()" : "openSettings()");
}
function render(){
  if(state.view === "home") return renderHome();
  if(state.view === "grades") return renderGrades();
  if(state.view === "units") return renderUnits();
  if(state.view === "modes") return renderModes();
}

function renderHome(){
  app.innerHTML =
    homeTopbar() +
    '<div class="hero">' +
      '<div class="mascot">🐼</div>' +
      '<h1>语文乐园</h1>' +
      '<p>识字 · 古诗 · 词语 · 笔顺 ｜ 1–6 年级 · 边玩边学</p>' +
      '<div class="stars-total">🌟 我的星星 <span>' + totalStars() + '</span></div>' +
    '</div>' +
    '<div style="margin-top:24px">' +
      '<button class="btn" onclick="state.view=\'grades\';render()">🚀 开始学习</button>' +
    '</div>' +
    '<div class="foot">共 6 个年级 · ' + totalUnits() + ' 个单元 · ' +
      (((window.GAMES && window.GAMES.length) ? window.GAMES.length : MODES.length)) + ' 种玩法 · 全部解锁</div>';
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
  html += '<div class="sec-title">🌟 我的星星 ' + gradeStars(state.gi) + ' · 全部已解锁</div>';  g.books.forEach(function(b, bi){
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
  var list = (window.GAMES && window.GAMES.length) ? window.GAMES : MODES;   // 注册表为空时回退硬编码清单
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
    '<div class="foot">本单元 ' + u.w.length + ' 个生字 · 共 ' + list.length + ' 种玩法 · 古诗/成语/量词为全年级题库</div>';
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
  /* 玩法注册表：热更下发的新玩法直接 registerGame 就能进首页，不用改这里 */
  var g = (typeof getGame === "function") ? getGame(mode) : null;
  if (g && typeof g.start === "function") { g.start(); return; }
  var legacy = {
    listen: startListen, picture: startPicture, pinyin: startPinyin,
    wordfill: startWordFill, eliminate: startEliminate, stroke: startStroke,
    write: startWrite, poemfill: startPoemFill, poemsort: startPoemSort,
    idiom: startIdiom, nearfar: startNearFar, liangci: startLiangci,
    read: startRead, challenge: startChallenge
  };
  var fn = legacy[mode];
  if(fn) fn();
  else toast("玩法暂未开放");
}

/* ===================== 设置 & 导航 ===================== */
function openSettings(){ $("#settingsModal").classList.remove("hidden"); var b = document.getElementById("backupBox"); if (b) b.classList.add("hidden"); syncSettings(); }
function closeSettings(){ $("#settingsModal").classList.add("hidden"); }
/* 供遥控器返回键 / 原生返回键调用：关掉最上层的弹层（目前只有设置）。
   关掉了返回 true，表示这次返回被弹层消费掉了，不要再退页面；
   没有弹层返回 false，交给后面的逐级返回逻辑。
   遥控器上「设置关不掉、按返回只是退了上一级菜单」就是缺这一步。 */
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
  /* 设置弹层开着 → 这次返回只用来关弹层，不要动背后的页面 */
  if (typeof window.closeTopLayer === "function") {
    try { if (window.closeTopLayer()) return; } catch (e) {}
  }
  /* 玩法自己在跑 → 先让它收尾。
     玩法内部可能有 setInterval（知识圈的答题倒计时就是），光改 state.view 不清计时器，
     几秒后它一渲染就把界面又抢回游戏里 —— 表现为「点了返回进了别的页面，
     过一会儿又自动跳回游戏」。这里把退出权交给玩法自己，它清完再回列表。 */
  if (typeof window.__gameExit === "function") {
    try { if (window.__gameExit()) return; } catch (e) { window.__gameExit = null; }
  }
  if(window.__cnTimer){ clearInterval(window.__cnTimer); window.__cnTimer = null; }
  if(window.__strokeTimer){ clearInterval(window.__strokeTimer); window.__strokeTimer = null; }
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

/* 「升级」入口 + 「热更自检」入口（可热更，不动冻结文件）。
   2.4.1 起自检入口从飘浮圆钮搬进顶栏（电视上遥控器选不中飘浮圆钮，见 topbar 注释）。
   这里保留一个「点标题 3 次」的隐形入口，方便手机上不开 UI 也能进自检。 */
function renderHotDiag(){
  /* 注意：旧版用 !!window.PRAISE 判断「已热更」是假的——PRAISE 是内置全局、永远为真，
     会恒显「已热更」却无任何设备已装包信息。下面改用「本机实际跑的来源 + window.GAMES 真值」，
     一眼看清设备到底在用哪个包、看图识字到底删没删掉。 */
  var localBuild = window.__HOT_BUILD || "";
  var remoteBuild = window.__REMOTE_BUILD || "(未测试)";
  var games = window.GAMES || [];
  var hasBattle = games.some(function (g) { return g.id === "battle"; });
  var hasPicture = games.some(function (g) { return g.id === "picture"; });
  var base = window.HOT_BASE || "(未知)";
  var source = localBuild ? ("热更包（build=" + localBuild + "）") : "内置版（无本地热更包）";

  /* 【显示尺寸实测】电视上没法开控制台，比例出问题时只能靠这行读数判断。
     实现放在共享层 js/tv.js 的 window.tvDiagHtml() —— 三科共用一份，
     免得 cn/math/en 三份自检面板里的诊断代码各自漂移（以前就吃过这亏）。
     非 TV 环境（手机/浏览器）该函数不存在，退回一句说明即可，不影响面板其余部分。 */
  var dim = (typeof window.tvDiagHtml === "function")
    ? window.tvDiagHtml()
    : '(当前不是电视模式，未采集显示参数)';

  app.innerHTML = topbar("热更自检", true) +
    '<div class="result-box" style="text-align:left;font-size:15px;line-height:2">' +
      '本机运行来源：' + source + '<br>' +
      '本地已装 build：' + (localBuild || "(无)") + '<br>' +
      '远程最新 build：' + remoteBuild + '<br>' +
      '看图识字（id=picture）：' + (hasPicture ? '✅ 已在玩法列表（window.GAMES 含 picture）' : '➖ 不在玩法列表（已下线或未生效）') + '<br>' +
      '知识圈玩法：' + (hasBattle ? '✅ 已在玩法列表' : '❌ 未出现') + '<br>' +
      '热更源：<span style="word-break:break-all">' + base + '</span><br>' +
      '连通性：<span id="hotCon">未测试</span><br>' +
      '<span style="color:var(--sub);font-size:13px">判读：本机运行来源=本地已装包；看图识字是否进列表=' +
      'window.GAMES 实际注册结果。两者结合即知设备真实状态，不再被假「已热更」误导。</span>' +
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
/* 旧版那个飘在右下角的 🛠️ 圆钮已移除（电视上遥控器选不中）。
   为兼容「习惯找右下角」的手机用户，这里不放任何 UI，只在设置标题上留隐形入口：
   点标题 3 次进自检。电视走顶栏按钮，不依赖它。 */
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
