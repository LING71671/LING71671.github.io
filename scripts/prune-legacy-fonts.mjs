/**
 * 构建后清理：删掉 dist 里的 legacy .woff 字体并从 CSS 中摘掉它们的引用。
 *
 * @fontsource 的 CSS 每个 @font-face 同时列 woff2 与 woff。woff2 自 2018 年起
 * 所有目标浏览器都支持，woff 分片纯属冗余 —— 中日韩字体被切成上百个分片，
 * 这些冗余文件在 dist 里占十几 MB。CSS 里 woff2 排在前面，浏览器本来也不会取 woff。
 *
 * 用法: node scripts/prune-legacy-fonts.mjs [dist 目录=dist]
 */
import { readdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';

const dist = process.argv[2] ?? 'dist';
const assetsDir = join(dist, '_astro');

let entries;
try {
  entries = await readdir(assetsDir);
} catch {
  console.log('prune-legacy-fonts: 没有 _astro 目录，跳过');
  process.exit(0);
}

// 1) 从 CSS 里摘掉 woff（保留 woff2）的 src 片段
const cssFiles = entries.filter((f) => f.endsWith('.css'));
const referenced = new Set();
for (const file of cssFiles) {
  const path = join(assetsDir, file);
  const before = await readFile(path, 'utf8');
  // src: url(a.woff2) format('woff2'), url(a.woff) format('woff');
  const after = before.replace(
    /,\s*url\([^)]*\.woff\)\s*format\((['"])woff\1\)/g,
    '',
  );
  if (after !== before) await writeFile(path, after);
  for (const m of after.matchAll(/url\(([^)]*\.woff)\)/g)) {
    referenced.add(m[1].split('/').pop());
  }
}

// 2) 删掉没人再引用的 .woff
const woffFiles = entries.filter((f) => f.endsWith('.woff'));
let freed = 0;
let removed = 0;
for (const file of woffFiles) {
  if (referenced.has(file)) continue;
  const path = join(assetsDir, file);
  freed += (await stat(path)).size;
  await unlink(path);
  removed++;
}

console.log(
  `prune-legacy-fonts: 删除 ${removed}/${woffFiles.length} 个 legacy woff，省下 ${(freed / 1048576).toFixed(1)}MB`,
);
