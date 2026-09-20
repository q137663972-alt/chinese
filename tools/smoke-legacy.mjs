#!/usr/bin/env node
/* ===================== tools/smoke-legacy.mjs · 老 APK（2.4.x）桥接冒烟 =====================
 * 用法：node tools/smoke-legacy.mjs
 *
 * 测什么：老设备上的 boot.js 没有「学科」这套东西，热更又覆盖不到 boot.js。
 *         HOT 兼容层（js/bridge.js + 几个同路径空壳）是让那批设备不用换包
 *         也能用上三科的唯一手段 —— 它一旦破了，表现是「更新了却还是只有语文」。
 *
 * 怎么测：手工复刻老 boot.js 的注入顺序 ——
 *           内置清单（那份把语文写成 js/app.js 根路径的旧清单）
 *         + 老 boot.js 的追加规则（任何 ^js/.+\.js$ 的新文件都塞到队尾）
 *         再把 https://local.hot/ 的请求拦下来喂真实文件内容，跑真正的 bridge.js。
 *
 * ★ 本机 Irp：这条链路一旦只能靠"真机 update 一次看看"来验证，成本就高到没人愿意改，
 *   于是它会悄悄腐烂。这里把它固定成一条命令。
 * ================================================================================== */
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { JSDOM, VirtualConsole } = require("jsdom");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOT = "https://local.hot/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAILS = [];

function chk(cond, label, detail) {
  console.log((cond ? "  ✅ " : "  ❌ ") + label + (detail ? "   " + detail : ""));
  if (!cond) FAILS.push(label + (detail ? " — " + detail : ""));
}

/* 老设备内置的语文文件（根路径）—— 现在都挪到 cn/ 下了，这里做一次映射 */
const LEGACY_BUILTIN = [
  "js/cp.js", "js/data-c1.js", "js/data-c2.js", "js/data-c3.js",
  "js/data-c4.js", "js/data-c5.js", "js/data-c6.js", "js/strokes.js",
  "js/data-poem.js", "js/data-word.js", "js/tts.js", "js/praise.js",
  "js/pics.js",
  "js/games.js",          /* 资源包会把它顶成空壳 */
  "js/game-battle.js",    /* 同上 */
  "js/app.js",            /* 同上 */
  "js/tv-tune.js",
  "js/tv.js",
  "js/update.js",         /* 同上 */
];
/* 旧路径 → 仓库里的真实文件；顶成空壳的那几个指向 legacy/ */
const STUBS = LEGACY_BUILTIN              /* 资源包把这些同路径文件顶成了空壳 */
  .filter((p) => p !== "js/tv-tune.js" && p !== "js/tv.js");
const OLD2NEW = (p) => {
  if (STUBS.indexOf(p) >= 0) return path.join("legacy", p);   /* 已被资源包顶成空壳 */
  if (fs.existsSync(path.join(ROOT, p))) return p;            /* 共享层（tv.js 等）仍在根目录 */
  return path.join("cn", p);                                  /* js/xxx.js → cn/js/xxx.js */
};

function quietConsole() {
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => {
    if (e && /^Not implemented/.test(String(e.message))) return;
    console.log("  [jsdom] " + (e && e.message ? e.message : e));
  });
  vc.on("error", (m) => console.log("  [err] " + m));
  return vc;
}

/* 老设备的 index.html：直接从 git 历史里取，别靠手抄 ——
   手抄版少一个 #ttsSwitch 之类的小节点，测出来的报错全是假阳性。 */
const LEGACY_HTML = fs
  .readFileSync(path.join(ROOT, "tools/fixtures/legacy-index.html"), "utf8")
  .replace(/<script src="js\/boot\.js"><\/script>/, "");

function mkWindow(subj) {
  const dom = new JSDOM(LEGACY_HTML, {
    runScripts: "dangerously", pretendToBeVisual: true,
    url: "http://local.test/index.html", virtualConsole: quietConsole(),
  });
  const w = dom.window;
  Object.defineProperty(w.navigator, "userAgent", {
    value: "Mozilla/5.0 (Linux; Android 8.0; zhongxing B860AV) AppleWebKit/537.36 Chrome/62",
    configurable: true,
  });
  w.__dev = { tv: true, sw: 1920, touch: false, mic: false, apk: 11, native: true };
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
  if (subj) try { w.localStorage.setItem("app_subject", subj); } catch (e) {}

  /* ★ 重复执行检测：同一份学科 App 被执行两遍时，最典型的症状就是
        「同一段函数体挂到同一个对象、同一个事件上两次」—— 点一下走两步。
        这正是那几个同路径空壳存在的全部理由，必须能被断言出来。
        判据用函数源码文本：同一个文件跑两遍得到的两个匿名函数，源码是一模一样的。 */
  w.__dupListeners = new Map();
  const origAdd = w.EventTarget.prototype.addEventListener;
  w.EventTarget.prototype.addEventListener = function (t, f, o) {
    try {
      if (typeof f === "function") {
        const k = t + "|" + String(f);
        w.__dupListeners.set(k, (w.__dupListeners.get(k) || 0) + 1);
      }
    } catch (e) {}
    return origAdd.call(this, t, f, o);
  };

  /* 把 https://local.hot/ 的请求拦下来喂本地文件（模拟原生虚拟域）。
     ★ 这里必须走回调异步发出去 —— bridge.js 是靠 onload 串起加载顺序的，
       同步执行会让「顺序加载」这件事失去被验证的机会（写成乱序也测不出来）。 */
  const origAppend = w.document.head.appendChild.bind(w.document.head);
  w.document.head.appendChild = function (node) {
    if (node && node.tagName === "SCRIPT" && String(node.src || "").indexOf(HOT) === 0) {
      const p = String(node.src).slice(HOT.length).split("?")[0];
      const abs = path.join(ROOT, LEGACY_STUB_MAP[p] || p);
      setTimeout(() => {
        if (!fs.existsSync(abs)) {
          if (node.onerror) node.onerror(new Error("missing " + p));
          return;
        }
        try {
          const s2 = w.document.createElement("script");
          s2.textContent = fs.readFileSync(abs, "utf8");
          w.document.body.appendChild(s2);
        } catch (e) {}
        if (node.onload) node.onload();
      }, 0);
      return node;
    }
    return origAppend(node);
  };
  return w;
}
/* 资源包里那几个被顶成空壳的路径：桥接层加载器请求时要给出真实源码 */
const LEGACY_STUB_MAP = {
  /* 桥接层请求的是 cn/js/* 等真实路径，无需映射；这里留给将来新增的换名文件 */
};

function runInline(w, repoPath) {
  const abs = path.join(ROOT, repoPath);
  if (!fs.existsSync(abs)) return "missing:" + repoPath;
  try {
    const s = w.document.createElement("script");
    s.textContent = fs.readFileSync(abs, "utf8");
    w.document.body.appendChild(s);
    return "";
  } catch (e) { return repoPath + ": " + e.message; }
}

const htmlOf = (w) => {
  const a = w.document.getElementById("app");
  return a ? a.innerHTML : "";
};

async function main() {
  console.log("══════════ 老 APK（2.4.x）三科桥接冒烟 ══════════");

  /* ---------- ① 没选过学科 → 应当出现三张卡片 ---------- */
  console.log("\n──── ① 选学科页 ────");
  let w = mkWindow("");
  let bad = LEGACY_BUILTIN.map((p) => runInline(w, OLD2NEW(p))).filter(Boolean);
  chk(bad.length === 0, "老内置清单注入无异常", bad.slice(0, 2).join("; "));
  bad = [runInline(w, "legacy/js/bridge.js")].filter(Boolean);
  chk(bad.length === 0, "桥接加载器注入无异常", bad.join("; "));
  /* 老 boot.js 会把资源包里任何新的 js/*.js 追加进来，js/subject.js 也在其中 ——
     漏掉这一步，就测不出「选学科页把学科首页盖掉」这个真事故。 */
  runInline(w, "js/subject.js");
  await sleep(400);
  let h = htmlOf(w);
  const cards = (h.match(/subj-card/g) || []).length;
  chk(cards === 3, "渲染出 3 张学科卡片", "实际 " + cards);
  chk(!/undefined/.test(h), "页面无 undefined");
  chk(typeof w.__setSubject === "function", "__setSubject 可用（换学科底座）");
  chk(typeof w.__pickSubject === "function", "__pickSubject 可用（设置里的换学科）");

  /* ★ 2026-09-20 现场事故（第三条）：进去能看到三张卡，三五秒后自己跳进语文。
     根因是老内置清单第一个 js/app.js（语文主程序）先跑完了，选学科页只是叠在上面，
     被语文的定时器/二次渲染翻回去。
     修法：资源包把根级 js/app.js 换成「看门人」—— 没选学科就渲染选学科页并收工，
     一个学科文件都不加载。
     ★ 断言：等一段时间（足够语文的延迟渲染/定时器发作），选学科页必须还在。
       把看门人改回纯空壳，这一条必红（负向验证过）。 */
  await sleep(1500);
  const h3 = htmlOf(w);
  chk((h3.match(/subj-card/g) || []).length === 3,
      "静置 1.5 秒后选学科页仍在（没被学科代码顶掉）",
      "残留 " + (h3.match(/subj-card/g) || []).length + " 张卡");
  /* ★★ 这条才是本次事故的真靶子（负向验证过：空壳必红）★★
     老 boot.js 的追加规则会把资源包里所有"新的" js/*.js 塞到队尾，
     但**顶掉同路径的那几个（含 js/app.js）不在追加之列** —— 它们是被"覆盖"的。
     真正会跑起来的是 bridge.js；而 bridge.js 在"未选学科"分支里
     绝不能去加载任何一科的 app.js。这里直接盯着"哪个学科文件被执行了"：
       · 看门人失效（改回空壳）时的症状是——语文那一套从别处跑起来、渲染出语文首页，
         把选学科页翻掉。所以断言必须能区分"页面上是哪一屏"。
       · 判据用 .subj-grid（选学科页独有）与各科首页独有的 class。
     同时断言 window.render：它是三科 app.js 的顶层函数，任何一科跑过都会留下它。 */
  const h3b = htmlOf(w);
  chk(/subj-grid/.test(h3b), "选学科页骨架 .subj-grid 还在（没被学科首页替换）");
  chk(!/开始学习/.test(h3b), "页面上没有出现学科首页内容（≠ 自动跳进了某一科）");
  chk(typeof w.render !== "function",
      "未选学科时没有任何学科 App 被执行（window.render 不该存在）",
      "实际 " + typeof w.render);
  chk(typeof w.state === "undefined",
      "未选学科时没有学科全局变量泄漏（window.state 不该存在）",
      "实际 " + typeof w.state);

  /* ★★ 本组的"负向对照"必须在同一段里现做，不能只靠改文件 ★★
     上面那些断言为什么在"看门人改回空壳"时依然全绿？因为这份冒烟把
     老内置清单里的 js/app.js 映射到了 legacy/js/app.js —— 而 legacy/js/app.js
     本身就是看门人，语文那一套**从来没被注进来过**，所以测不出"空壳会怎样"。
     真实老设备上，boot.js 内置清单里的 js/app.js 是原版语文主程序，
     它会被资源包同路径覆盖成"资源包里的那一份"。所以要模拟的是：
       「资源包没有顶掉它时 / 顶成空壳时」会发生什么。
     这里直接把原版语文 app.js（内置资产）注进来复现事故 —— 它必须能把
     选学科页翻掉，这样才证明"看门人"这件事是有意义的、不是自我安慰。 */
  {
    const wBad = mkWindow("");
    LEGACY_BUILTIN.forEach((p) => {
      /* 这一路的 js/app.js 故意用"内置原版"（cn/js/app.js），
         也就是"资源包没顶掉它"的那种现场状态 */
      const target = p === "js/app.js" ? "cn/js/app.js" : OLD2NEW(p);
      runInline(wBad, target);
    });
    runInline(wBad, "legacy/js/bridge.js");
    runInline(wBad, "js/subject.js");
    await sleep(1200);
    const hBad = htmlOf(wBad);
    const cardsBad = (hBad.match(/subj-card/g) || []).length;
    console.log("     ↳ 负向对照（内置原版语文 app.js 未被顶掉）：" +
                "subj-card " + cardsBad + " 张 / render=" + typeof wBad.render);
    /* 这一条不是"要求通过"，而是要求"必须确认到破坏性" ——
       如果连原版语文 app.js 都翻不掉选学科页，说明我们的复刻不真实，
       那么上面那几条绿色断言也就没有说服力。 */
    chk(cardsBad !== 3 || typeof wBad.render === "function",
        "负向对照成立：内置原版语文跑起来确实能破坏选学科页（证明看门人必要）",
        "subj-card " + cardsBad + " / render=" + typeof wBad.render);
  }

  /* ---------- ② 选了数学 → 应当加载数学那一套 ---------- */
  for (const s of ["cn", "math", "en"]) {
    console.log("\n──── ② 已选学科 " + s + " ────");
    const w2 = mkWindow(s);
    const errs = [];
    w2.addEventListener("error", (e) => errs.push(String(e.message)));
    const bad2 = LEGACY_BUILTIN.map((p) => runInline(w2, OLD2NEW(p))).filter(Boolean);
    chk(bad2.length === 0, "老内置清单注入无异常", bad2.slice(0, 2).join("; "));
    chk(runInline(w2, "legacy/js/bridge.js") === "", "桥接加载器注入无异常");
    /* 老 boot.js 的追加规则：资源包里新的根目录 js 一律注入，subject.js 逃不掉。
       它若没有「已经有学科在跑就退场」的守卫，末尾那句无条件 render() 会把
       学科首页整个盖成选学科页 —— 这里早/晚各打一次，两种时序都必须站得住。 */
    runInline(w2, "js/subject.js");
    await sleep(900);
    runInline(w2, "js/subject.js");
    const h2 = htmlOf(w2);
    chk(h2.length > 200, "首页渲染出内容", "len=" + h2.length);
    chk(!/undefined/.test(h2), "页面无 undefined");
    chk(errs.length === 0, "运行期无未捕获异常", errs.slice(0, 2).join("; "));
    chk(!!w2.document.getElementById("bridgeSwitchRow") ||
        !!w2.document.querySelector("#settingsModal .set-row"), "设置里挂上了换学科入口");
    /* 空壳失效（内置那份学科 App 没被顶掉）时会在这里暴露：同一段函数体挂两遍 */
    const dups = [...w2.__dupListeners.entries()].filter(([, n]) => n > 1);
    chk(dups.length === 0, "没有重复挂载的监听器（App 没被执行两遍）",
      dups.slice(0, 2).map(([k, n]) => k.slice(0, 60) + " ×" + n).join(" / "));
    /* 语文那一套没有被重复执行：内置清单里的 app.js 已被空壳顶掉 */
    chk(typeof w2.render === "function", "window.render 就位");
    chk(w2.APP_SUBJECT === s, "window.APP_SUBJECT=" + s, "实际 " + String(w2.APP_SUBJECT));
    /* 选学科页不该在这儿 —— 它一旦盖上来，用户点了学科就被弹回选择页 */
    const cardsLeft = (h2.match(/subj-card/g) || []).length;
    chk(cardsLeft === 0, "学科首页没被选学科页盖掉", "残留 subj-card " + cardsLeft);

    /* ★★ 2026-09-20 现场事故（第四条）：「再进又只剩下语文，而且没有换学科选项」★★
       用户一旦进了某一科就再也回不去 —— 因为换学科入口只在"未选学科"分支里挂过，
       而这个入口在老 index.html 里本来就不存在（它调 window.__pickSubject，
       那个函数只在新版 boot.js 里有；老设备跑的是内置老 boot.js，压根没有）。
       断言：**已选学科**时，换学科入口必须仍然可用（函数在 + 设置弹层里有那一行）。 */
    chk(typeof w2.__pickSubject === "function",
        "已选学科时 __pickSubject 仍可用（回得去选择页）",
        "实际 " + typeof w2.__pickSubject);
    /* 打开设置弹层，看「🔄 换学科」那一行是否会被插进去。
       ★ 判据必须同时看"行存在"与"按钮能调通函数" —— 只判 /换学科/ 会假绿：
         弹层里别处出现同名字样就够了（负向验证抓到的）。 */
    const modal = w2.document.getElementById("settingsModal");
    if (modal) {
      modal.classList.remove("hidden");
      modal.style.display = "block";
      /* bridge.js 是 60ms 捕获阶段 + MutationObserver 双路补的，等一拍 */
      await sleep(250);
      const row = w2.document.getElementById("bridgeSwitchRow");
      chk(!!row, "已选学科时设置面板里插入了「换学科」那一行（#bridgeSwitchRow）",
          "实际 " + (row ? "有" : "没有"));
      if (row) {
        const btn = row.querySelector("button");
        const oc = btn ? String(btn.getAttribute("onclick") || "") : "";
        chk(/__pickSubject/.test(oc),
            "那一行的按钮真的绑到了 __pickSubject（不是个死按钮）", oc.slice(0, 80));
        /* ★ 光看 onclick 字符串不够 —— 它是纯文本，函数不存在也照样写着。
           也不能靠 location.reload（jsdom 里它是只读的，测不出来）。
           用**真实可观察的副作用**判：换学科 = 清掉 app_subject 标记。
           清掉了 + 还调用了 reload（若环境允许）才算真按钮。 */
        const before = w2.localStorage.getItem("app_subject");
        let reloaded = false;
        const origReload = w2.location.reload.bind(w2.location);
        try { w2.location.reload = function () { reloaded = true; }; } catch (e) {}
        try { w2.eval(oc); } catch (e) {}
        const after = w2.localStorage.getItem("app_subject");
        try { w2.location.reload = origReload; } catch (e) {}
        chk(before === s && !after,
            "真按下去会清掉学科标记（确实回到了选学科页的路径）",
            "app_subject: " + JSON.stringify(before) + " → " + JSON.stringify(after) +
            " / reload=" + reloaded);
      }
    }
  }

  console.log("\n" + (FAILS.length ? "❌ 失败 " + FAILS.length + " 项" : "✅ 全部通过"));
  if (FAILS.length) { FAILS.forEach((f) => console.log("   · " + f)); process.exit(1); }
}

main();
