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
      '<button class="btn green" onclick="hotForceReload()">⬇️ 立即下载更新</button>' +
    '</div>' +
    '<div id="hotNowMsg" style="text-align:left;font-size:14px;font-weight:800;margin-top:8px;min-height:20px"></div>' +
    '<div style="text-align:left;color:var(--sub);font-size:12px;margin-top:4px">' +
      '电视端请用「立即下载更新」：下载完<b>完全退出 App 再打开</b>才生效。' +
      '自动热更也一直在跑，但它要下完约 4MB，过早关机就会中断。' +
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
/* ★ 2026-09-21 修复「电视端热更永远不成功」：原实现只 reset() 清标记、不下载 */
/* ★ 2026-09-21 从 game-battle-v2.js 搬来 ★
   这段「一键热更」原先被写在知识圈竞赛的玩法文件里 —— 于是必须进过那个玩法，
   window.hotNowCheck 才会注册。没进过的话，自检页点「立即下载更新」只会弹
   『下载器未就绪，请返回游戏列表重进一次后重试』（用户实测就是这个）。
   它跟玩法毫无关系，是宿主级的电视端救命入口，理应待在自检面板所在的 app.js。
   注：块内 T() 已换成 app.js 自带的 esc()（原文件没有 T，搬过来会直接报未定义）。*/
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
  if (t) t.innerHTML = esc(s);
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
  hotSetMsg("⬇️ 正在下载 " + esc(pk.name) + "（剩 " + (_hotPend.length + 1) + " 个）… " +
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
      hotSetMsg("❌ 分包安装失败（" + esc(st) + (msg ? " " + esc(msg) : "") + "），可再点一次重试");
      return;
    }
    if (typeof _origPack === "function") return _origPack.apply(this, arguments);
  };
  window.__onHotProgress = function (done) {
    if (_hotMine && done > 0) { hotSetMsg("⬇️ 已下载 " + (done / 1048576).toFixed(1) + "MB…"); return; }
    if (typeof _origProg === "function") return _origProg.apply(this, arguments);
  };
}

window.hotForceReload = function () {
  try {
    if (!window.AndroidHot) { toast("浏览器预览无法下载"); return; }
    if (typeof window.hotNowCheck === "function") { window.hotNowCheck(); return; }
    toast("下载器未就绪，请返回游戏列表重进一次后重试");
  } catch (e) { toast("操作失败"); }
};
/* 设置标题点 3 次的隐形入口：电视走顶栏 🛠️ 按钮，这个只是手机上的备用通道 */
(function () {
/* ★ 2026-09-21 补回「换学科」入口条 ★
   2.4.2 老壳在首页顶部有一条固定的「当前学科 ｜ 🔄 换学科」
   （见 legacy/js/bridge.js 的 mountSubjectBar，样式在 css/picker.css 的 #subjectBar 段）。
   2.5.0 新壳丢了这条，只剩设置里的入口，用户反馈「切换怎么不和 2.4 一样」。
   这里按同一套 DOM/类名补回来，样式直接复用 picker.css，两代壳外观一致。

   为什么插在 #app 之外：学科 App 的 render() 会重建 #app 的内容，条插在里面会被冲掉；
   插在外面 + position:fixed 就不用每帧跟它抢位置。
   为什么写在各科 app.js 而不是宿主层：boot.js 是冻结文件，HOST_JS 加新文件要出新 APK，
   而这段纯 JS 可以热更下发，立刻生效。 */
/* picker.css 里才有 #subjectBar 的样式，但 2.5.0 新壳默认不加载它
   （只有 legacy 老壳会 add("cssPick", ...)）。不补这一步，条会掉成浏览器默认样式。
   加载方式与 boot.js 的 swapCss 一致：先试热更源，404 回退内置相对路径。 */
function ensurePickerCss() {
  try {
    if (document.getElementById("cssPick")) return;
    var l = document.createElement("link");
    l.rel = "stylesheet";
    l.id = "cssPick";
    l.href = "https://local.hot/css/picker.css";
    l.onerror = function () {
      /* 热更包里没有 → 退回 APK 内置那份（boot.js 同款降级思路） */
      try { l.href = "css/picker.css"; l.onerror = null; } catch (e) {}
    };
    var tvLink = document.getElementById("cssTV");
    if (tvLink && tvLink.parentNode) tvLink.parentNode.insertBefore(l, tvLink);
    else document.head.appendChild(l);
  } catch (e) {}
}
function mountSubjectBar() {
  try {
    ensurePickerCss();
    if (document.getElementById("subjectBar")) return;
    var bar = document.createElement("div");
    bar.id = "subjectBar";
    bar.setAttribute("data-subject-bar", "1");
    bar.innerHTML =
      '<span class="sb-cur">🔤 当前学科：<b>英语</b></span>' +
      '<button class="sb-btn" type="button" onclick="__pickSubjectFromBar()">🔄 换学科</button>';
    var appEl = document.getElementById("app");
    if (appEl && appEl.parentNode) appEl.parentNode.insertBefore(bar, appEl);
    else document.body.insertBefore(bar, document.body.firstChild);
  } catch (e) {}
}
/* 点「换学科」= 清掉学科标记后重载，回到选学科页。
   与 subject.js 里 __setSubject 的写法保持一致（同一把 localStorage 钥匙）。 */
window.__pickSubjectFromBar = function () {
  try { localStorage.setItem("app_subject", ""); } catch (e) {}
  try { location.reload(); } catch (e) {}
};
/* 挂载时机：load 之后 + 延迟两次兜底（别的代码若重建 body 也能补回来，幂等）。 */
if (document.readyState === "complete") mountSubjectBar();
else window.addEventListener("load", function () { setTimeout(mountSubjectBar, 200); });
setTimeout(mountSubjectBar, 1200);

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
