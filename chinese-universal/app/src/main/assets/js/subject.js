/* ===================== js/subject.js · 选学科页 =====================
 * 只在「还没选学科」时被 boot.js 注入，一次也不多、一次也不少。
 * 学科一旦选定，整个页面 reload，本文件就不再加载了。
 *
 * 【可热更】本文件可以随资源包替换 —— 所以学科名字、图标、顺序、简介
 * 都能远程改，不用出新 APK。改完记得跑 tools/gen-pack.mjs 重新打包。
 *
 * 【必须自己处理遥控器】
 *   选学科页没有任何一科的 tv.js 在岗（那三份都是各自学科目录下的文件，
 *   picker 模式一个都不注入）。而 MainActivity.dispatchKeyEvent 会在确认键抬起时
 *   兜底 click() 当前焦点 —— 只要我们在这里把 window.__tvKeyHandled 置 true，
 *   原生就退让，由本文件统一处理，避免「按一下触发两次」。
 *   反过来，如果这里不打标记又不处理，电视上就会既不响应又 double fire。
 *
 * 【为什么卡片用 <div tabindex> 而不是 <button>】
 *   三张卡排列简单，焦点顺序就是 DOM 顺序；用 tabindex 可以直接 focus，
 *   免得和各科 style.css 里对 button 的样式打架。
 * ===================================================================== */
(function () {
  "use strict";

  /* 学科清单 —— 唯一真源在这里。增删学科改这一处即可，不必动 APK。
     key 必须和 boot.js 的 SUBJS 里的键一致：那边没登记的 key，
     __setSubject 会直接拒绝（启动日志里会留一条 bad subject），点了没反应。 */
  var SUBJECTS = [
    { key: "cn",   emoji: "📖", name: "语文", cls: "cn",
      desc: "识字・拼音・古诗・成语・笔顺・看图识字", progress: "cn_progress" },
    { key: "math", emoji: "🔢", name: "数学", cls: "math",
      desc: "口算・竖式・口诀・应用题・图形・单位・分数", progress: "math_progress" },
    { key: "en",   emoji: "🔤", name: "英语", cls: "en",
      desc: "单词・拼读・听力・句型・对话・限时挑战", progress: "el_progress" }
  ];

  var LAST_KEY = "app_subject_last";     // 上次用过的学科，用于自动聚焦

  function $(s) { return document.querySelector(s); }
  function $all(s) { return Array.prototype.slice.call(document.querySelectorAll(s)); }

  function totalStars(storeKey) {
    var n = 0;
    try {
      var raw = localStorage.getItem(storeKey);
      if (!raw) return 0;
      var o = JSON.parse(raw);
      if (!o || typeof o !== "object") return 0;
      for (var k in o) {
        if (!Object.prototype.hasOwnProperty.call(o, k)) continue;
        var v = Number(o[k]) || 0;
        if (v > 0) n += v;
      }
    } catch (e) {}
    return n;
  }

  function starText(n) {
    if (!n) return "还没开始，来吧！";
    return "已收获 ⭐" + n + " 颗星";
  }

  function render() {
    var last = "";
    try { last = localStorage.getItem(LAST_KEY) || ""; } catch (e) {}

    var html =
      '<div class="subj-head">' +
        '<div class="logo">🎒</div>' +
        '<h1>学习乐园</h1>' +
        '<p>小学 1-6 年级 · 手机 / 平板 / 电视都能玩</p>' +
      '</div>' +
      '<div class="subj-grid">';

    for (var i = 0; i < SUBJECTS.length; i++) {
      var s = SUBJECTS[i];
      html +=
        '<div class="subj-card ' + s.cls + '" tabindex="0" data-subj="' + s.key + '"' +
             ' onclick="__setSubject(\'' + s.key + '\')">' +
          '<div class="s-emoji">' + s.emoji + '</div>' +
          '<div class="s-body">' +
            '<div class="s-name">' + s.name + (last === s.key ? ' <span style="font-size:12px;color:var(--purple)">最近在用</span>' : '') + '</div>' +
            '<div class="s-desc">' + s.desc + '</div>' +
            '<div class="s-desc" style="color:var(--purple)">' + starText(totalStars(s.progress)) + '</div>' +
          '</div>' +
          '<div class="s-go">›</div>' +
        '</div>';
    }
    html +=
      '</div>' +
      '<div class="subj-tip">随时可以在右上角 ⚙️ 设置里「🔄 换学科」，进度各自独立保存</div>' +
      '<div class="subj-foot">离线可玩 · 首次打开联网后会静默更新内容</div>';

    var app = document.getElementById("app");
    if (app) app.innerHTML = html;

    bindKeys();
    ensureFocus();
  }

  /* ---------------- TV 遥控器 ---------------- */
  /* 可见筛选要有兜底：jsdom 之类的环境里 offsetParent 恒为 null，
     一过滤就得到空数组，焦点逻辑整段不执行 —— 表现是"遥控器按了没反应"。
     宁可在判不出可见性时把全部卡片算进来，也不要一个都选不中。 */
  function cards() {
    var all = $all("#app .subj-card");
    var vis = all.filter(function (el) { return el.offsetParent !== null; });
    return vis.length ? vis : all;
  }
  function focusAt(el) {
    if (!el) return;
    try { el.focus(); } catch (e) {}
  }
  function ensureFocus() {
    var list = cards();
    if (!list.length) return;
    var cur = document.activeElement;
    if (cur && list.indexOf(cur) >= 0) return;
    var last = "";
    try { last = localStorage.getItem(LAST_KEY) || ""; } catch (e) {}
    var pick = list[0];
    for (var i = 0; i < list.length; i++) {
      if (list[i].getAttribute("data-subj") === last) { pick = list[i]; break; }
    }
    focusAt(pick);
  }
  function move(dir) {
    var list = cards();
    if (!list.length) return;
    var cur = document.activeElement;
    var idx = list.indexOf(cur);
    if (idx < 0) { focusAt(list[0]); return; }
    var next = idx + (dir === "up" ? -1 : 1);
    if (next < 0) next = list.length - 1;
    if (next >= list.length) next = 0;
    focusAt(list[next]);
  }

  var lastEnter = 0;
  function bindKeys() {
    if (window.__subjKeysBound) return;
    window.__subjKeysBound = true;

    document.addEventListener("keydown", function (e) {
      var k = e.key;
      var kc = e.keyCode || 0;
      if (k === "ArrowUp" || kc === 38) { e.preventDefault(); move("up"); return; }
      if (k === "ArrowDown" || kc === 40) { e.preventDefault(); move("down"); return; }
      var isEnter = (k === "Enter" || k === " " || k === "Spacebar" || kc === 13 || kc === 66 || kc === 23);
      if (!isEnter) return;
      /* 220ms 防抖：中兴/华为 IPTV 的遥控器在 keydown + ActionUp 各来一次，
         不防抖就是「按一下跳两科」。 */
      var now = Date.now();
      if (now - lastEnter < 220) { e.preventDefault(); return; }
      lastEnter = now;
      e.preventDefault();
      var el = document.activeElement;
      if (!el) return;
      var key = el.getAttribute ? el.getAttribute("data-subj") : "";
      if (!key) return;
      try { localStorage.setItem(LAST_KEY, key); } catch (err) {}
      if (window.__setSubject) window.__setSubject(key);
    }, false);

    /* 告诉原生壳：确认键由这里接管了，别再兜底 click 一次（否则按一下触发两次） */
    window.__tvKeyHandled = true;

    /* 鼠标划过就移焦点，桌面浏览器预览时手感一致 */
    $all("#app .subj-card").forEach(function (el) {
      el.addEventListener("mouseenter", function () { focusAt(el); });
    });
  }

  /* 视图随时可能被重建（现在只渲染一次，留个钩子给以后的热更用） */
  window.__renderSubjectPicker = render;

  render();
})();
