#!/usr/bin/env node
/* ===================== fetch-book.mjs · 抓人教社教材整册页面图 =====================
 * 用法：
 *   node tools/fetch-book.mjs --book 1211001101241              # 语文一上（thumb）
 *   node tools/fetch-book.mjs --book 1211001301241 --kind large # 三上，整页大图
 *   node tools/fetch-book.mjs --probe 1211001101241             # 只探测页数，不下载
 *
 * 输出：tmp/pep/<bookid>/<kind>/N.jpg + tmp/pep/<bookid>/meta.json
 * 断点续传：已存在且合法的页直接跳过，反复跑没副作用。
 * ================================================================================ */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { downloadBook, probeRange, HEADERS } from './lib/pep.mjs';

const argv = process.argv.slice(2);
const opt = (n, d) => {
  const i = argv.indexOf('--' + n);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
};
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, opt('out', 'tmp/pep'));
const bookId = opt('book', '');
const kind = opt('kind', 'thumb');

if (!bookId) {
  console.error('用法：node tools/fetch-book.mjs --book <bookid> [--kind thumb|page|large] [--probe]');
  console.error('常用 bookid：一上 1211001101241 · 一下 1211001102241 · 二上 1211001201241 · 二下 1211001202251');
  console.error('            三上 1211001301241 · 三下 1211001302251 · 四上 1211001401261 · 四下 1211001402191 · 五上 1211001501261');
  process.exit(1);
}

if (argv.includes('--probe')) {
  const r = await probeRange(bookId, kind);
  console.log(`${bookId} [${kind}] → ${r.last} 页${r.holes.length ? `，空洞: ${r.holes.join(',')}` : ''}`);
  process.exit(0);
}

console.log(`抓取 ${bookId} [${kind}] → ${path.relative(ROOT, OUT)}`);
const t0 = Date.now();
const meta = await downloadBook(bookId, OUT, { kind });
const sec = ((Date.now() - t0) / 1000).toFixed(0);
console.log(`✅ 新下载 ${meta.downloaded} · 已存在跳过 ${meta.skippedExisting} · 失败 ${meta.failed.length} · 用时 ${sec}s`);
if (meta.failed.length) console.log('   失败页: ' + meta.failed.join(','));
console.log(`   meta → tmp/pep/${bookId}/meta.json`);
