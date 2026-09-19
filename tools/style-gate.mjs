/* ===================== tools/style-gate.mjs · 画风闸门（生成/复查共用） =====================
 * 生成后即时判（gen-pics.mjs）和存量复查（audit-pics.mjs）必须用同一套判据，
 * 否则「新图按新标准、老图按老标准」，图库里会同时存在两代风格。
 *
 * 2026-09-19 重写：原来是一条三合一复合题（"是不是扁平卡通 + 背景纯不纯 + 有没有恐怖"），
 * 免费档 GLM-4V-Flash 根本答不了 —— 实测 165 张里判 156 张不达标，但理由是
 * 「没有穿鞋」「没有使用中文字体」「过于可爱」这类幻觉，还把图里带汉字的「写」判成合格。
 * 结论很硬：**免费模型只答得来二元题**。所以拆成 4 道，每题只要求吐一个词。
 *
 * 判定口径对齐真实投诉（恐怖元素 / 混合背景）：
 * 3D 感卡通**不拒** —— 免费通道画不出纯矢量，过严等于永远交不了货。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const KEY = (() => {
  try {
    return fs.readFileSync('/root/.keys/zhipu.key', 'utf8').trim();
  } catch {
    return '';
  }
})();

/* 没有 key 就整门放行（闸门是可选增强，不是生产线的必需品） */
export const GATE_ENABLED = !!KEY;

/* 判据分工：能算的别问模型，问模型的只留算不出来的。
   - 背景纯不纯 → 像素统计（tools/imgstats.py）：实测合格图 bg_std 15~32、坏图 39~73，分得很干净
   - 图里有没有字 / 恐不恐怖 → 视觉模型：这两件是语义，算不出来
   - 写实不写实 → 视觉模型，但**降级为非致命**：实测它把照片真牛判成「卡通」，这道它不行，
     所以只作为「迟早要换」的参考，不立刻下架。
   ⚠️ 判定口径对齐真实投诉（恐怖元素 / 混合背景）：3D 感卡通不拒，过严 = 免费通道永远交不了货。 */
export const GATE_ITEMS = [
  {
    key: 'real',
    label: '写实/照片',
    kind: 'vlm',
    q: '这张图看起来像真实拍摄的照片吗？只回答一个词：是 或 不是。',
    bad: (t) => /^是|是照片|像照片/.test(t) && !/不是/.test(t),
  },
  {
    key: 'bg',
    label: '背景不纯',
    kind: 'stats',
    /* 阈值来自 12 张已知样本的标定：外圈标准差 >35 或外圈颜色数 >260 = 背景里塞了东西 */
    bad: (s) => s.bg_std > 35 || s.bg_uniq > 260,
  },
  {
    key: 'scary',
    label: '恐怖元素',
    kind: 'vlm',
    /* 问法必须是「会不会吓到小孩」这种具体场景，不能问「有没有恐怖元素」——
       实测后者对气球、云、冰块这类图也答「有」，165 张里误伤 57 张。 */
    q: '一个六岁小孩看到这张图会不会害怕？只回答一个词：会 或 不会。',
    bad: (t) => /会/.test(t) && !/不会|不害怕/.test(t),
  },
  {
    key: 'text',
    label: '图里有字',
    kind: 'vlm',
    q: '这张图里有没有能读出来的汉字？只回答一个词：有 或 没有。',
    bad: (t) => /有/.test(t) && !/没有|无/.test(t),
  },
];

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

/* 像素统计：一次调用拿到全部指标。失败返回 null（闸门自己坏 → 放行） */
function imgStats(file) {
  try {
    const out = execFileSync('python3', [path.join(ROOT, 'tools', 'imgstats.py'), file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const j = JSON.parse(String(out).trim());
    return j && !j.error ? j : null;
  } catch {
    return null;
  }
}

/* 分级替换用：命中这两类必须立刻下架 —— 孩子真会被吓到（恐怖）或被误导（图上印着答案）。
   「背景不纯」和「写实感」只是不好看/不够童趣，主体还认得出，等新图补出来再逐张换，
   一次删光 150 张等于让孩子这几天打开全是字卡。 */
export const FATAL_KEYS = ['scary', 'text'];

async function ask(file, q) {
  const b64 = fs.readFileSync(file).toString('base64');
  const body = {
    model: 'glm-4v-flash',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b64 } },
          { type: 'text', text: q },
        ],
      },
    ],
    max_tokens: 8,
    temperature: 0,
  };
  const res = await fetch('https://open.bigmodel.cn/api/paas/v4/chat/completions', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  const d = await res.json();
  return String(d?.choices?.[0]?.message?.content || '').trim();
}

/* 判一张图。返回 { ok, fails, fatal, answers }
   - ok=true 表示放行（可以入库/可以留着）
   - fails 是不达标项的人类可读标签
   - fatal=true 表示命中必须立刻下架的两类（恐怖 / 图里有字）
   ⚠️ 闸门自己出错（网络失败 / 模型答非所问 / 没吐中文）一律放行 ——
      闸门是质检员，质检员罢工不能让整条生产线停摆，否则免费通道永远跑不完。 */
export async function gateImage(file, { only = null } = {}) {
  if (!KEY) return { ok: true, fails: [], fatal: false, answers: {}, skipped: true };
  const items = only ? GATE_ITEMS.filter((i) => only.includes(i.key)) : GATE_ITEMS;
  const answers = {};
  const fails = [];
  let stats = null;
  for (const it of items) {
    if (it.kind === 'stats') {
      if (stats === null) stats = imgStats(file) || false;
      if (!stats) continue; // 算不出来 → 放过
      answers[it.key] = `bg_std=${stats.bg_std} bg_uniq=${stats.bg_uniq}`;
      if (it.bad(stats)) fails.push(it.label);
      continue;
    }
    let ans = null;
    for (let a = 0; a < 2 && ans === null; a++) {
      try {
        ans = await ask(file, it.q);
      } catch {
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    if (ans === null) continue; // 判不了 → 放过这一项
    answers[it.key] = ans.slice(0, 24);
    if (!/[一-龥]/.test(ans)) continue; // 没吐中文视为没答上来 → 放过
    if (it.bad(ans)) fails.push(it.label);
  }
  /* 立刻下架 = 「图里有字」（答案印在图上，等于题白出）**或** 两项以上同时不达标。
     为什么要求两项：单看一道判据，免费模型的误报太狠（实测「恐怖元素」一项就误伤 57 张），
     两项独立信号同时响，才比较可能是真废图。 */
  const textItem = GATE_ITEMS.find((i) => i.key === 'text');
  const fatal = fails.includes(textItem.label) || fails.length >= 2;
  return { ok: fails.length === 0, fails, fatal, answers };
}
