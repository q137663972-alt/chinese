/* ===================== 夸奖语 + 满分特效（可热更） =====================
 * 这是新增的普通 js 文件（不是玩法，也不是冻结文件）：
 * boot.js 的 planFiles 会把资源包里 BUILTIN 之外的新文件追加到末尾加载，
 * 所以它能随热更包下发，不需要出新 APK。
 *
 * 对外只挂一个 window.PRAISE，三处调用点（app.js 的 finishGame、games.js 的挑战结算）
 * 都做了存在性判断 —— 万一这个文件没加载上，也只是没有特效，不会白屏报错。
 *
 *   window.PRAISE.level(acc, earned)          → 评级：perfect / great / good / again
 *   window.PRAISE.text(level)                 → 随机夸奖语
 *   window.PRAISE.block(level, extraHtml)     → 结果页顶部的大块横幅 HTML（并朗读夸奖语）
 *   window.PRAISE.fx(level, sayThis)          → 全屏飘彩带动画 + 朗读（始终念，去重防重复）
 * ==================================================================== */
(function () {
  var TXT = {
    perfect: [
      "满分！全部答对，你太厉害啦！",
      "太棒了，一题都没错，给你鼓掌！",
      "哇，满分！你就是这个单元的小老师！",
      "完美通关！爸爸妈妈会为你骄傲的！",
      "全对！你的记性真是太好了！",
      "满分小天才！这道题连大人都不一定全对！"
    ],
    great: [
      "好厉害，拿到三颗星！",
      "真棒！差一点点就是满分啦！",
      "星星闪闪，你进步好大呀！",
      "做得非常好，再练一次就满分！",
      "三颗星到手，你就是今天最亮的星！"
    ],
    good: [
      "不错哦，再练一次就能拿满星！",
      "有进步，继续加油！",
      "已经答对不少了，坚持练习！",
      "做得不错，把错的再看一遍就更棒啦！",
      "稳扎稳打，你比昨天更强了！"
    ],
    again: [
      "没关系，我们再玩一次，你一定行！",
      "别灰心，多听几遍、多练几次就会啦！",
      "刚开始都这样，再来一次试试看！",
      "勇敢挑战就很棒了，我们再来一遍！",
      "学习像爬山，慢慢来，你一定登顶！"
    ],
    record: [
      "打破纪录！你刷新了自己的最好成绩！",
      "新纪录！你一次比一次厉害！",
      "太强了，这次超过了历史最高分！"
    ]
  };

  var BADGE = {
    perfect: { icon: "🏆", title: "满分！太厉害啦！", cls: "pf-perfect" },
    great:   { icon: "🌟", title: "三星达成！",       cls: "pf-great" },
    good:    { icon: "👍", title: "不错哦！",         cls: "pf-good" },
    again:   { icon: "💪", title: "再来一次！",       cls: "pf-again" },
    record:  { icon: "🎊", title: "打破纪录！",       cls: "pf-perfect" }
  };

  function pick(list) { return list[Math.floor(Math.random() * list.length)]; }

  /* 评级：满分（100%）单独一档，特效最响；其余按星星数 */
  function levelOf(acc, earned) {
    if (acc >= 100) return "perfect";
    if (earned >= 3) return "great";
    if (earned >= 1) return "good";
    return "again";
  }

  /* 挑战类：没有满分概念，用「破纪录」当最高光 */
  function levelOfScore(score, isRecord) {
    if (isRecord && score >= 60) return "record";
    if (score >= 120) return "great";
    if (score >= 60) return "good";
    return "again";
  }

  function text(level) { return pick(TXT[level] || TXT.good); }

  /* 朗读去重：block 与 fx 都会调用，同一句话 1.5 秒内只念一次，防止重复 */
  var _lastSay = 0, _lastMsg = "";
  function say(msg) {
    try {
      if (typeof speak !== "function" || !msg) return;
      var now = Date.now();
      if (msg === _lastMsg && now - _lastSay < 1500) return;
      _lastMsg = msg; _lastSay = now;
      speak(msg);
    } catch (e) {}
  }

  var CSS =
    /* 全屏飘彩带：从屏幕任意位置生成，带横向摆动地飘动 + 旋转 */
    '@keyframes pf-float{' +
      '0%{opacity:0;transform:translate3d(0,0,0) rotate(0deg)}' +
      '10%{opacity:1}' +
      '33%{transform:translate3d(calc(var(--dx)*.5),calc(var(--dy)*.3),0) rotate(calc(var(--rot)*.33))}' +
      '66%{transform:translate3d(calc(var(--dx)*.82),calc(var(--dy)*.72),0) rotate(calc(var(--rot)*.66))}' +
      '100%{opacity:.9;transform:translate3d(var(--dx),var(--dy),0) rotate(var(--rot))}' +
    '}' +
    '@keyframes pf-ribbon{' +
      '0%{opacity:0;transform:translate3d(0,0,0) rotate(0deg)}' +
      '12%{opacity:1}' +
      '50%{transform:translate3d(calc(var(--dx)*.6),calc(var(--dy)*.5),0) rotate(calc(var(--rot)*.5))}' +
      '100%{opacity:.9;transform:translate3d(var(--dx),var(--dy),0) rotate(var(--rot))}' +
    '}' +
    '@keyframes pf-pop{0%{transform:scale(.2);opacity:0}60%{transform:scale(1.25);opacity:1}100%{transform:scale(1);opacity:1}}' +
    '@keyframes pf-halo{0%{transform:scale(.3);opacity:0}35%{opacity:.85}100%{transform:scale(2.4);opacity:0}}' +
    '@keyframes pf-drop{0%{transform:translateY(-70px);opacity:0}55%{transform:translateY(8px);opacity:1}70%{transform:translateY(0)}100%{transform:translateY(0);opacity:1}}' +
    '@keyframes pf-shine{0%{background-position:-200% 0}100%{background-position:200% 0}}' +
    '@keyframes pf-out{to{opacity:0}}' +
    /* 全屏遮罩：盖住整屏，但不挡点击（pointer-events:none） */
    '#pf-wrap{position:fixed;inset:0;z-index:9999;pointer-events:none;overflow:hidden}' +
    '#pf-wrap.done{animation:pf-out .45s ease forwards}' +
    '.pf-halo{position:absolute;left:50%;top:42%;width:62vw;height:62vw;margin:-31vw 0 0 -31vw;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,215,64,.95) 0%,rgba(255,182,40,.5) 38%,rgba(255,255,255,0) 70%);' +
    'animation:pf-halo 1.5s ease-out forwards}' +
    /* 正方形小碎片：从屏幕任意处生成，向随机方向飘 */
    '.pf-piece{position:absolute;top:0;left:0;width:9px;height:16px;border-radius:2px;animation:pf-float linear forwards}' +
    /* 细长彩带：飘得更飘逸 */
    '.pf-piece.pf-ribbon{width:5px;height:30px;border-radius:3px;animation-name:pf-ribbon}' +
    '.pf-banner{position:absolute;left:0;right:0;top:13%;text-align:center;animation:pf-drop .6s cubic-bezier(.2,1.4,.4,1) forwards}' +
    '.pf-banner .b1{display:inline-block;padding:12px 30px;border-radius:999px;font-size:24px;font-weight:900;color:#fff;' +
    'background:linear-gradient(90deg,#ff9f1a,#ffd166,#ff9f1a,#ffd166);background-size:200% 100%;animation:pf-shine 2.2s linear infinite;' +
    'box-shadow:0 8px 22px rgba(255,150,0,.45);text-shadow:0 2px 4px rgba(0,0,0,.12)}' +
    '.pf-banner .b2{margin-top:10px;font-size:18px;font-weight:800;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.35),0 0 10px rgba(255,180,0,.6)}' +
    '.praise-block{text-align:center;padding:10px 6px 4px}' +
    '.praise-block .pb-icon{font-size:56px;line-height:1.1;animation:pf-pop .6s cubic-bezier(.2,1.5,.4,1) both}' +
    '.praise-block .pb-title{margin-top:2px;font-size:22px;font-weight:900;letter-spacing:1px}' +
    '.praise-block.pf-perfect .pb-title{color:#e08b00}' +
    '.praise-block.pf-great .pb-title{color:#e08b00}' +
    '.praise-block.pf-good .pb-title{color:#2f8f4e}' +
    '.praise-block.pf-again .pb-title{color:#4a6fa5}' +
    '.praise-block .pb-say{margin-top:4px;font-size:17px;font-weight:800;color:var(--fg,#333);line-height:1.5}' +
    '.praise-block .pb-stars{margin-top:6px;font-size:30px;letter-spacing:4px}' +
    '.praise-block .pb-stars span{display:inline-block;animation:pf-pop .5s cubic-bezier(.2,1.5,.4,1) both}' +
    '.praise-block .pb-stars span:nth-child(2){animation-delay:.14s}' +
    '.praise-block .pb-stars span:nth-child(3){animation-delay:.28s}';

  function ensureStyle() {
    if (document.getElementById("praise-style")) return;
    var s = document.createElement("style");
    s.id = "praise-style";
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  var COLORS = ["#ffd166", "#ff9f1a", "#ef476f", "#06d6a0", "#118ab2", "#f72585", "#ffd60a", "#8ac926", "#ff70a6", "#70d6ff"];
  var RIBBON_COLORS = ["#ffd166", "#ff7eb3", "#06d6a0", "#70d6ff", "#ff9f1a", "#c77dff"];

  function rand(a, b) { return a + Math.random() * (b - a); }

  /* 全屏飘彩带：level 越高片数越多、停留越久；夸奖语始终朗读（去重） */
  function fx(level, sayThis) {
    ensureStyle();
    var b = BADGE[level] || BADGE.good;
    var msg = sayThis || text(level);
    say(msg); /* 始终念一遍，block 处若已念过会被去重拦截 */

    var heavy = (level === "perfect" || level === "record");
    var n = heavy ? 70 : (level === "great" ? 44 : (level === "good" ? 26 : 0));
    if (n <= 0) return;

    var wrap = document.createElement("div");
    wrap.id = "pf-wrap";
    if (heavy) {
      var halo = document.createElement("div");
      halo.className = "pf-halo";
      wrap.appendChild(halo);
    }
    for (var i = 0; i < n; i++) {
      var ribbon = (i % 3 === 0); /* 每 3 片 1 条细长彩带，更有「飘」感 */
      var p = document.createElement("i");
      p.className = "pf-piece" + (ribbon ? " pf-ribbon" : "");
      /* 在整屏随机出生点 */
      p.style.left = rand(0, 100) + "vw";
      p.style.top = rand(0, 100) + "vh";
      /* 随机漂移方向（带横向摆动，向上偏一点更像飘） */
      p.style.setProperty("--dx", rand(-48, 48).toFixed(1) + "vw");
      p.style.setProperty("--dy", rand(-58, 38).toFixed(1) + "vh");
      p.style.setProperty("--rot", rand(-420, 420).toFixed(0) + "deg");
      p.style.background = ribbon
        ? "linear-gradient(180deg," + RIBBON_COLORS[i % RIBBON_COLORS.length] + ",rgba(255,255,255,.2))"
        : COLORS[i % COLORS.length];
      p.style.animationDuration = rand(2.6, 5.2).toFixed(2) + "s";
      p.style.animationDelay = rand(0, 0.9).toFixed(2) + "s";
      if (!ribbon) {
        p.style.width = rand(7, 13).toFixed(0) + "px";
        p.style.height = rand(12, 22).toFixed(0) + "px";
      }
      wrap.appendChild(p);
    }
    var ban = document.createElement("div");
    ban.className = "pf-banner";
    ban.innerHTML = '<div class="b1">' + b.icon + " " + b.title + "</div><div class=\"b2\">" + msg + "</div>";
    wrap.appendChild(ban);
    document.body.appendChild(wrap);
    var life = heavy ? 4000 : 3000;
    setTimeout(function () {
      wrap.classList.add("done");
      setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 500);
    }, life);
  }

  /* 结果页顶部的大块横幅（跟着 result-box 一起渲染，不会因为撒花结束就消失）；同时朗读夸奖语 */
  function block(level, extraHtml) {
    ensureStyle();
    var b = BADGE[level] || BADGE.good;
    var showStars = (level === "perfect" || level === "great" || level === "record");
    var t = text(level);
    say(t); /* 结算页的夸奖语也念出来 */
    return '<div class="praise-block ' + b.cls + '">' +
      '<div class="pb-icon">' + b.icon + "</div>" +
      '<div class="pb-title">' + b.title + "</div>" +
      '<div class="pb-say">' + t + "</div>" +
      (showStars ? '<div class="pb-stars"><span>⭐</span><span>⭐</span><span>⭐</span></div>' : "") +
      (extraHtml || "") +
      "</div>";
  }

  window.PRAISE = {
    level: levelOf,
    levelOfScore: levelOfScore,
    text: text,
    block: block,
    fx: fx
  };
})();
