/* ===================== tools/lib/boot-manifest.mjs =====================
 * 唯一一处读 js/boot.js 清单的地方。
 *
 * 为什么值得单独抽出来：boot.js 的 BUILTIN_* / SHARED_JS / HOST_JS 决定了一个
 * 文件会不会被 App 真正加载，于是至少三伙人都要读它 ——
 *     tools/gen-pack.mjs  打包前交叉校验「进了包却没人登记」
 *     build-apk.sh        出 APK 前校验「清单里的每个文件都真实存在」
 *     tools/smoke.mjs     冒烟测试按同样顺序注入脚本
 * 各抄一份正则的后果已经发生过一次：三科迁到 cn/ math/ en/ 子目录后，
 * smoke.js 里那份手抄的清单还指着 js/cp.js，测试跑的是一套根本不存在的路径，
 * 却依然绿着 —— 假通过比不过测更危险。
 *
 * 这里同时把它做成「断言式」的：抽不到就直接 fail，宁可在出包之前炸，
 * 也不要让下游静默地读到一个空数组。
 * =================================================================== */
import fs from "node:fs";
import path from "node:path";

/* 从 `var XXX = [ "a.js", "b.js" ];` 里把字符串数组抠出来 */
function grabArray(src, name) {
  const m = src.match(new RegExp("var\\s+" + name + "\\s*=\\s*\\[([\\s\\S]*?)\\]"));
  if (!m) return null;
  const out = [];
  for (const q of m[1].matchAll(/"([^"]+)"|'([^']+)'/g)) out.push(q[1] || q[2]);
  return out;
}

export function readBootManifest(root) {
  const file = path.join(root, "js", "boot.js");
  if (!fs.existsSync(file)) throw new Error("找不到 " + file);
  const src = fs.readFileSync(file, "utf8");

  const pick = (name) => {
    const m = src.match(new RegExp("var\\s+" + name + "\\s*=\\s*\"([^\"]+)\""));
    return m ? m[1] : "";
  };

  const BUILTIN = {};
  for (const k of ["cn", "math", "en"]) {
    BUILTIN[k] = grabArray(src, "BUILTIN_" + k.toUpperCase());
  }
  const SHARED_JS = grabArray(src, "SHARED_JS");
  const HOST_JS = grabArray(src, "HOST_JS");

  const bad = [];
  for (const [k, v] of Object.entries(BUILTIN)) if (!v || !v.length) bad.push("BUILTIN_" + k.toUpperCase());
  if (!SHARED_JS || !SHARED_JS.length) bad.push("SHARED_JS");
  if (!HOST_JS || !HOST_JS.length) bad.push("HOST_JS");
  if (bad.length) throw new Error("js/boot.js 里读不到清单：" + bad.join(" / ") + "（格式改了？同步改本文件）");

  /* 某学科要注入的完整顺序 = 自己的清单 + 共享层。
     必须与 boot.js planFiles() 一致：tv.js 会包装 window.render，必须排在学科 app.js 之后。 */
  const fullFor = (k) => [...(BUILTIN[k] || []), ...SHARED_JS];

  return {
    APP: pick("APP"),
    HOT_TOKEN: pick("HOT_TOKEN"),
    SUBJ_KEYS: Object.keys(BUILTIN),
    BUILTIN,
    SHARED_JS,
    HOST_JS,
    fullFor,
    /* 所有清单展平去重 —— 给交叉校验用 */
    allDeclared() {
      const s = new Set([...HOST_JS, ...SHARED_JS]);
      for (const v of Object.values(BUILTIN)) v.forEach((p) => s.add(p));
      return s;
    },
  };
}
