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
 *   window.PRAISE.block(level, extraHtml)     → 结果页顶部的大块横幅 HTML
 *   window.PRAISE.fx(level, sayThis)          → 全屏撒花 + 光环 + 朗读夸奖语
 * ==================================================================== */
(function () {
  var TXT = {
    perfect: [
      "满分！全部答对，你太厉害啦！",
      "太棒了，一题都没错，给你鼓掌！",
      "哇，满分！你就是这个单元的小老师！",
      "完美通关！爸爸妈妈会为你骄傲的！",
      "全对！你的记性真是太好了！"
    ],
    great: [
      "好厉害，拿到三颗星！",
      "真棒！差一点点就是满分啦！",
      "星星闪闪，你进步好大呀！",
      "做得非常好，再练一次就满分！"
    ],
    good: [
      "不错哦，再练一次就能拿满星！",
      "有进步，继续加油！",
      "已经答对不少了，坚持练习！",
      "做得不错，把错的再看一遍就更棒啦！"
    ],
    again: [
      "没关系，我们再玩一次，你一定行！",
      "别灰心，多听几遍、多练几次就会啦！",
      "刚开始都这样，再来一次试试看！",
      "勇敢挑战就很棒了，我们再来一遍！"
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

  var CSS =
    '@keyframes pf-fall{0%{transform:translate3d(0,-12vh,0) rotate(0deg);opacity:1}100%{transform:translate3d(0,105vh,0) rotate(720deg);opacity:.9}}' +
    '@keyframes pf-pop{0%{transform:scale(.2);opacity:0}60%{transform:scale(1.25);opacity:1}100%{transform:scale(1);opacity:1}}' +
    '@keyframes pf-halo{0%{transform:scale(.3);opacity:0}35%{opacity:.85}100%{transform:scale(2.4);opacity:0}}' +
    '@keyframes pf-drop{0%{transform:translateY(-70px);opacity:0}55%{transform:translateY(8px);opacity:1}70%{transform:translateY(0)}100%{transform:translateY(0);opacity:1}}' +
    '@keyframes pf-shine{0%{background-position:-200% 0}100%{background-position:200% 0}}' +
    '@keyframes pf-out{to{opacity:0}}' +
    '#pf-wrap{position:fixed;left:0;top:0;right:0;bottom:0;z-index:9999;pointer-events:none;overflow:hidden}' +
    '#pf-wrap.done{animation:pf-out .45s ease forwards}' +
    '.pf-halo{position:absolute;left:50%;top:38%;width:56vw;height:56vw;margin:-28vw 0 0 -28vw;border-radius:50%;' +
    'background:radial-gradient(circle,rgba(255,215,64,.95) 0%,rgba(255,182,40,.55) 38%,rgba(255,255,255,0) 70%);' +
    'animation:pf-halo 1.5s ease-out forwards}' +
    '.pf-piece{position:absolute;top:0;width:9px;height:16px;border-radius:2px;animation:pf-fall linear forwards}' +
    '.pf-banner{position:absolute;left:0;right:0;top:14%;text-align:center;animation:pf-drop .6s cubic-bezier(.2,1.4,.4,1) forwards}' +
    '.pf-banner .b1{display:inline-block;padding:10px 26px;border-radius:999px;font-size:22px;font-weight:900;color:#fff;' +
    'background:linear-gradient(90deg,#ff9f1a,#ffd166,#ff9f1a,#ffd166);background-size:200% 100%;animation:pf-shine 2.2s linear infinite;' +
    'box-shadow:0 8px 22px rgba(255,150,0,.45);text-shadow:0 2px 4px rgba(0,0,0,.12)}' +
    '.pf-banner .b2{margin-top:8px;font-size:16px;font-weight:800;color:#fff;text-shadow:0 2px 6px rgba(0,0,0,.35),0 0 10px rgba(255,180,0,.6)}' +
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

  var COLORS = ["#ffd166", "#ff9f1a", "#ef476f", "#06d6a0", "#118ab2", "#f72585", "#ffd60a", "#8ac926"];

  /* 全屏撒花：level 越高片数越多、停留越久；同时把夸奖语念出来 */
  function fx(level, sayThis) {
    ensureStyle();
    var heavy = (level === "perfect" || level === "record");
    var n = heavy ? 46 : (level === "great" ? 26 : 0);
    var b = BADGE[level] || BADGE.good;
    var msg = sayThis || text(level);

    if (n > 0) {
      var wrap = document.createElement("div");
      wrap.id = "pf-wrap";
      if (heavy) {
        var halo = document.createElement("div");
        halo.className = "pf-halo";
        wrap.appendChild(halo);
      }
      for (var i = 0; i < n; i++) {
        var p = document.createElement("i");
        p.className = "pf-piece";
        p.style.left = (Math.random() * 100) + "vw";
        p.style.background = COLORS[i % COLORS.length];
        p.style.animationDuration = (1.5 + Math.random() * 1.4) + "s";
        p.style.animationDelay = (Math.random() * 0.7) + "s";
        p.style.width = (7 + Math.random() * 6) + "px";
        p.style.height = (12 + Math.random() * 10) + "px";
        wrap.appendChild(p);
      }
      var ban = document.createElement("div");
      ban.className = "pf-banner";
      ban.innerHTML = '<div class="b1">' + b.icon + " " + b.title + "</div><div class=\"b2\">" + msg + "</div>";
      wrap.appendChild(ban);
      document.body.appendChild(wrap);
      var life = heavy ? 3200 : 2200;
      setTimeout(function () {
        wrap.classList.add("done");
        setTimeout(function () { if (wrap.parentNode) wrap.parentNode.removeChild(wrap); }, 500);
      }, life);
    }

    /* 夸奖语也要念出来 —— 听说类 App，光看字不够 */
    setTimeout(function () {
      try { if (typeof speak === "function") speak(msg); } catch (e) {}
    }, heavy ? 700 : 350);
  }

  /* 结果页顶部的大块横幅（跟着 result-box 一起渲染，不会因为撒花结束就消失） */
  function block(level, extraHtml) {
    ensureStyle();
    var b = BADGE[level] || BADGE.good;
    var showStars = (level === "perfect" || level === "great" || level === "record");
    return '<div class="praise-block ' + b.cls + '">' +
      '<div class="pb-icon">' + b.icon + "</div>" +
      '<div class="pb-title">' + b.title + "</div>" +
      '<div class="pb-say">' + text(level) + "</div>" +
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
