/* ═══════════ 玩法注册表 ═══════════
 * 新增玩法不用改 app.js、也不用出 APK：
 *   1. 在你的 js 文件里 registerGame({id, name, icon, desc, start})
 *   2. 把文件名写进资源包 MANIFEST.json 的 games 数组
 * 首页会自动多出一个入口。同 id 重复注册 = 覆盖，方便热更单独升级某个玩法。
 * 单个玩法文件加载失败时，boot.js 会跳过它 —— 只掉一个入口，不会白屏。 */
window.GAMES = window.GAMES || [];
window.registerGame = function (g) {
  if (!g || !g.id) return null;
  for (var i = 0; i < window.GAMES.length; i++) {
    if (window.GAMES[i].id === g.id) { window.GAMES[i] = g; return g; }
  }
  window.GAMES.push(g);
  return g;
};
window.getGame = function (id) {
  for (var i = 0; i < window.GAMES.length; i++) {
    if (window.GAMES[i].id === id) return window.GAMES[i];
  }
  return null;
};

/* 内置 14 种玩法（都是函数声明，会提升，所以写在定义之前也没问题） */
registerGame({ id:"listen",    name:"听音选字",   icon:"🔊", desc:"听读音，选出那个字",   start: startListen });
registerGame({ id:"picture",   name:"看图识字",   icon:"👀", desc:"看图片，认出对应的字", start: startPicture });
registerGame({ id:"pinyin",    name:"拼音配对",   icon:"🔤", desc:"读拼音，找出汉字",     start: startPinyin });
registerGame({ id:"wordfill",  name:"组词填空",   icon:"📝", desc:"把词语补完整",         start: startWordFill });
registerGame({ id:"eliminate", name:"生字消消乐", icon:"💥", desc:"字和词语配成一对消掉", start: startEliminate });
registerGame({ id:"stroke",    name:"笔画数练习", icon:"✍️", desc:"数一数这字有几画",     start: startStroke });
registerGame({ id:"write",     name:"笔顺演示",   icon:"🖌️", desc:"一笔一画看笔顺",       start: startWrite });
registerGame({ id:"poemfill",  name:"诗句填空",   icon:"📜", desc:"接出古诗的下一句",     start: startPoemFill });
registerGame({ id:"poemsort",  name:"连句成诗",   icon:"🧩", desc:"把打乱的诗句排好",     start: startPoemSort });
registerGame({ id:"idiom",     name:"成语填空",   icon:"🏮", desc:"补字 / 看义猜成语",    start: startIdiom });
registerGame({ id:"nearfar",   name:"近反义词",   icon:"⚖️", desc:"找出近义词和反义词",   start: startNearFar });
registerGame({ id:"liangci",   name:"量词搭配",   icon:"🥄", desc:"选一个合适的量词",     start: startLiangci });
registerGame({ id:"read",      name:"朗读跟读",   icon:"🎤", desc:"大声读，AI 来打分",    start: startRead });
registerGame({ id:"challenge", name:"限时挑战",   icon:"⏱️", desc:"60秒连击，挑战最高分", start: startChallenge });

/* ===================== 出题工具 ===================== */
function buildRounds(u, n){
  var pool = u.w;
  var list = shuffle(pool).slice(0, Math.min(n, pool.length));
  return list.map(function(c){ return { correct: c }; });
}
/* 同单元其它生字作干扰项
   homo: "same" 排除与正确答案完全同音同调的字；"toneless" 排除同音（不论声调）的字 */
function zDistractors(u, correct, n, homo){
  var cp = correct.p, cs = stripTone(correct.p);
  var others = u.w.filter(function(w){
    if(w.z === correct.z) return false;
    if(homo === "same" && w.p === cp) return false;
    if(homo === "toneless" && stripTone(w.p) === cs) return false;
    return true;
  });
  var pick = shuffle(others).slice(0, n - 1);
  return shuffle([correct].concat(pick));
}
/* 全册随机字作干扰（单元字数不足时用） */
function zDistractorsAll(u, correct, n, homo){
  var all = [];
  DATA.grades[state.gi].books.forEach(function(b){ b.u.forEach(function(un){ all = all.concat(un.w); }); });
  var cp = correct.p, cs = stripTone(correct.p);
  var others = all.filter(function(w){
    if(w.z === correct.z) return false;
    if(homo === "same" && w.p === cp) return false;
    if(homo === "toneless" && stripTone(w.p) === cs) return false;
    return true;
  });
  var pick = shuffle(others).slice(0, n - 1);
  return shuffle([correct].concat(pick));
}
function optsOf(u, correct, n, homo){
  var r = homo ? zDistractors(u, correct, n, homo) : [];
  if(r.length < n) r = zDistractors(u, correct, n, homo);
  if(r.length < n) r = zDistractorsAll(u, correct, n, homo);
  if(r.length < n && homo) r = zDistractorsAll(u, correct, n, null);
  return r;
}
/* ═══ 易混字组 ═══
   看图识字题干是图、选项是字。两个意思相近的字摆在同一道题里，
   图做得再像孩子也分不清（典型：你/我/他/人、天/日）。
   规则：同组字永不同时出现在一道看图题里；且作为「正确答案」时降频。 */
var CONFUSE_GROUPS = [
  ["你","我","他","人"],
  /* 天空/天象族：识字课天生就爱把这些字放一课（一上·天地自然：天地人你我他日月星云山水），
     配图又全是天空、太阳、云、雨 —— 两个摆进同一题，孩子只能靠猜。
     2026-09-19 补：原来只有「天-日」「月-星」「云-雾」「风-雨」「雷-电」这种两两小对，
     交叉组合全漏（天-云、天-月、日-星、雷-雨 都判不出），实测一上·天地自然 里
     正确=天 时干扰项频次 云856/星717/月701 —— 全是天空图。整族两两互斥。 */
  ["天","云","日","月","星","雷","雨","电","风","光"],
  /* 数字族：这些字的配图全是气球/小圆点，只能靠「数几个」来区分，
     而一年级孩子数都还数不利索 —— 一和七摆一题等于送分或送命。
     2026-09-19 confuse-lint 查出：数字单元里 36 对是同单元就会同题，和天空族同一类 bug。 */
  ["一","二","三","四","五","六","七","八","九","十"],
  /* 下面几族同样是 confuse-lint 查出来的同单元漏配（配图撞车：色块/树/水/日出/房舍） */
  ["白","黑"], ["树","林","森","松","柏","杨","柳","竹"], ["水","江","河","湖","海","洋"],
  ["日","早","晨","明","晴"], ["午","时"], ["家","房","院"],
  ["天","日"], ["月","星"], ["云","雾"],
  ["风","雨"], ["雷","电"], ["木","禾"], ["石","岩"],
  ["口","舌"], ["耳","目"], ["手","足"], ["头","背"],
  ["鸡","鸭"], ["牛","羊"], ["猫","虎"], ["马","鹿"],
  ["上","下"],
  ["爸","爷","哥"], ["妈","奶","姐"], ["弟","妹"], ["家","房"],
  ["书","本"], ["笔","纸"], ["读","写"], ["学","课"],
  ["春","夏","秋","冬"], ["花","草"], ["树","叶"], ["雪","冰"], ["热","冷"], ["霜","露"], ["霞","虹"], ["晨","昏"], ["晴","阴"], ["暗","影"],
  ["江","河","湖","海","波","浪"], ["泉","溪"], ["岛","岸","滩"], ["沙","滩"], ["潮","汐"],
  ["桃","梨","杏"], ["瓜","果"], ["米","面"], ["茶","糖"], ["菜","豆"],
  ["跑","跳","走"], ["看","听"], ["说","唱"], ["笑","哭"], ["洗","扫","擦"], ["吃","喝"], ["种","收"], ["找","送"],
  ["长","短"], ["高","矮"], ["圆","方"], ["红","黄","蓝","绿"],
  ["年","月","日"], ["时","分","秒"], ["早","午","晚"], ["今","明","昨"],
  ["门","窗"], ["桌","椅"], ["床","灯"], ["街","桥"], ["院","城"],
  ["喜","乐"], ["怒","哀"], ["怕","急"], ["静","忙"], ["暖","甜","美"],
  ["狐","狸"], ["鹰","雀"], ["蚕","蜂"], ["蛇","龙"],
  ["岭","峰","崖"], ["森","林"], ["谷","原","野"], ["潭","瀑"],
  ["柳","杨","竹"], ["松","柏"], ["荷","莲","菊"], ["梅","兰"], ["草","芽"],
  ["观","察"], ["研","究"], ["试","验"], ["探","索"], ["寻","秘"], ["秘","密"],
  ["寓","言"], ["规","矩"], ["道","理"], ["劝","告"], ["警","示"], ["教","训"],
  ["粽","饼"], ["舟","龙"], ["灯","宵"],
  ["关","怀"], ["助","帮"], ["善","良"], ["慈","悲"], ["怜","惜"], ["尊","敬"],
  ["崩","裂"], ["涨","沸"], ["腾","涌"], ["吼","震","撼"],
  ["均","匀"], ["叠","隙"], ["茎","柄"], ["固","牢"], ["逐","渐"],
  ["宫","殿"], ["皇","冠"], ["巫","魔","仙"], ["幸","福"],
  ["性","格"], ["贪","脾"], ["乖","巧"], ["傲","慢"],
  ["棚","架"], ["檐","篱","笆"], ["蔬","畜","禽"], ["桑","麻"], ["织","锄"],
  ["箭","舱"], ["宇","宙"], ["测","控"], ["讯","码"], ["网","芯"],
  ["诺","誓"], ["诚","信"], ["欺","骗"], ["谎","悔"], ["错","责"], ["改","约"],
  ["阁","楼","亭","台","廊","塔","寺","庙","榭"], ["碑","雕"], ["窟","洞"],
  ["籍","卷"], ["诵","阅"], ["博","雅"], ["典","奥"], ["慧","智"], ["妙","贤"],
  ["列","举","例"], ["比","较"], ["数","据"], ["图","表"], ["简","准","确"],
  ["郎","梭"], ["筐","缘"], ["媒","聘"], ["嫁","娶"], ["鹊","桥"], ["银","汉"],
  ["旗","徽"], ["疆","域"], ["英","烈"], ["捐","报"], ["愿","严"],
  ["趣","逗"], ["耍","闹"], ["惹","祸"], ["闯","荡"], ["蹦","窜"], ["瞒","偷"],
  ["曹","操"], ["备","羽"], ["亮","瑜"], ["谋","略"], ["计","策"], ["疑","忌"],
  ["描","绘"], ["刻","画"], ["神","态"], ["举","止"], ["貌","韵"], ["眸","唇"],
  ["洲","湾","屿","礁"], ["港","舶","艇","帆"], ["漠","驼"], ["洋","际"],
  ["滋","润"], ["孕","育"], ["繁","衍"], ["枯","萎","凋"], ["萌","茂"],
  ["帜","号"], ["征","途"], ["艰","险"], ["牺","牲"], ["雄","魂"], ["魄","魂"],
  ["桑","娜"], ["渔","魁"], ["遭","遇"], ["煎","熬"], ["忧","虑"],
  ["咏","吟"], ["赋","序"], ["跋","铭","箴"], ["哉","乎","矣","焉","兮"],
  ["饺","粥","蒜"], ["锣","鼓"], ["鞭","炮"], ["摊","贩"], ["货","联","幅"],
  ["鲁","滨","逊"], ["漂","筏"], ["荒","蛮"], ["峻","搏"], ["帐","篷"],
  ["挚","眷"], ["恋","惦"], ["聊","慰"], ["绪","牵"], ["挂","思"], ["藉","深"],
  ["毕","赠"], ["留","珍"], ["展","望"], ["未","程"], ["锦","棒"], ["迈","翔"]
];
/* 字 → 所属组号列表 */
var CONFUSE_MAP = (function(){
  var m = {};
  CONFUSE_GROUPS.forEach(function(g, i){
    g.forEach(function(z){ (m[z] = m[z] || []).push(i); });
  });
  return m;
})();
/* 抽象字：图只能表达情境（爱=妈妈抱孩子、静=图书馆看书…），辨识度天然低，
   出题时与易混字同样降频，避免总抽到模糊题 */
var ABSTRACT = "你我爱静美跑说哭读写冷热震魔骗助均牢控举止红黄绿白黑方圆".split("");
/* 两个字是否同属某个易混组 */
function confuseWith(a, b){
  var A = CONFUSE_MAP[a], B = CONFUSE_MAP[b];
  if(!A || !B) return false;
  for(var i = 0; i < A.length; i++){ if(B.indexOf(A[i]) >= 0) return true; }
  return false;
}
/* 看图识字抽题：易混字 / 抽象字降频（权重 0.35），其余按 1 */
function buildRoundsPic(u, n){
  var pool = (u.w || []).slice(), rest = pool.slice(), picked = [];
  var want = Math.min(n, pool.length);
  while(picked.length < want && rest.length){
    var wts = [], total = 0, i;
    for(i = 0; i < rest.length; i++){
      var w = (CONFUSE_MAP[rest[i].z] || ABSTRACT.indexOf(rest[i].z) >= 0) ? 0.35 : 1;
      wts.push(w); total += w;
    }
    var r = Math.random() * total, idx = rest.length - 1;
    for(i = 0; i < wts.length; i++){ r -= wts[i]; if(r <= 0){ idx = i; break; } }
    picked.push(rest[idx]); rest.splice(idx, 1);
  }
  return picked.map(function(c){ return { correct: c }; });
}
/* 单次加权抽字（挑战模式看图选字用） */
function pickPicChar(u){
  var r = buildRoundsPic(u, 1);
  return (r[0] && r[0].correct) || u.w[Math.floor(Math.random() * u.w.length)];
}
/* 看图类题目专用干扰项（看图识字 / 挑战·看图选字）
   题干显示的是 PICS[正确字] 这张图，选项是汉字文本。
   只要选项里存在「与正确答案共用同一张图」的字，孩子眼里就是两个都对的答案 —— 题无解。
   历史 bug：一上·天地自然 天=日、人=你=我=他 四字共用一张图。
   这里强制把同图的字排除掉；同单元不够就向同年级其它单元借（借来的同样过同图过滤）。 */
function picDistractors(u, correct, n){
  var P = window.PICS || {};
  var svg = P[correct.z] || null;
  var chosen = [correct];
  function dup(w){ return chosen.some(function(c){ return c.z === w.z; }); }
  /* 严格：与「已选全部」都不同图、不同易混组 —— 任意两项之间都不会互相干扰 */
  function okStrict(w){
    if(!w || dup(w)) return false;
    if(svg && P[w.z] === svg) return false;
    for(var i = 0; i < chosen.length; i++){
      if(confuseWith(chosen[i].z, w.z)) return false;
      if(P[chosen[i].z] && P[chosen[i].z] === P[w.z]) return false;
    }
    return true;
  }
  /* 宽松：只保证与正确答案不撞（严格模式凑不满时降级用） */
  function okLoose(w){
    if(!w || dup(w)) return false;
    if(svg && P[w.z] === svg) return false;
    return !confuseWith(correct.z, w.z);
  }
  function okAny(w){ return !!w && !dup(w); }
  function fill(list, ok){
    shuffle(list || []).forEach(function(w){ if(chosen.length < n && ok(w)) chosen.push(w); });
  }
  function gradeAll(){
    var all = [];
    (DATA && DATA.grades && DATA.grades[state.gi] ? DATA.grades[state.gi].books : []).forEach(function(b){
      (b.u || []).forEach(function(un){ all = all.concat(un.w || []); });
    });
    return all;
  }
  fill(u.w, okStrict);            /* 一级：同单元 + 两两互斥 */
  if(chosen.length < n) fill(gradeAll(), okStrict);  /* 二级：同年级跨单元 + 两两互斥 */
  if(chosen.length < n) fill(u.w, okLoose);          /* 三级：放宽到只与正确项互斥 */
  if(chosen.length < n) fill(gradeAll(), okLoose);
  if(chosen.length < n) fill(gradeAll(), okAny);     /* 兜底：只保证选项够数 */
  return shuffle(chosen);
}
/* 本单元里是否存在与 w 同音（不论声调）的其它字 */
function hasHomophone(u, w){
  var s = stripTone(w.p);
  return u.w.some(function(x){ return x.z !== w.z && stripTone(x.p) === s; });
}
/* 本单元里是否存在与 w 完全同音同调的其它字 */
function hasSameSound(u, w){
  return u.w.some(function(x){ return x.z !== w.z && x.p === w.p; });
}
/* 按年级取素材：本年级及以前 */
function poolByGrade(arr){
  var g = state.gi + 1;
  var r = arr.filter(function(x){ return (x.g || 1) <= g; });
  return r.length ? r : arr.slice();
}
/* 拼音去声调 */
var TONE_MAP = {"ā":"a","á":"a","ǎ":"a","à":"a","ē":"e","é":"e","ě":"e","è":"e",
  "ī":"i","í":"i","ǐ":"i","ì":"i","ō":"o","ó":"o","ǒ":"o","ò":"o",
  "ū":"u","ú":"u","ǔ":"u","ù":"u","ǖ":"v","ǘ":"v","ǚ":"v","ǜ":"v","ü":"v","ń":"n","ň":"n","ǹ":"n","ḿ":"m"};
function stripTone(s){
  return String(s).replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜüńňǹḿ]/g, function(c){ return TONE_MAP[c] || c; });
}
function bindReplay(text){ window.replayCurrent = function(){ speak(text); }; }
function head( Cur, total, replay ){
  return '<div class="game-head"><div class="progress-pill">' + Cur + '/' + total + '</div>' +
    (replay ? '<button class="replay" onclick="replayCurrent()">🔊</button>' : '<div class="spacer"></div>') + '</div>';
}

/* 看图素材：优先「课本插画真图」window.PIC_PHOTOS[z]（webp 文件名），
 * 取不到就回退手绘 SVG 图库 window.PICS[z]（567 字全覆盖），
 * 都缺失时回退纯大字卡（防御用，正常不会触发）。
 *
 * 图片来源按顺序试（window.PIC_BASES）：
 *   1. https://local.hot/img/   资源包热更下来的图（最新，优先级最高）
 *   2. img/                     APK 内置 assets / 仓库自带 —— 没装资源包也能离线看到图
 *   3. 远程 CDN                 最后兜底
 * 顺序很重要：内置图必须排在资源包之后，否则热更下来的新图会被内置旧图盖住；
 * 但也要排在 CDN 之前，否则首次安装又没网时一项都拿不到，只能退回 SVG。
 * 任何一个都取不到 → __picErr 换下一个 → 全挂了就地换回 SVG，绝不出现破图。 */
window.PIC_BASES = window.PIC_BASES || [
  "https://local.hot/img/",
  "img/",
  "https://q137663972-alt.github.io/chinese/img/"
];
window.__picErr = function (img) {
  var z = img.getAttribute("data-z") || "";
  var bases = window.PIC_BASES || ["img/"];
  var i = (parseInt(img.getAttribute("data-bi"), 10) || 0) + 1;
  var f = window.PIC_PHOTOS && window.PIC_PHOTOS[z];
  if (f && i < bases.length) {            // 换下一个源再试
    img.setAttribute("data-bi", String(i));
    img.src = bases[i] + f;
    return;
  }
  var svg = (window.PICS || {})[z];       // 全挂了 → 换回原来的 SVG，游戏照常能玩
  if (svg && img.parentNode) img.parentNode.innerHTML = svg;
  else img.style.visibility = "hidden";
};
/* 只返回外层 .big-pic 的【内层】内容 —— 外层 div 由各调用点自己包。
   旧版这里自己包了一层 div.big-pic，调用点又包一层，套两层导致
   尺寸/阴影叠加不一致（同一道题，图片加载成功和失败渲染尺寸还不一样）。 */
function picHTML(z){
  var ph = window.PIC_PHOTOS && window.PIC_PHOTOS[z];
  if(ph){
    return '<img src="' + (window.PIC_BASES || ["https://local.hot/img/"])[0] + ph +
           '" data-z="' + z + '" data-bi="0" alt="' + z +
           '" onerror="window.__picErr&&window.__picErr(this)">';
  }
  var svg = window.PICS && window.PICS[z];
  if(svg) return svg;
  return '<span class="pic-char">' + z + '</span>';
}

function optZi(list, fn){
  return '<div class="options">' + list.map(function(o, i){
    return '<div class="opt opt-zi" onclick="' + fn + '(' + i + ')">' + esc(o.z || o) + '</div>';
  }).join("") + '</div>';
}

/* ===================== 1. 听音选字 ===================== */
function startListen(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur]; var opts = optsOf(u, r.correct, 4, "same");
    bindReplay(r.correct.z);
    gameShell(
      head(cur + 1, rounds.length, true) +
      '<div class="big-emoji">🔊</div>' +
      '<div class="prompt">听一听，选出听到的字</div>' +
      optZi(opts, "answerListen") +
      '<div class="feedback" id="fb"></div>', "听音选字");
    setTimeout(function(){ speak(r.correct.z); }, 350);
    window.answerListen = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var chosen = opts[i]; speak(chosen.z);
      var fb = $("#fb");
      if(chosen.z === r.correct.z){ el.classList.add("correct"); correct++; fb.textContent = "✅ 答对啦！" + r.correct.p; fb.className = "feedback ok"; }
      else{
        el.classList.add("wrong"); fb.textContent = "❌ 是「" + r.correct.z + "」" + r.correct.p; fb.className = "feedback no";
        speak(r.correct.z);          /* 答错也要把正确的字念出来 */
        $all(".opt").forEach(function(o, j){ if(opts[j].z === r.correct.z) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "听音选字");
      }, 1800);
    };
  }
  renderRound();
}

/* ===================== 2. 看图识字 ===================== */
function startPicture(){
  var u = curUnit();
  var rounds = buildRoundsPic(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur]; var opts = picDistractors(u, r.correct, 4);
    bindReplay(r.correct.z);
    gameShell(
      head(cur + 1, rounds.length, true) +
      '<div class="big-pic">' + picHTML(r.correct.z) + '</div>' +
      '<div class="prompt">看图，选出对应的字</div>' +
      optZi(opts, "answerPicture") +
      '<div class="feedback" id="fb"></div>', "看图识字");
    window.answerPicture = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var chosen = opts[i]; speak(chosen.z);
      var fb = $("#fb");
      if(chosen.z === r.correct.z){
        el.classList.add("correct"); correct++;
        fb.textContent = "✅ " + r.correct.p + " · " + r.correct.w.join("/"); fb.className = "feedback ok";
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「" + r.correct.z + "」" + r.correct.p; fb.className = "feedback no";
        speak(r.correct.z);
        $all(".opt").forEach(function(o, j){ if(opts[j].z === r.correct.z) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "看图识字");
      }, 1800);
    };
  }
  renderRound();
}

/* ===================== 3. 拼音配对 ===================== */
function startPinyin(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur];
    /* 本单元有同音字时：必须显示声调，并排除同音干扰项，避免出现两个"都对"的答案 */
    var homo = hasHomophone(u, r.correct), same = hasSameSound(u, r.correct);
    var opts = optsOf(u, r.correct, 4, same ? "same" : (homo ? "toneless" : null));
    var showTone = !homo && Math.random() < 0.5;
    var py = showTone ? r.correct.p : stripTone(r.correct.p);
    bindReplay(r.correct.z);
    gameShell(
      head(cur + 1, rounds.length, true) +
      '<div class="big-word pinyin-big">' + esc(py) + '</div>' +
      '<div class="prompt">读拼音，选出对应的字</div>' +
      optZi(opts, "answerPinyin") +
      '<div class="feedback" id="fb"></div>', "拼音配对");
    setTimeout(function(){ speak(r.correct.z); }, 300);
    window.answerPinyin = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var chosen = opts[i]; speak(chosen.z);
      var fb = $("#fb");
      if(chosen.z === r.correct.z){ el.classList.add("correct"); correct++; fb.textContent = "✅ 对啦！" + r.correct.w.join("/"); fb.className = "feedback ok"; }
      else{
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「" + r.correct.z + "」"; fb.className = "feedback no";
        speak(r.correct.z);          /* 题干是拼音 → 必须把那个字念出来 */
        $all(".opt").forEach(function(o, j){ if(opts[j].z === r.correct.z) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "拼音配对");
      }, 1800);
    };
  }
  renderRound();
}

/* ===================== 4. 生字消消乐 ===================== */
function startEliminate(){
  var u = curUnit();
  /* 逐个挑字，并为它挑一个「本轮没被别人用过」的词语，
     否则会出现「观/察」都配「观察」这种两个一样的词块 */
  var cand = shuffle(u.w);
  var words = [], usedCi = {};
  for(var i = 0; i < cand.length && words.length < 6; i++){
    var w = cand[i], ci = null;
    for(var j = 0; j < w.w.length; j++){
      var c = w.w[j];
      if(c && c.indexOf(w.z) >= 0 && c.length >= 2 && !usedCi[c]){ ci = c; break; }
    }
    if(!ci) continue;
    usedCi[ci] = 1;
    words.push({ w: w, ci: ci });
  }
  if(words.length < 2){ toast("本单元暂无可配对的词语"); return; }
  var cells = [];
  words.forEach(function(it, idx){
    cells.push({ type: "zi", word: it.w, ci: it.ci, key: idx, gone: false });
    cells.push({ type: "ci", word: it.w, ci: it.ci, key: idx, gone: false });
  });
  cells = shuffle(cells);
  var sel = -1, matched = 0, lock = false;
  function draw(){
    gameShell(
      head("已消 " + matched, words.length, true) +
        '<div class="prompt">点「字」和它的「词语」，配成一对消掉</div>' +
      '<div class="xgrid" id="xg">' + cells.map(function(c, i){
        return '<div class="xcell ' + (c.gone ? "gone " : "") + (sel === i ? "sel " : "") + '" onclick="tapCell(' + i + ')">' +
          (c.type === "zi"
            ? '<div class="cx zi">' + esc(c.word.z) + '</div>'
            : '<div class="cx ci">' + esc(c.ci) + '</div>') +
        '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "生字消消乐");
    bindReplay("把字和词语配成一对");
  }
  window.tapCell = function(i){
    if(lock) return;
    var c = cells[i];
    if(c.gone) return;
    if(sel === i){ sel = -1; draw(); return; }
    if(sel < 0){ sel = i; speak(c.word.z); draw(); return; }
    var a = cells[sel];
    if(a.key === c.key && a.type !== c.type){
      a.gone = true; c.gone = true; matched++; sel = -1;
      speak(c.word.z + "，" + c.ci);
      var fb = $("#fb"); if(fb){ fb.textContent = "✅ 消掉一对！"; fb.className = "feedback ok"; }
      draw();
      if(matched === words.length) setTimeout(function(){ finishGame(matched, words.length, "生字消消乐"); }, 700);
    } else {
      lock = true; sel = i; draw();
      setTimeout(function(){ sel = -1; lock = false; draw(); }, 600);
    }
  };
  draw();
}

/* ===================== 5. 组词填空 ===================== */
function startWordFill(){
  var u = curUnit();
  var rounds = [];
  shuffle(u.w).forEach(function(w){
    var ci = w.w[Math.floor(Math.random() * w.w.length)];
    if(ci && ci.indexOf(w.z) >= 0 && ci.length >= 2) rounds.push({ z: w, ci: ci });
  });
  if(!rounds.length){ toast("本单元暂无可填空的词语"); return; }
  var list = rounds.slice(0, Math.min(8, rounds.length));
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = list[cur];
    var ci = r.ci;
    var pos = ci.indexOf(r.z.z);
    var gapI = (pos === 0 ? 1 : 0);
    var target = ci.charAt(gapI);
    var shown = ci.split("").map(function(c, i){ return i === gapI ? "○" : c; }).join("");
    var pool = [];
    DATA.grades[state.gi].books.forEach(function(b){ b.u.forEach(function(un){ un.w.forEach(function(x){ if(x.z !== target) pool.push(x.z); }); }); });
    var opts = shuffle([target].concat(shuffle(pool).slice(0, 3)));
    /* ⚠️ 题干/重播键都不能念完整词：屏幕上是「天○」，念出「天空」等于直接报答案。
       改成念「天什么」——把要填的那个空读成「什么」，题目完整、答案不泄露。
       答对以后（下面 answerWordFill 里）再念整词，那时候读是对的。 */
    var spoken = shown.replace(/○/g, "什么");
    bindReplay(spoken);
    gameShell(
      head(cur + 1, list.length, true) +
      '<div class="big-pic">' + picHTML(r.z.z) + '</div>' +
      '<div class="big-word zi-gap">' + esc(shown) + '</div>' +
      '<div class="prompt">把词语补完整（' + esc(r.z.z) + " · " + esc(r.z.p) + '）</div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-zi" onclick="answerWordFill(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "组词填空");
    setTimeout(function(){ speak(spoken); }, 300);
    window.answerWordFill = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      speak(opts[i]);   /* 点击即读：答错也念一遍被点的字（以前答错完全静音） */
      if(opts[i] === target){
        el.classList.add("correct"); correct++; fb.textContent = "✅ " + ci; fb.className = "feedback ok"; speak(ci);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「" + ci + "」"; fb.className = "feedback no";
        speak(ci);
        $all(".opt").forEach(function(o, j){ if(opts[j] === target) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "组词填空");
      }, 1900);
    };
  }
  renderRound();
}

/* ===================== 6. 诗句填空 ===================== */
function startPoemFill(){
  var pool = poolByGrade(window.POEMS || []);
  if(!pool.length){ toast("暂无古诗"); return; }
  var list = shuffle(pool).slice(0, Math.min(6, pool.length));
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var p = list[cur];
    var idx = Math.floor(Math.random() * p.l.length);
    var prev = idx > 0 ? p.l[idx - 1] : "";
    var target = p.l[idx];
    var opts = shuffle([target].concat(shuffle(
      pool.filter(function(x){ return x.t !== p.t; })
          .map(function(x){ return x.l[Math.floor(Math.random() * x.l.length)]; })
    ).slice(0, 3)));
    bindReplay(p.t + '，' + (prev || '') + target);
    gameShell(
      head(cur + 1, list.length, true) +
      '<div class="poem-box">' +
        '<div class="poem-title">' + esc(p.t) + ' · ' + esc(p.d) + '·' + esc(p.a) + '</div>' +
        (prev ? '<div class="poem-line dim">' + esc(prev) + '</div>' : '') +
        '<div class="poem-line gap">？</div>' +
      '</div>' +
      '<div class="prompt">' + (prev ? "接出下一句" : "选出第一句") + '</div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-poem" onclick="answerPoemFill(' + i + ')">' + esc(o) + '</div>';
      }).join("") +       '</div>' +
      '<div class="feedback" id="fb"></div>', "诗句填空");
    /* 题干必读：以前是 speak(prev || p.t)，idx===0 时 prev 为空 → 只剩诗题两个字，
       这就是「部分诗词没有读音」的来源。现在恒定读「诗题+朝代+作者」，再接上一句。 */
    setTimeout(function(){ speak(p.t + '，' + p.d + '代，' + p.a + '。' + (prev || '')); }, 300);
    window.answerPoemFill = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      /* 点击即读：对错都把被点的整句念一遍（照抄 startPinyin 的范式）。
         以前是只在答对时 speak(target)，答错完全静音。 */
      speak(opts[i]);
      if(opts[i] === target){
        el.classList.add("correct"); correct++; fb.textContent = "✅ " + target; fb.className = "feedback ok";
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「" + target + "」"; fb.className = "feedback no";
        speak(target);               /* 诗句填空：把整句念一遍最有用 */
        $all(".opt").forEach(function(o, j){ if(opts[j] === target) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "诗句填空");
      }, 2000);
    };
  }
  renderRound();
}

/* ===================== 7. 连句成诗 ===================== */
function startPoemSort(){
  var pool = poolByGrade(window.POEMS || []).filter(function(p){ return p.l.length >= 4; });
  if(!pool.length){ toast("暂无古诗"); return; }
  var list = shuffle(pool).slice(0, Math.min(4, pool.length));
  var cur = 0, correct = 0;
  function renderRound(){
    var p = list[cur];
    var bank = shuffle(p.l.slice());
    var used = [];
    function draw(){
      gameShell(
        head(cur + 1, list.length, true) +
        '<div class="poem-box"><div class="poem-title">' + esc(p.t) + ' · ' + esc(p.a) + '</div>' +
          used.map(function(i, k){ return '<div class="poem-line" onclick="unpickLine(' + k + ')">' + esc(bank[i]) + '</div>'; }).join("") +
        '</div>' +
        '<div class="prompt">按顺序点出诗句，连成一首诗</div>' +
        '<div class="sent-bank">' + bank.map(function(s, i){
          return '<span class="bw poem-bw ' + (used.indexOf(i) >= 0 ? "used" : "") + '" onclick="pickLine(' + i + ')">' + esc(s) + '</span>';
        }).join("") + '</div>' +
        '<div class="feedback" id="fb"></div>', "连句成诗");
    }
    /* 重播只绑一次：以前写在 draw() 里，每次重绘都被覆盖回「只读标题」，
       孩子永远没法重听整首诗。 */
    bindReplay(p.t + '，' + p.d + '代，' + p.a);
    window.pickLine = function(i){
      if(used.indexOf(i) >= 0) return;
      /* 点击即读：以前点诗句完全不发声，这是「诗词没读音」最严重的一处 */
      used.push(i); speak(bank[i]); draw();
      if(used.length === bank.length){
        var built = used.map(function(x){ return bank[x]; }).join("");
        var fb = $("#fb");
        if(built === p.l.join("")){
          correct++; fb.textContent = "✅ 背对啦！"; fb.className = "feedback ok"; speak(p.l.join(""));
          setTimeout(function(){
            cur++;
            if(cur < list.length) renderRound(); else finishGame(correct, list.length, "连句成诗");
          }, 1500);
        } else {
          fb.textContent = "❌ 顺序不对，再试一次"; fb.className = "feedback no";
          speak(p.l.join(""));       /* 把正确顺序的整首诗念一遍 */
          setTimeout(function(){ used = []; draw(); }, 1900);
        }
      }
    };
    window.unpickLine = function(k){ used.splice(k, 1); draw(); };
    draw();
    setTimeout(function(){ speak(p.t + '，' + p.d + '代，' + p.a); }, 300);
  }
  renderRound();
}

/* ===================== 8. 成语填空 ===================== */
function startIdiom(){
  var pool = poolByGrade(window.IDIOMS || []);
  if(!pool.length){ toast("暂无成语"); return; }
  var list = shuffle(pool).slice(0, Math.min(8, pool.length));
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var it = list[cur];
    var pos = 1 + Math.floor(Math.random() * 3);
    var target = it.w.charAt(pos);
    var shown = it.w.split("").map(function(c, i){ return i === pos ? "○" : c; }).join("");
    var mode = Math.random() < 0.5; // true 补字 / false 看义选成语
    var opts, answer;
    if(mode){
      var others = [];
      pool.forEach(function(x){ if(x.w !== it.w) x.w.split("").forEach(function(c){ if(c !== target) others.push(c); }); });
      opts = shuffle([target].concat(shuffle(others).slice(0, 3)));
      answer = target;
    } else {
      /* 题干是释义 → 选项必须是「成语」本身 */
      var wrong = shuffle(pool.filter(function(x){ return x.w !== it.w; })).slice(0, 3);
      var seenW = {}; seenW[it.w] = 1;
      var cands = [it.w];
      wrong.forEach(function(x){ if(!seenW[x.w]){ seenW[x.w] = 1; cands.push(x.w); } });
      opts = shuffle(cands);
      answer = it.w;
    }
    bindReplay(it.w);
    gameShell(
      head(cur + 1, list.length, true) +
      (mode
        ? '<div class="big-word idiom-big">' + esc(shown) + '</div><div class="prompt">补出成语中缺少的字</div><div class="sent-zh">' + esc(it.m) + '</div>'
        : '<div class="idiom-meaning">' + esc(it.m) + '</div><div class="prompt">哪条成语是这个意思？</div>') +
        '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-zi" onclick="answerIdiom(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "成语填空");
    /* 题干补朗读：释义是长句、孩子认不全字，以前题目出来是静音的 */
    setTimeout(function(){ speak(it.m); }, 300);
    window.answerIdiom = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      speak(opts[i]);   /* 点击即读 */
      if(opts[i] === answer){
        el.classList.add("correct"); correct++; fb.textContent = "✅ " + it.w + "：" + it.m; fb.className = "feedback ok"; speak(it.w);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「" + it.w + "」" + it.m; fb.className = "feedback no";
        speak(it.w);
        $all(".opt").forEach(function(o, j){ if(opts[j] === answer) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "成语填空");
      }, 2000);
    };
  }
  renderRound();
}

/* ===================== 9. 笔画数练习 ===================== */
function startStroke(){
  var u = curUnit();
  var rounds = buildRounds(u, 8); var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var r = rounds[cur];
    var n = r.correct.n;
    var cand = {}; cand[n] = true; var d = 1;
    while(Object.keys(cand).length < 4 && d <= 12){
      var a = n - d, b = n + d;
      if(a >= 1 && Object.keys(cand).length < 4) cand[a] = true;
      if(b <= 30 && Object.keys(cand).length < 4) cand[b] = true;
      d++;
    }
    var opts = shuffle(Object.keys(cand).map(Number));
    bindReplay(r.correct.z);
    gameShell(
      head(cur + 1, rounds.length, true) +
      '<div class="big-word zi-huge">' + esc(r.correct.z) + '</div>' +
      '<div class="pinyin-sub">' + esc(r.correct.p) + '</div>' +
      '<div class="prompt">这个字一共有几画？</div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-zi" onclick="answerStroke(' + i + ')">' + o + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "笔画数练习");
    setTimeout(function(){ speak(r.correct.z); }, 300);
    window.answerStroke = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      speak(r.correct.z);   /* 点击即读：选项是数字，念字比念数字有用 */
      if(opts[i] === n){
        el.classList.add("correct"); correct++; fb.textContent = "✅ " + r.correct.z + " 共 " + n + " 画"; fb.className = "feedback ok"; speak(r.correct.z);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ " + r.correct.z + " 共 " + n + " 画"; fb.className = "feedback no";
        speak(r.correct.z);
        $all(".opt").forEach(function(o, j){ if(opts[j] === n) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < rounds.length) renderRound(); else finishGame(correct, rounds.length, "笔画数练习");
      }, 1900);
    };
  }
  renderRound();
}

/* ===================== 10. 笔顺演示 ===================== */
function startWrite(){
  var u = curUnit();
  var list = shuffle(u.w).slice(0, Math.min(10, u.w.length));
  var cur = 0, done = 0;
  function renderRound(){
    var w = list[cur];
    var paths = (window.STROKES || {})[w.z];
    bindReplay(w.z);
    if(!paths || !paths.length){
      gameShell(
        head(cur + 1, list.length, true) +
        '<div class="big-word zi-huge">' + esc(w.z) + '</div>' +
        '<div class="pinyin-sub">' + esc(w.p) + '</div>' +
        '<div class="prompt">这个字共 ' + w.n + ' 画（暂无笔顺动画）</div>' +
        '<button class="btn green" style="margin-top:16px" onclick="nextWrite(1)">下一个 ➡️</button>', "笔顺演示");
      setTimeout(function(){ speak(w.z); }, 250);
      return;
    }
    var total = paths.length;
    gameShell(
      head(cur + 1, list.length, true) +
      '<div class="tian-wrap"><div class="tian" id="tian">' +
        '<svg viewBox="0 0 1024 1024" class="tian-svg">' +
          '<g class="grid-lines"><line x1="512" y1="0" x2="512" y2="1024"/><line x1="0" y1="512" x2="1024" y2="512"/>' +
          '<line x1="512" y1="0" x2="0" y2="512" class="diag"/><line x1="512" y1="0" x2="1024" y2="512" class="diag"/>' +
          '<line x1="0" y1="512" x2="512" y2="1024" class="diag"/><line x1="1024" y1="512" x2="512" y2="1024" class="diag"/></g>' +
          /* strokes.js 是 makemeahanzi 坐标系：原点左下、**y 轴朝上**，字符占 y ∈ [-124,900]。
             SVG 的 y 轴朝下，所以必须补 scale(1,-1) translate(0,-900)（等价于 y_svg = 900 - y_raw），
             否则字形整体上下镜像 —— 实测「上」被画成「下」、「下」被画成「上」，567 字无一幸免。
             ⚠️ 只翻笔画：田字格线本来就在正确的 y-down 空间里，一起翻就错位了。
             ⚠️ 不要用 1024-y：会溢出到 1124，字的底部被切掉。 */
          '<g transform="scale(1,-1) translate(0,-900)">' +
          paths.map(function(d, i){
            return '<path class="sk" data-i="' + i + '" d="' + d + '"></path>';
          }).join("") +
          '</g>' +
        '</svg>' +
        '<canvas class="tian-canvas" id="tc" width="440" height="440"></canvas>' +
      '</div></div>' +
      '<div class="stroke-info"><b class="zi-huge-sm">' + esc(w.z) + '</b> <span>' + esc(w.p) + '</span> · 共 <b>' + total + '</b> 笔 · 第 <b id="skIdx">0</b> 笔</div>' +
      '<div class="prompt">看笔顺，一笔一画写清楚</div>' +
      '<div class="row">' +
        '<button class="btn ghost" onclick="prevStroke()">◀️ 上一笔</button>' +
        '<button class="btn green" onclick="nextStroke()">下一笔 ▶️</button>' +
        '<button class="btn ghost" onclick="playStroke()">▶️ 自动</button>' +
      '</div>' +
      '<div class="row">' +
        '<button class="btn ghost" onclick="clearTrace()">🧽 擦掉</button>' +
        '<button class="btn ghost" onclick="window.replayCurrent()">🔊 读一读</button>' +
        '<button class="btn pink" onclick="nextWrite(1)">下一个 ➡️</button>' +
      '</div>', "笔顺演示");
    window.__skTotal = total; window.__skCur = 1;
    paintStrokes();
    setupTrace();
    setTimeout(function(){ speak(w.z); }, 250);
  }
  window.nextWrite = function(ok){
    if(ok) done++;
    cur++;
    if(cur < list.length) renderRound(); else finishGame(done, list.length, "笔顺演示");
  };
  renderRound();
}
function paintStrokes(){
  var n = window.__skCur || 0;
  $all("#tian .sk").forEach(function(p, i){
    p.classList.toggle("on", i < n);
    p.classList.toggle("now", i === n - 1);
  });
  var el = $("#skIdx"); if(el) el.textContent = n;
}
window.prevStroke = function(){
  if(window.__skCur > 0) window.__skCur--;
  paintStrokes();
};
window.nextStroke = function(){
  if(window.__skCur < window.__skTotal) window.__skCur++;
  paintStrokes();
  if(window.__skCur === window.__skTotal) toast("写完啦！");
};
window.playStroke = function(){
  if(window.__strokeTimer) clearInterval(window.__strokeTimer);
  window.__skCur = 0; paintStrokes();
  var t = setInterval(function(){
    window.__skCur++;
    paintStrokes();
    if(window.__skCur >= window.__skTotal){ clearInterval(t); window.__strokeTimer = null; }
  }, 620);
  window.__strokeTimer = t;
};
window.clearTrace = function(){
  var c = $("#tc"); if(!c) return;
  var ctx = c.getContext("2d"); ctx.clearRect(0, 0, c.width, c.height);
};
function setupTrace(){
  var c = $("#tc"); if(!c) return;
  var ctx = c.getContext("2d");
  ctx.lineWidth = 14; ctx.lineCap = "round"; ctx.strokeStyle = "#ff6f91";
  var drawing = false;
  function pos(e){
    var r = c.getBoundingClientRect();
    var t = e.touches ? e.touches[0] : e;
    return { x: (t.clientX - r.left) * (c.width / r.width), y: (t.clientY - r.top) * (c.height / r.height) };
  }
  function start(e){ drawing = true; var p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); e.preventDefault(); }
  function move(e){ if(!drawing) return; var p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke(); e.preventDefault(); }
  function end(){ drawing = false; }
  c.addEventListener("pointerdown", start);
  c.addEventListener("pointermove", move);
  c.addEventListener("pointerup", end);
  c.addEventListener("pointerleave", end);
}

/* ===================== 11. 近反义配对 ===================== */
function startNearFar(){
  var pool = poolByGrade(window.NEARFAR || []);
  if(!pool.length){ toast("暂无词语"); return; }
  var list = shuffle(pool).slice(0, Math.min(8, pool.length));
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var p = list[cur];
    var askNear = p.t === "近";
    /* 干扰项：整条词对的任何一个词都不能等于题干词或正确答案，且候选词要去重 */
    var others = pool.filter(function(x){
      return x.a !== p.a && x.a !== p.b && x.b !== p.a && x.b !== p.b;
    });
    var same = others.filter(function(x){ return x.t === p.t; });
    var cand = [];
    function pushCand(v){
      if(cand.length >= 3) return;
      if(v === p.a || v === p.b || cand.indexOf(v) >= 0) return;
      cand.push(v);
    }
    shuffle(same).concat(shuffle(others)).forEach(function(x){
      pushCand(x.t === p.t ? x.b : (Math.random() < 0.5 ? x.a : x.b));
    });
    if(cand.length < 3){
      pool.forEach(function(x){ pushCand(x.a); pushCand(x.b); });
    }
    var opts = shuffle([p.b].concat(cand));
    bindReplay(p.a);
    gameShell(
      head(cur + 1, list.length, true) +
      '<div class="big-word zi-big2">' + esc(p.a) + '</div>' +
      '<div class="prompt">选出「' + esc(p.a) + '」的' + (askNear ? "近义词" : "反义词") + '</div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-zi" onclick="answerNearFar(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "近反义配对");
    setTimeout(function(){ speak(p.a); }, 250);
    window.answerNearFar = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      speak(opts[i]);   /* 点击即读 */
      if(opts[i] === p.b){
        el.classList.add("correct"); correct++; fb.textContent = "✅ " + p.a + " — " + p.b + "（" + (askNear ? "近义" : "反义") + "）"; fb.className = "feedback ok"; speak(p.b);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「" + p.b + "」"; fb.className = "feedback no";
        speak(p.b);
        $all(".opt").forEach(function(o, j){ if(opts[j] === p.b) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "近反义配对");
      }, 1900);
    };
  }
  renderRound();
}

/* ===================== 12. 量词搭配 ===================== */
function startLiangci(){
  var pool = poolByGrade(window.LIANGCI || []);
  if(!pool.length){ toast("暂无量词"); return; }
  var list = shuffle(pool).slice(0, Math.min(8, pool.length));
  var cur = 0, correct = 0, locked = false;
  function renderRound(){
    locked = false;
    var p = list[cur];
    var opts = shuffle([p.l].concat(shuffle(p.o).slice(0, 3)));
    bindReplay("一" + p.l + p.n);
    gameShell(
      head(cur + 1, list.length, true) +
      '<div class="big-word zi-big2">一（　）' + esc(p.n) + '</div>' +
      '<div class="prompt">选一个合适的量词</div>' +
      '<div class="options">' + opts.map(function(o, i){
        return '<div class="opt opt-zi" onclick="answerLiangci(' + i + ')">' + esc(o) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "量词搭配");
    /* 题干补朗读：读名词本身（选项是量词，读名词不会泄题） */
    setTimeout(function(){ speak(p.n); }, 300);
    window.answerLiangci = function(i){
      if(locked) return; locked = true;
      var el = $all(".opt")[i]; var fb = $("#fb");
      speak(opts[i]);   /* 点击即读 */
      if(opts[i] === p.l){
        el.classList.add("correct"); correct++; fb.textContent = "✅ 一" + p.l + p.n; fb.className = "feedback ok"; speak("一" + p.l + p.n);
      } else {
        el.classList.add("wrong"); fb.textContent = "❌ 正确是「一" + p.l + p.n + "」"; fb.className = "feedback no";
        speak("一" + p.l + p.n);
        $all(".opt").forEach(function(o, j){ if(opts[j] === p.l) o.classList.add("correct"); });
      }
      setTimeout(function(){
        cur++;
        if(cur < list.length) renderRound(); else finishGame(correct, list.length, "量词搭配");
      }, 1900);
    };
  }
  renderRound();
}

/* ===================== 13. 朗读跟读 ===================== */
function startRead(){
  var u = curUnit();
  var list = shuffle(u.w).slice(0, Math.min(8, u.w.length));
  var cur = 0, total = 0, sumScore = 0;
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  function hasNativeSR(){
    if(!window.AndroidSR) return false;
    try { return window.AndroidSR.isAvailable ? !!window.AndroidSR.isAvailable() : true; }
    catch(e){ return false; }
  }
  var nativeSR = hasNativeSR();
  var noMic = (!SR && !nativeSR);
  function renderRound(){
    var w = list[cur];
    bindReplay(w.z + "，" + w.w[0]);
    gameShell(
      head(cur + 1, list.length, true) +
      '<div class="big-pic">' + picHTML(w.z) + '</div>' +
      '<div class="big-word zi-huge">' + esc(w.z) + '</div>' +
      '<div class="pinyin-sub">' + esc(w.p) + ' · ' + esc(w.w.join("/")) + '</div>' +
      '<div class="prompt">先听示范，再大声读出来</div>' +
      (noMic ? "" : '<button class="mic-btn" id="mic" onclick="startRec()">🎤</button>') +
      '<div class="read-score" id="score"></div>' +
      '<div class="read-hint" id="hint">' + (noMic ? "点「我读啦，过关」继续" : "点麦克风开始跟读") + '</div>' +
      '<div class="row" id="manualRow" style="display:' + (noMic ? "flex" : "none") + '">' +
        '<button class="btn green" onclick="manualPass()">✅ 我读啦，过关</button>' +
        '<button class="btn ghost" onclick="nextRead()">跳过 ➡️</button>' +
      '</div>', "朗读跟读");
    setTimeout(function(){ speak(w.z); }, 350);
  }
  function showManual(msg){
    var mr = $("#manualRow"); if(mr) mr.style.display = "flex";
    var h = $("#hint"); if(h && msg) h.textContent = msg;
  }
  var gotResult = false;
  window.startRec = function(){
    if(nativeSR && window.AndroidSR){
      var mic = $("#mic"); if(mic) mic.classList.add("listening");
      var h = $("#hint"); if(h) h.textContent = "正在聆听…大声读出来吧！";
      gotResult = false;
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
      setTimeout(function(){
        if(!gotResult){ var m4 = $("#mic"); if(m4) m4.classList.remove("listening"); showManual("没听到声音，可以直接点「我读啦，过关」"); }
      }, 8000);
      return;
    }
    if(!SR){ toast("当前浏览器不支持语音识别"); return; }
    var mic = $("#mic"); mic.classList.add("listening"); $("#hint").textContent = "正在聆听…大声读出来吧！";
    var rec = new SR(); rec.lang = "zh-CN"; rec.interimResults = false; rec.maxAlternatives = 3;
    gotResult = false;
    rec.onresult = function(e){
      gotResult = true;
      var best = "";
      for(var i = 0; i < e.results[0].length; i++){ if(!best || e.results[0][i].transcript.length >= best.length) best = e.results[0][i].transcript; }
      finishRec(best);
    };
    rec.onerror = function(e){ mic.classList.remove("listening"); showManual(e && e.error === "not-allowed" ? "麦克风被禁用了，可以直接点「我读啦，过关」" : "没听清，可以直接点「我读啦，过关」"); };
    rec.onend = function(){ mic.classList.remove("listening"); };
    try{ rec.start(); }catch(err){ mic.classList.remove("listening"); showManual("麦克风启动失败，可以直接点「我读啦，过关」"); }
    setTimeout(function(){
      if(!gotResult){ mic.classList.remove("listening"); showManual("没听到声音，可以直接点「我读啦，过关」"); }
    }, 8000);
  };
  function finishRec(txt){
    var w = list[cur]; var sc = scoreRead(w.z, txt);
    var scEl = $("#score");
    if(scEl){
      scEl.textContent = sc + "分";
      scEl.style.color = sc >= 80 ? "#3fc26b" : sc >= 50 ? "#ffd166" : "#ff6f91";
    }
    var hint = $("#hint"); if(hint) hint.textContent = txt ? "你说的是：" + txt : "没听清";
    total++; sumScore += sc;
    setTimeout(nextRead, 1300);
  }
  window.manualPass = function(){ total++; sumScore += 100; nextRead(); };
  function nextRead(){
    cur++;
    if(cur < list.length) renderRound();
    else{
      var avg = total ? Math.round(sumScore / total) : 0;
      var earned = avg >= 80 ? 3 : avg >= 50 ? 2 : total > 0 ? 1 : 0;
      finishGame(earned, 1, "朗读跟读");
    }
  }
  window.nextRead = nextRead;
  function scoreRead(target, transcript){
    if(!transcript) return 0;
    var t = String(target).replace(/[，。！？、\s]/g, "");
    var h = String(transcript).replace(/[，。！？、\s]/g, "");
    if(!h) return 0;
    if(h.indexOf(t) >= 0 || t.indexOf(h) >= 0) return 100;
    return Math.round((1 - lev(t, h) / Math.max(t.length, h.length)) * 100);
  }
  function lev(a, b){
    var m = a.length, n = b.length, d = [];
    for(var i = 0; i <= m; i++){ d[i] = [i]; for(var j = 1; j <= n; j++) d[i][j] = j; }
    for(var j2 = 0; j2 <= n; j2++) d[0][j2] = j2;
    for(var i2 = 1; i2 <= m; i2++)
      for(var j3 = 1; j3 <= n; j3++)
        d[i2][j3] = Math.min(d[i2 - 1][j3] + 1, d[i2][j3 - 1] + 1, d[i2 - 1][j3 - 1] + (a[i2 - 1] === b[j3 - 1] ? 0 : 1));
    return d[m][n];
  }
  renderRound();
}

/* ===================== 14. 限时挑战 ===================== */
function startChallenge(){
  var u = curUnit();
  var TIME = 60;
  var left = TIME, score = 0, streak = 0;
  var best = parseInt(localStorage.getItem("cn_best_challenge") || "0", 10) || 0;
  var timer = null, locked = false, q = null;
  function mkQ(){
    var kind = Math.random();
    var w = u.w[Math.floor(Math.random() * u.w.length)];
    if(kind < 0.35){
      /* 拼音无声调，同音字必须排除，否则会出现两个正确答案 */
      var optsA = optsOf(u, w, 4, "toneless");
      return { tip: "看拼音，选出对应的字", big: '<div class="big-word pinyin-big">' + esc(stripTone(w.p)) + '</div>',
        opts: optsA.map(function(o){ return { label: o.z, ok: o.z === w.z }; }), say: w.z };
    }
    if(kind < 0.6){
      var ci = w.w[Math.floor(Math.random() * w.w.length)];
      var pos = ci.indexOf(w.z);
      var gapI = pos === 0 ? 1 : 0;
      var target = ci.charAt(gapI);
      var shown = ci.split("").map(function(c, i){ return i === gapI ? "○" : c; }).join("");
      var pool = [];
      DATA.grades[state.gi].books.forEach(function(b){ b.u.forEach(function(un){ un.w.forEach(function(x){ if(x.z !== target) pool.push(x.z); }); }); });
      var optsB = shuffle([target].concat(shuffle(pool).slice(0, 3)));
      return { tip: "把词语补完整", big: '<div class="big-word zi-gap">' + esc(shown) + '</div>',
        opts: optsB.map(function(o){ return { label: o, ok: o === target }; }), say: ci };
    }
    if(kind < 0.8){
      var n = w.n; var set = {}; set[n] = 1; var d = 1;
      while(Object.keys(set).length < 4 && d <= 12){
        if(n - d >= 1 && Object.keys(set).length < 4) set[n - d] = 1;
        if(n + d <= 30 && Object.keys(set).length < 4) set[n + d] = 1;
        d++;
      }
      var optsC = shuffle(Object.keys(set).map(Number));
      return { tip: "「" + w.z + "」共几画？", big: '<div class="big-word zi-huge">' + esc(w.z) + '</div>',
        opts: optsC.map(function(o){ return { label: String(o), ok: o === n }; }), say: w.z };
    }
    var pool2 = poolByGrade(window.IDIOMS || []);
    if(pool2.length){
      var it = pool2[Math.floor(Math.random() * pool2.length)];
      var optsD = shuffle([it.w].concat(shuffle(pool2.filter(function(x){ return x.w !== it.w; })).slice(0, 3).map(function(x){ return x.w; })));
      return { tip: "哪条成语是这个意思？", big: '<div class="idiom-meaning">' + esc(it.m) + '</div>',
        opts: optsD.map(function(o){ return { label: o, ok: o === it.w }; }), say: it.w, small: true };
    }
    w = pickPicChar(u);                    /* 看图选字：易混字降频后再抽 */
    var optsE = picDistractors(u, w, 4);
    return { tip: "看图选字", big: '<div class="big-pic">' + picHTML(w.z) + '</div>',
      opts: optsE.map(function(o){ return { label: o.z, ok: o.z === w.z }; }), say: w.z };
  }
  function draw(){
    var pct = Math.max(0, left / TIME * 100);
    gameShell(
      '<div class="game-head"><div class="progress-pill">⏱️ ' + left + 's</div><div class="progress-pill">💯 ' + score + '</div></div>' +
      '<div class="timer-wrap"><div class="timer-bar ' + (pct < 25 ? "low" : "") + '" style="width:' + pct + '%"></div></div>' +
      '<div class="combo" id="combo">' + (streak >= 3 ? "🔥 连击 x" + streak : "") + '</div>' +
      q.big +
      '<div class="prompt">' + esc(q.tip) + '</div>' +
      '<div class="options">' + q.opts.map(function(o, i){
        return '<div class="opt ' + (q.small ? "opt-text" : "opt-zi") + '" onclick="answerChallenge(' + i + ')">' + esc(o.label) + '</div>';
      }).join("") + '</div>' +
      '<div class="feedback" id="fb"></div>', "限时挑战");
  }
  function tick(){
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
    speak(q.opts[i].label);   /* 点击即读（题干不加朗读：含「看图选字」题型，念了就泄题） */
    if(q.opts[i].ok){
      el.classList.add("correct"); streak++; score += 10 + (streak >= 3 ? 5 : 0);
      fb.textContent = "✅ +" + (10 + (streak >= 3 ? 5 : 0)); fb.className = "feedback ok"; speak(q.say);
    } else {
      el.classList.add("wrong"); streak = 0;
      var right = q.opts.filter(function(o){ return o.ok; })[0];
      fb.textContent = "❌ " + (right ? right.label : ""); fb.className = "feedback no";
      if (right) speak(right.label);
      $all(".opt").forEach(function(o, j){ if(q.opts[j].ok) o.classList.add("correct"); });
    }
    setTimeout(function(){ q = mkQ(); locked = false; draw(); }, 1400);
  };
  function endChallenge(){
    clearInterval(timer);
    window.__cnTimer = null;
    if(score > best){ best = score; localStorage.setItem("cn_best_challenge", String(best)); }
    setStars(state.gi, state.bi, state.ui, score >= 120 ? 3 : score >= 60 ? 2 : score > 0 ? 1 : 0);
    app.innerHTML = topbar("挑战结束", true) +
      '<div class="result-box">' +
        '<div style="font-size:46px">' + (score >= 60 ? "🏆" : "⏱️") + '</div>' +
        '<div class="read-score">' + score + '</div>' +
        '<div style="font-size:16px;color:var(--sub)">限时挑战 · 60 秒得分</div>' +
        '<div class="best">🏅 历史最高：' + best + '</div>' +
        '<div class="row">' +
          '<button class="btn ghost" onclick="startChallenge()">🔁 再来一次</button>' +
          '<button class="btn green" onclick="state.view=\'modes\';render()">🎮 换玩法</button>' +
        '</div>' +
        '<button class="btn pink" style="margin-top:12px" onclick="state.view=\'units\';render()">返回单元列表</button>' +
      '</div>';
  }
  if(window.__cnTimer) clearInterval(window.__cnTimer);
  q = mkQ();
  draw();
  timer = setInterval(tick, 1000);
  window.__cnTimer = timer;
}
