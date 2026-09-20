#!/usr/bin/env node
/* ===================== tools/smoke.mjs · 无浏览器冒烟测试 =====================
 * 用法：
 *     node tools/smoke.mjs                 # 跑全部：语文 / 数学 / 英语 / 选学科
 *     node tools/smoke.mjs cn en           # 只跑语文和英语
 *     node tools/smoke.mjs math            # 只跑数学
 *
 * 干什么：用 jsdom 把 boot.js 清单里的 js 按顺序注入，逐个页面、逐个玩法跑一遍，
 *         报告渲染出的 HTML 里有没有 undefined、有没有抛异常、有没有计时器泄漏。
 * 为什么要有：机顶盒 WebView 里报 JS 错误没有控制台，肉眼只能看到「页面怪怪的」。
 *         「知识圈全是 undefined」「退出玩法后界面被计时器抢回去」这类问题，
 *         全靠它在出包前拦下来。
 *
 * ★ 三合一之后这个文件重写了一次：
 *     1. 注入清单从 boot.js 里抽（tools/lib/boot-manifest.mjs），不再手抄。
 *        老版本手抄的那份 BUILTIN 在三科迁进 cn/ math/ en/ 后仍然指向 js/cp.js，
 *        于是它测的是一串根本不存在的路径、却照样全绿 —— 假通过比不测更危险。
 *     2. 四种启动模式都要能跑：picker（选学科）/ cn / math / en。
 *        遥控器锚点、返回链、计时器清理三科必须一致，
 *        否则「同一份代码、语文没问题数学有问题」就会漏到用户手上。
 *     3. 计时器泄漏改成通用检测：劫持 setInterval / clearInterval 记账，
 *        不再假设「只有 battle 会泄漏」「句柄一定挂 window.__xxTimer」。
 * ===================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { readBootManifest } from "./lib/boot-manifest.mjs";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAN = readBootManifest(ROOT);

const NAME = { picker: "选学科", cn: "语文", math: "数学", en: "英语" };
const TIMER_KEY = { cn: "__cnTimer", math: "__mathTimer", en: "__enTimer" };
const PROGRESS_KEY = { cn: "cn_progress", math: "math_progress", en: "el_progress" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAILS = [];
const WARN = [];

function chk(cond, label, detail) {
  const line = (cond ? "  ✅ " : "  ❌ ") + label + (detail ? "   " + detail : "");
  console.log(line);
  if (!cond) FAILS.push(label + (detail ? " — " + detail : ""));
}
function warn(msg) { WARN.push(msg); console.log("  ⚠️  " + msg); }

/* ---------------- 环境搭建 ---------------- */
/* jsdom 不支持 canvas / audio，一进写字玩法就刷满屏 "Not implemented"，
   把真正的失败项淹了 —— 这里只静音这一类，其它异常照常外放。 */
function quietConsole() {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (e && /^Not implemented/.test(String(e.message))) return;
    console.log("  [jsdom] " + (e && e.message ? e.message : e));
  });
  return vc;
}

function mkWindow() {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8")
    .replace(/<script src="js\/boot\.js"><\/script>/, "");
  const dom = new JSDOM(html, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "http://local.test/index.html", virtualConsole: quietConsole(),
  });
  const w = dom.window;
  // 模拟 TV + 无 speechSynthesis
  Object.defineProperty(w.navigator, "userAgent", {
    value: "Mozilla/5.0 (Linux; Android 8.0; MiTV) AppleWebKit/537.36 Chrome/62",
    configurable: true,
  });
  w.__dev = { tv: true, sw: 1920, touch: false, mic: false, apk: 12, native: true };

  /* jsdom 不做布局：offsetParent 恒为 null，tv.js 每一处「元素可见吗」都判成不可见，
     焦点逻辑等于没跑 —— 焦点回归会变成假通过。这里补近似实现：
     处于 .hidden 子树里的元素仍返回 null（与真机一致），其余返回父节点。
     只为让焦点回归有效，不追求布局精度。 */
  Object.defineProperty(w.HTMLElement.prototype, "offsetParent", {
    configurable: true,
    get() {
      if (this === w.document.body || this === w.document.documentElement) return null;
      let p = this.parentNode;
      while (p && p.nodeType === 1) {
        if (String(p.className || "").indexOf("hidden") >= 0) return null;
        p = p.parentNode;
      }
      return this.parentNode && this.parentNode.nodeType === 1 ? this.parentNode : w.document.body;
    },
  });
  return w;
}

/* 劫持 setInterval / clearInterval 记账。
   为什么不用「检查 window.__xxTimer」：那要求每个玩法都自觉地把手柄挂出去，
   英语限时挑战就漏过一次。这里从源头记账，谁新建了没清都跑不掉。 */
function trackTimers(w) {
  const live = new Set();
  const si = w.setInterval.bind(w);
  const ci = w.clearInterval.bind(w);
  w.setInterval = function (...a) { const id = si(...a); live.add(id); return id; };
  w.clearInterval = function (id) { live.delete(id); return ci(id); };
  return live;
}

function inject(w, files) {
  const errs = [], missing = [];
  for (const f of files) {
    const abs = path.join(ROOT, f);
    if (!fs.existsSync(abs)) { missing.push(f); continue; }
    try {
      const s = w.document.createElement("script");
      s.textContent = fs.readFileSync(abs, "utf8");
      w.document.body.appendChild(s);
    } catch (e) { errs.push(f + ": " + e.message); }
  }
  return { errs, missing };
}

const html = (w) => {
  const a = w.document.getElementById("app");
  return a ? a.innerHTML : "";
};
const undefCount = (s) => (s.match(/undefined/g) || []).length;

function chkPage(w, tag) {
  const h = html(w);
  const n = undefCount(h);
  if (n) {
    console.log("  ❌ " + tag.padEnd(16) + " len=" + h.length + "  undefined×" + n);
    h.split("\n").forEach((l) => { if (/undefined/.test(l)) console.log("      > " + l.trim().slice(0, 160)); });
    FAILS.push(tag + " 渲染出现 undefined×" + n);
  } else {
    console.log("  ✅ " + tag.padEnd(16) + " len=" + h.length);
  }
  return h;
}

/* ---------------- 选学科页 ---------------- */
async function runPicker() {
  console.log("\n════════ 选学科页 picker ════════");
  const files = MAN.HOST_JS;
  const w = mkWindow();
  const errs = [];
  w.addEventListener("error", (e) => errs.push(e.message));
  const live = trackTimers(w);
  const picked = [];
  w.__setSubject = (k) => picked.push(k);

  const { errs: injErrs, missing } = inject(w, files);
  chk(missing.length === 0, "清单里的文件都存在", missing.join(","));
  chk(injErrs.length === 0, "脚本无执行异常", injErrs.slice(0, 2).join(";"));

  const app = w.document.getElementById("app");
  const cards = [...app.querySelectorAll(".subj-card")];
  chk(cards.length === MAN.SUBJ_KEYS.length,
    "渲染出 " + MAN.SUBJ_KEYS.length + " 张学科卡片", "实际 " + cards.length);

  /* ★ 不越界：选学科页绝不能把某一科的 App 全局带出来。
     三棵 App 的顶层变量全是同名的（MODES / state / render / speak 一字不差），
     只要有一个漏进来，后面 reload 进学科时就是互相覆盖的鬼故事。 */
  /* 注意别把 app 列进来 —— index.html 里有 <div id="app">，
     带 id 的元素会自己变成 window 的同名属性，那不是 App 泄漏。 */
  const leaked = ["render", "startGame", "GAMES", "MODES", "GRADES", "state", "speak"]
    .filter((k) => typeof w[k] !== "undefined" && !w.document.getElementById(k));
  chk(leaked.length === 0, "没有夹带任何学科 App 的全局变量", leaked.join(","));

  /* 只注入了 HOST_JS：清单里就不该出现学科文件 */
  const subjectFiles = files.filter((f) => /^(cn|math|en)\//.test(f));
  chk(subjectFiles.length === 0, "注入清单里不含学科文件", subjectFiles.join(","));

  chk(typeof w.__renderSubjectPicker === "function", "暴露 __renderSubjectPicker");
  chk(typeof w.tvBack === "function" && w.tvBack() === false,
    "tvBack() 返回 false（按返回退出 App）");
  /* 没有 tvBack 时原生 `window.tvBack ? tvBack() : true` 恒为真 → 按返回没反应，
     就得杀进程重开。2.5.0 之前这一页就是这么卡的。 */

  /* 遥控器：上下移动 + 确认选中 */
  cards[0].focus();
  const pressKey = (key, type) =>
    w.document.dispatchEvent(new w.KeyboardEvent(type || "keydown", { key, bubbles: true }));
  pressKey("ArrowDown"); await sleep(40);
  const moved = w.document.activeElement === cards[1];
  chk(moved, "方向键↓能在卡片之间移动");
  await sleep(260);
  pressKey("Enter"); await sleep(60);
  chk(picked.length === 1, "确认键选中一科", "picked=" + picked.join(","));
  await sleep(260);
  pressKey("Enter"); await sleep(60);
  chk(picked.length === 2, "松开防抖后再按能再选一科", "picked=" + picked.join(","));

  chk(live.size === 0, "没有遗留的 setInterval", "live=" + live.size);
  chk(errs.length === 0, "运行无 JS 报错", errs.slice(0, 2).join(";"));
}

/* ---------------- 某一科 ---------------- */
async function runSubject(key) {
  console.log("\n════════ " + NAME[key] + "（" + key + "）════════");
  const files = MAN.fullFor(key);
  const w = mkWindow();
  const errs = [];
  w.addEventListener("error", (e) => errs.push(e.message));
  const live = trackTimers(w);

  const { errs: injErrs, missing } = inject(w, files);
  chk(missing.length === 0, "boot.js 清单里的文件都存在", missing.join(","));
  chk(injErrs.length === 0, "脚本无执行异常", injErrs.slice(0, 2).join(";"));
  /* tv.js 见 document.readyState 还是 loading 时会挂在 DOMContentLoaded 上，
     不缓一下就会把「tv.js 没生效」的假警报当成产品 bug。 */
  await sleep(80);

  /* ---------- 共享层必须到位 ---------- */
  chk(w.__isTV === true, "共享 tv.js 已生效（__isTV）");
  chk(w.__tvRenderWrapped === true, "tv.js 排在学科 app.js 之后（包住了 render）");
  chk(typeof w.closeTopLayer === "function", "暴露 closeTopLayer（设置才关得掉）");
  chk(typeof w.tvBack === "function", "暴露 tvBack");
  chk(typeof w.TV_TUNE === "object", "tv-tune.js 先于 tv.js 加载");

  /* ---------- 其它学科的全局变量不许出现 ---------- */
  const others = Object.keys(TIMER_KEY).filter((k) => k !== key);
  const crossRun = others.filter((k) => typeof w[TIMER_KEY[k]] !== "undefined");
  chk(crossRun.length === 0, "没有别的学科的计时器句柄", crossRun.join(","));

  /* ---------- 逐个页面 ---------- */
  console.log("  -- 页面渲染 --");
  chk(typeof w.render === "function", "有 render()");
  chkPage(w, "home");
  try { w.state.view = "grades"; w.render(); } catch (e) { console.log("  ❌ grades 抛异常 " + e.message); FAILS.push(key + " grades throw"); }
  chkPage(w, "grades");
  try { w.state.gi = 0; w.state.bi = 0; w.state.ui = 0; w.state.view = "units"; w.render(); } catch (e) { console.log("  ❌ units 抛异常 " + e.message); FAILS.push(key + " units throw"); }
  chkPage(w, "units");
  try { w.state.view = "modes"; w.render(); } catch (e) { console.log("  ❌ modes 抛异常 " + e.message); FAILS.push(key + " modes throw"); }
  chkPage(w, "modes");

  const list = Array.isArray(w.GAMES) ? w.GAMES : [];
  console.log("  -- 玩法：共 " + list.length + " 个 --");
  chk(list.length > 0, "玩法列表非空");

  /* ---------- 逐个玩法：渲染 + 计时器泄漏 ---------- */
  let leakCount = 0, undefGames = 0;
  const skipped = [];

  /* 一条玩法要测两条退路，缺一条都会漏：
       A 遥控返回 / 原生返回键 → goBack()（会顺手清 __xxTimer 兜底）
       B 玩法自己把界面切走（点了玩法内的返回按钮，不经过 goBack）
     B 这条才是 self-destruct tick 守卫真正管的场景 ——
     只有 goBack 会清句柄，别的退路全靠玩法自己发现「界面已经不是我了」，
     否则计时器比页面活得久，过几秒又把画面刷回去。 */
  async function runOne(g, exit) {
    const base = live.size;
    let created = 0;
    try { w.startGame(g.id); } catch (e) { skipped.push(g.id + "(" + e.message.slice(0, 40) + ")"); return null; }
    const n = undefCount(html(w));
    created = live.size - base;
    if (n) {
      undefGames++;
      console.log("  ❌ game:" + g.id + " undefined×" + n);
      FAILS.push(key + " 玩法 " + g.id + " 渲染出现 undefined×" + n);
    }
    if (created === 0) return { created: 0, leaked: 0, hijacked: false };
    exit();
    await sleep(2400);
    const leaked = live.size - base;
    const hijacked = w.state.view === "game";
    return { created, leaked, hijacked };
  }

  for (const g of list) {
    const a = await runOne(g, () => { w.goBack(); });
    if (!a) continue;                       // 起不来（多为 canvas），跳过
    if (a.created === 0) { console.log("  ✅ game:" + g.id + "（无限时）"); continue; }
    if (a.leaked > 0 || a.hijacked) {
      leakCount++;
      console.log("  ❌ game:" + g.id + " 返回键退出后残留计时器 " + a.leaked
        + (a.hijacked ? "，且界面被抢回玩法" : ""));
      FAILS.push(key + " 玩法 " + g.id + " 返回键退出后计时器泄漏 " + a.leaked);
    } else {
      console.log("  ✅ game:" + g.id + " 返回键退出，计时器已收（新建 " + a.created + " → 残留 0）");
    }
    const b = await runOne(g, () => { w.state.view = "modes"; w.render(); });
    if (b && (b.leaked > 0 || b.hijacked)) {
      leakCount++;
      console.log("  ❌ game:" + g.id + " 自行切页后残留计时器 " + b.leaked
        + (b.hijacked ? "，且界面被抢回玩法" : ""));
      FAILS.push(key + " 玩法 " + g.id + " 自行切页后计时器泄漏 " + b.leaked + "（tick 缺自毁守卫？）");
    } else if (b) {
      console.log("  ✅ game:" + g.id + " 自行切页，计时器自己停了（tick 自毁守卫生效）");
    }
    /* 场景 B 是「绕过 __gameExit 硬切页」，会把它留成旧的；
       不清掉的话，下一个玩法（甚至兜底清柄那条检查）会被这个旧钩子截住，
       表现出与本玩法无关的现象 —— 测试结果互相污染。 */
    w.__gameExit = null;
    w.state.mode = null;
    w.state.view = "modes";
  }
  chk(leakCount === 0, "所有限时玩法退出后都不留计时器", "泄漏 " + leakCount + " 个玩法");
  chk(undefGames === 0, "所有玩法渲染无 undefined", "异常 " + undefGames + " 个");

  /* ---------- 兜底清柄 ---------- */
  const tk = TIMER_KEY[key];
  if (tk) {
    w[tk] = w.setInterval(() => {}, 1000);
    try { w.goBack(); } catch (e) {}
    chk(w[tk] === null, "goBack() 兜底清掉 " + tk);
  }

  /* ---------- 遥控器回归 ---------- */
  await tvRegression(w, key);

  chk(errs.length === 0, "运行无 JS 报错", errs.slice(0, 3).join(";"));
  if (skipped.length) warn("以下玩法未能启动（多为 canvas / 依赖真实环境）：" + skipped.join(", "));
}

/* ---------------- 遥控器回归（三科共用同一套断言）---------------- */
async function tvRegression(w, key) {
  console.log("  -- 遥控器回归 --");
  const doc = w.document;
  const modal = doc.getElementById("settingsModal");
  const isHidden = () => String(modal.className).indexOf("hidden") >= 0;
  const act = () => doc.activeElement;
  const press = (k, t) => doc.dispatchEvent(new w.KeyboardEvent(t || "keydown", { key: k, bubbles: true }));
  const pressCode = (kc, t) => {
    const ev = new w.KeyboardEvent(t || "keydown", { key: "Unidentified", bubbles: true, cancelable: true });
    Object.defineProperty(ev, "keyCode", { get: () => kc, configurable: true });
    Object.defineProperty(ev, "which", { get: () => kc, configurable: true });
    doc.dispatchEvent(ev);
  };

  try {
    /* ① 设置弹层开着时，返回键关的是弹层，不是背后的页面 */
    w.state.view = "modes"; w.render(); await sleep(30);
    w.openSettings(); await sleep(50);
    const viewBefore = w.state.view;
    w.goBack(); await sleep(40);
    chk(isHidden(), "返回键能关掉设置弹层");
    chk(w.state.view === viewBefore, "关弹层那一次不会连带退页", viewBefore + "→" + w.state.view);

    /* ② 焦点困死回归：语速滑块 / 备份文本框里，上下键必须跳得出来。
       旧写法 `if (act.tagName === "INPUT") return;` 会让方向键全部放行，
       遥控器彻底停摆 —— 用户只能杀进程重开（2026-09-20 反馈）。 */
    const range = doc.getElementById("rateRange");
    const backup = doc.getElementById("backupBox");
    const scenarios = [
      ["Escape", (t) => press("Escape", t)],
      ["GoBack", (t) => press("GoBack", t)],
      ["Backspace", (t) => press("Backspace", t)],
      ["keyCode 4", (t) => pressCode(4, t)],
      ["keyCode 461", (t) => pressCode(461, t)],
      ["keyCode 0", (t) => pressCode(0, t)],
    ];
    const failed = [];
    let backOk = 0;
    for (const [label, fire] of scenarios) {
      for (const target of [range, backup]) {
        w.openSettings(); await sleep(30);
        if (isHidden()) { failed.push(label + "（弹层没打开）"); continue; }
        try { target.focus(); } catch (e) {}
        fire("keydown"); await sleep(30);
        if (isHidden()) backOk++; else failed.push(label + "@" + (target.id || target.tagName));
      }
    }
    chk(failed.length === 0, "各种返回键形态都能关掉设置", failed.join(", ") || (backOk + "/" + scenarios.length * 2));

    await sleep(400);
    w.openSettings(); await sleep(30);
    try { range.focus(); } catch (e) {}
    press("Escape", "keyup"); await sleep(30);
    chk(isHidden(), "只在 keyup 派发返回键时也能关闭");

    w.openSettings(); await sleep(50);
    try { range.focus(); } catch (e) {}
    const stuckEl = act();
    let escaped = false;
    for (let i = 0; i < 4 && !escaped; i++) {
      press("ArrowDown"); await sleep(40);
      const a = act();
      if (a !== stuckEl && !(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || ""))) escaped = true;
    }
    chk(escaped, "焦点能从表单控件里跳出来");

    /* ③ 导出备份不能把焦点抢进文本框（TV 上等于锁死遥控器） */
    w.openSettings(); await sleep(30);
    try { w.exportProgress(); } catch (e) {}
    await sleep(40);
    const af = act();
    chk(!(af && /^(INPUT|TEXTAREA|SELECT)$/.test(af.tagName || "")),
      "导出备份没把焦点锁进文本框", af ? af.id || af.tagName : "null");
    if (!isHidden()) w.closeSettings();

    /* ④ 一次按键只退一层：keydown 关掉弹层后，紧随的 keyup 不能再退一次 */
    w.openSettings(); await sleep(30);
    let calls = 0;
    const orig = w.tvBack;
    w.tvBack = function () { calls++; return true; };
    try { range.focus(); } catch (e) {}
    press("Escape", "keydown"); await sleep(30);
    press("Escape", "keyup"); await sleep(30);
    try { w.tvBack = orig; } catch (e) { delete w.tvBack; }
    chk(calls === 0, "一次返回键只关一层", "多退了 " + calls + " 层");
    if (!isHidden()) w.closeSettings();

    /* ⑤ 切页后焦点必须复位，不能停在顶栏按钮上 */
    const isTopbar = (el) => {
      let p = el, i = 0;
      while (p && p.nodeType === 1 && i < 5) {
        if (String(p.className || "").indexOf("topbar") >= 0) return true;
        p = p.parentNode; i++;
      }
      return false;
    };
    let onTop = 0, checked = 0;
    const checkView = async (label) => {
      await sleep(40);
      const a = act(); checked++;
      if (a && isTopbar(a)) {
        onTop++;
        console.log("      ❌ " + label + " 焦点停在顶栏（" + (a.className || a.tagName) + "）");
      }
    };
    for (const v of ["home", "grades", "units", "modes"]) { w.state.view = v; w.render(); await checkView(v); }
    for (const g of (w.GAMES || [])) {
      try { w.startGame(g.id); } catch (e) { continue; }
      await checkView("game:" + g.id);
    }
    chk(onTop === 0, "各界面焦点没有落在顶栏按钮上", onTop + "/" + checked);

    /* ⑥ 顶栏必须有 🛠️ 热更自检入口，且方向键够得到。
       电视上没有控制台、没有别的地方能触发重下载 ——
       入口没了，真出问题就只能重新推 APK。 */
    w.state.view = "home"; w.render(); await sleep(50);
    const gears = [...doc.querySelectorAll("#app .topbar .gear")];
    const hot = doc.querySelector("#app .topbar .gear.hot");
    chk(!!hot, "顶栏有 🛠️ 热更自检按钮", "顶栏齿轮数=" + gears.length);
    if (hot) chk(typeof w.renderHotDiag === "function", "renderHotDiag() 可用（点了有东西看）");

    /* ⑦ 确认键：一次按下只能触发一次 */
    w.state.view = "modes"; w.render(); await sleep(30);
    const card = doc.querySelector(".mode-card");
    if (card && card.focus) {
      card.focus();
      let hits = 0;
      card.onclick = function () { hits++; };
      const enter = (rep) => {
        const e = new w.KeyboardEvent("keydown", { key: "Enter", keyCode: 13, bubbles: true, cancelable: true });
        try { Object.defineProperty(e, "repeat", { value: !!rep }); } catch (err) {}
        doc.dispatchEvent(e);
      };
      enter(false); const one = hits;
      await sleep(260);
      enter(false); const two = hits;
      await sleep(260);
      enter(true); enter(true); const three = hits;
      chk(one === 1 && two === 2 && three === 2,
        "确认键一次按下一步一下", one + "/" + two + "/" + three + "（应 1/2/2）");
    }
  } catch (e) {
    console.log("  ❌ 遥控器回归抛异常 " + e.message);
    FAILS.push(key + " 遥控器回归抛异常: " + e.message);
  }
}

/* ---------------- 静态检查：跨科串台 ---------------- */
function staticChecks() {
  console.log("\n════════ 静态检查 ════════");

  /* ① 某科的 js 里不许出现别科的计时器句柄 / 进度键。
     真串台的表现非常隐蔽：数学限时挑战跑着跑着把语文的计时器句柄覆盖了，
     语文退出时清不掉自己的计时器 —— 界面开始自己跳。 */
  for (const key of MAN.SUBJ_KEYS) {
    for (const f of MAN.BUILTIN[key]) {
      const abs = path.join(ROOT, f);
      if (!fs.existsSync(abs)) continue;
      const src = fs.readFileSync(abs, "utf8");
      for (const other of MAN.SUBJ_KEYS) {
        if (other === key) continue;
        const marks = [TIMER_KEY[other], PROGRESS_KEY[other]];
        for (const mk of marks) {
          if (src.indexOf(mk) >= 0) {
            chk(false, key + " 的文件引用了别科的 " + mk, f);
          }
        }
      }
    }
  }
  chk(true, "各科没有引用别科的计时器 / 进度键");

  /* ② boot.js 的 planPicker 只能碰 HOST_JS。
     早年给它开过「允许新增根目录 js」的口子，结果把陈旧的 js/app.js 也捞了进来，
     选学科页直接被语文 App 覆盖。这里守住这条线。 */
  const boot = fs.readFileSync(path.join(ROOT, "js", "boot.js"), "utf8");
  const m = boot.match(/function\s+planPicker\s*\([^)]*\)\s*\{[\s\S]*?\n  \}/);
  if (!m) {
    warn("没定位到 planPicker()，跳过该项检查");
  } else {
    const body = m[0];
    chk(/HOST_JS/.test(body) && !/BUILTIN|SHARED_JS/.test(body),
      "planPicker 只看 HOST_JS", body.indexOf("BUILTIN") >= 0 || body.indexOf("SHARED_JS") >= 0 ? "混进了学科文件" : "");
  }

  /* ③ 每一科都得有自己的 update.js —— 不然那一科收不到主流更新提示 */
  for (const key of MAN.SUBJ_KEYS) {
    chk(MAN.BUILTIN[key].some((f) => /update\.js$/.test(f)), NAME[key] + " 的清单里有 update.js");
  }
  /* ④ update.js 是学科级、boot.js 是冻结文件：任何热更包都不许带 boot.js */
  chk(!MAN.allDeclared().has("js/boot.js"), "boot.js 不在任何清单里（它是冻结文件）");
}

/* ---------------- main ---------------- */
(async () => {
  const argv = process.argv.slice(2).filter((a) => !a.startsWith("-"));
  const want = argv.length ? argv.filter((a) => a === "picker" || MAN.SUBJ_KEYS.includes(a)) : [...MAN.SUBJ_KEYS, "picker"];
  if (!want.length) {
    console.error("❌ 没有可跑的模式。可用：" + [...MAN.SUBJ_KEYS, "picker"].join(" / "));
    process.exit(2);
  }
  console.log("smoke：跑 " + want.map((k) => NAME[k] || k).join(" / "));
  console.log("清单：picker=" + MAN.HOST_JS.length + " 文件，共享层=" + MAN.SHARED_JS.length + " 文件，"
    + MAN.SUBJ_KEYS.map((k) => NAME[k] + "=" + MAN.BUILTIN[k].length).join("，"));

  staticChecks();
  for (const k of want) {
    if (k === "picker") await runPicker();
    else await runSubject(k);
  }

  console.log("\n════════ 总结 ════════");
  if (FAILS.length) {
    console.log("❌ 失败 " + FAILS.length + " 项：");
    FAILS.forEach((f) => console.log("   · " + f));
  } else {
    console.log("✅ 全部通过（" + want.length + " 个模式）");
  }
  if (WARN.length) console.log("⚠️  提醒 " + WARN.length + " 条：\n   · " + WARN.join("\n   · "));
  process.exit(FAILS.length ? 1 : 0);
})();
