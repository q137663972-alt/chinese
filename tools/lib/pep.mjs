/* ===================== tools/lib/pep.mjs · 人教社教材抓取库 =====================
 * 人教社「教材电子版」在线阅读器（https://book.pep.com.cn/<bookid>/）是 Flash 翻页书，
 * 但每一页的原图可以直接按序号取：
 *   files/thumb/N.jpg   约 109KB，480×678 —— 建视觉模型用这个就够，省 85% 流量
 *   files/page/N.jpg    约 611KB
 *   files/large/N.jpg   约 756KB —— 裁图用这个（清晰度最好）
 *
 * 两个坑（都是实测踩出来的）：
 *   1. 必须带 Referer: https://jc.pep.com.cn/ 和浏览器 UA，否则 403（Tengine Referer ACL）
 *   2. 不存在的页不是 404，而是 200 + 1689B 的 text/html（软 404）。
 *      判据必须看 content-type 是不是 image/*，体积只做第二道保险。
 * ========================================================================== */
import fs from 'node:fs';
import path from 'node:path';

export const HEADERS = {
  Referer: 'https://jc.pep.com.cn/',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
};

const MIN_IMG_BYTES = 20000; // 软404 的 html 只有 1689B；真实页图最小也有几十 KB

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ── WAF 全局冷却 ──
 * 教材站的人机验证是按「请求频率」概率性触发的（实测：150ms 间隔连续请求必中，
 * 隔 20~30 秒又放行；跟 UA/cookie 无关，纯 IP+频率）。所以不做每页各自的退避，
 * 而是全局冷却：任何一个请求撞到 WAF，所有后续请求一起等冷却结束。 */
let coolUntil = 0;
const WAF_COOL_MS = 30000;

function isWaf(buf) {
  // WAF 页特征：text/html 且 10KB 左右，含 "Page Verification"
  return buf.length > 4000 && buf.length < 20000 && buf.includes('Page Verification');
}

/* 取一页图。成功 → Buffer；彻底失败 → null */
export async function fetchPage(bookId, n, kind = 'thumb', { retries = 4 } = {}) {
  const url = `https://book.pep.com.cn/${bookId}/files/${kind}/${n}.jpg`;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const wait = coolUntil - Date.now();
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      const buf = Buffer.from(await res.arrayBuffer());
      if (ct.startsWith('image/') && buf.length >= MIN_IMG_BYTES) return buf; // 真图
      if (isWaf(buf)) {
        coolUntil = Date.now() + WAF_COOL_MS; // 全局冷却，别再刺激它
        continue;
      }
      return null; // 真软404：200 + 1689B html
    } catch (e) {
      if (attempt === retries) return null;
      await sleep(800 * attempt);
    }
  }
  return null;
}

/* 探测总页数：从 1 线性往后，连续 3 页取不到就停（教材偶有插页空洞） */
export async function probeRange(bookId, kind = 'thumb') {
  let last = 0;
  let missRun = 0;
  const holes = [];
  for (let n = 1; missRun < 3; n++) {
    const buf = await fetchPage(bookId, n, kind, { retries: 2 });
    if (buf) {
      last = n;
      missRun = 0;
    } else {
      if (n > last) holes.push(n);
      missRun++;
    }
    await sleep(1200); // 慢速，别触发 WAF
  }
  return { last, holes };
}

/* 整册下载。断点续传：目标文件已存在且 > MIN_IMG_BYTES 就跳过。
   并发必须为 1 —— 教材站的 WAF 按频率触发，并发只会更快撞墙。 */
export async function downloadBook(bookId, outDir, { kind = 'thumb', gapMs = 2200 } = {}) {
  const dir = path.join(outDir, String(bookId), kind);
  fs.mkdirSync(dir, { recursive: true });
  process.stdout.write(`探测 ${bookId} 页数… `);
  const { last, holes } = await probeRange(bookId, kind);
  console.log(`${last} 页${holes.length ? `（空洞 ${holes.length} 个）` : ''}`);

  let done = 0;
  let skipped = 0;
  let failed = [];

  for (let n = 1; n <= last; n++) {
    const f = path.join(dir, `${n}.jpg`);
    if (fs.existsSync(f) && fs.statSync(f).size > MIN_IMG_BYTES) {
      skipped++;
      continue;
    }
    const buf = await fetchPage(bookId, n, kind);
    if (buf) {
      fs.writeFileSync(f, buf);
      done++;
    } else {
      failed.push(n);
    }
    if (n % 10 === 0) process.stdout.write(`  … ${n}/${last}（新 ${done} 失败 ${failed.length}）\n`);
    await sleep(gapMs);
  }

  const meta = {
    bookId,
    kind,
    pages: last,
    holes,
    downloaded: done,
    skippedExisting: skipped,
    failed,
    fetchedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(outDir, String(bookId), 'meta.json'), JSON.stringify(meta, null, 2));
  return meta;
}
