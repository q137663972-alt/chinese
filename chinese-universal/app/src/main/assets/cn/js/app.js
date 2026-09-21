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
var _hotPend = [], _hotBase = "", _hotBuild = "", _hotMine = false, _hotCur = null;
/* ★ 2026-09-21 多源轮询：原先只用 window.HOT_BASE（= cdn.jsdelivr.net），
   大陆网络访问 jsDelivr 时常超时 → 原生 openStream 返回 null →
   面板报「分包安装失败（fail download failed）」（手机版实测）。
   boot.js 的后台更新本来就有多源轮询，手动下载这条线把能力丢了，这里补回来。 */
var _hotBases = [], _hotBaseIdx = 0;
function hotBases() {
  if (_hotBases.length) return _hotBases;
  var list = [];
  try {
    /* boot.js 暴露的完整源列表（jsdelivr 优先、github.io 兜底） */
    if (window.HOT_BASES && window.HOT_BASES.length) {
      for (var i = 0; i < window.HOT_BASES.length; i++) {
        if (window.HOT_BASES[i]) list.push(window.HOT_BASES[i]);
      }
    }
  } catch (e) {}
  if (!list.length && window.HOT_BASE) list.push(window.HOT_BASE);
  _hotBases = list;
  return _hotBases;
}
window.hotNowCheck = function () {
  var H = window.AndroidHot;
  if (!H || typeof H.httpGet !== "function") { hotSetMsg("❌ 本机没有热更桥（浏览器预览模式）"); return; }
  var bs = hotBases();
  if (!bs.length) { hotSetMsg("❌ 取不到热更源地址"); return; }
  _hotBaseIdx = 0;
  hotFetchManifest();
};
/* 取清单：当前源失败就换下一个，全部试完才认输 */
function hotFetchManifest() {
  var bs = hotBases();
  if (_hotBaseIdx >= bs.length) { hotSetMsg("❌ 所有热更源都连不上，请检查网络后重试"); return; }
  _hotBase = bs[_hotBaseIdx];
  var n = _hotBaseIdx + 1;
  hotSetMsg("🔍 正在检查更新…（源 " + n + "/" + bs.length + "）");
  try { window.AndroidHot.httpGet(_hotBase + "pack/manifest.json?t=" + Date.now(), "__hotNowManifest"); }
  catch (e) { _hotBaseIdx++; hotFetchManifest(); }
}
function hotSetMsg(s) {
  var t = document.getElementById("hotNowMsg");
  if (t) t.innerHTML = esc(s);
}
window.__hotNowManifest = function (txt) {
  /* null = 这个源连不上（原生 httpGet 拿到的是 null）→ 换下一个源重试。
     以前这里直接报错，jsDelivr 一抖就整条手动更新失败。 */
  if (txt == null) { _hotBaseIdx++; hotFetchManifest(); return; }
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
  _hotCur = pk;                        /* 记住当前包：失败换源时要重下它 */
  hotSetMsg("⬇️ 正在下载 " + esc(pk.name) + "（剩 " + (_hotPend.length + 1) + " 个）… " +
    Math.round((num(pk.size, 0) / 1048576) * 10) / 10 + "MB" +
    (_hotBaseIdx > 0 ? "（源 " + (_hotBaseIdx + 1) + "/" + hotBases().length + "）" : ""));
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
    /* 理论上到不了这里：hotNowCheck 就在本文件上方同作用域定义。
       真到了说明脚本被截断/加载失败，直接说清楚，别再让用户去「重进一次」——
       那条提示是当初代码放错文件时才有的症状。 */
    toast("热更模块未加载，请退出 App 重开一次");
  } catch (e) { toast("操作失败"); }
};
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
      '<span class="sb-cur">📖 当前学科：<b>语文</b></span>' +
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
