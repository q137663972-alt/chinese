#!/usr/bin/env node
/**
 * emit-units.mjs —— 导出「年级 / 单元 → 字列表」，给 dedup-check.py 做同单元撞图质检
 * 产出：tmp/units.json
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const win = { GRADES: [] };
for (const f of fs.readdirSync(path.join(ROOT, 'js')).filter((n) => /^data-c\d+\.js$/.test(n)).sort()) {
  new Function('window', fs.readFileSync(path.join(ROOT, 'js', f), 'utf8') + '\n;return window;')(win);
}
const units = [];
for (const g of win.GRADES) {
  for (const b of g.books || []) {
    for (const u of b.u || []) {
      units.push({ g: g.g, book: b.n || '', unit: u.n || '', zs: (u.w || []).map((x) => x.z) });
    }
  }
}
fs.mkdirSync(path.join(ROOT, 'tmp'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'tmp', 'units.json'), JSON.stringify(units));
console.log(`已导出 ${units.length} 个单元 → tmp/units.json`);
