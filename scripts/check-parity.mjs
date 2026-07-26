/**
 * 契约测试：partial 片段与完整页的 <article> 正文文本必须一致
 * （两者由同一组件渲染，此测试防止未来改版时产生内容漂移）。
 * 用法: node scripts/check-parity.mjs  （需先 astro build）
 */
import { readFileSync } from 'node:fs';

const pairs = [
  ['dist/posts/writing-habit/index.html', 'dist/partials/posts/writing-habit/index.html'],
  ['dist/posts/quiet-afternoon-design-reasons/index.html', 'dist/partials/posts/quiet-afternoon-design-reasons/index.html'],
  ['dist/about/index.html', 'dist/partials/about/index.html'],
  ['dist/archive/index.html', 'dist/partials/archive/index.html'],
];

function extractText(html, selectorHint) {
  const match = html.match(new RegExp(`<${selectorHint}[^>]*>([\\s\\S]*)</${selectorHint}>`));
  if (!match) return null;
  return match[1]
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

let failed = 0;
for (const [fullPath, partialPath] of pairs) {
  const full = readFileSync(fullPath, 'utf8');
  const partial = readFileSync(partialPath, 'utf8');
  const tag = fullPath.includes('/posts/') ? 'article' : 'section';
  const a = extractText(full, tag);
  const b = extractText(partial, tag);
  if (!a || !b) {
    console.error(`✗ 无法提取 <${tag}>: ${fullPath}`);
    failed++;
  } else if (a !== b) {
    console.error(`✗ 内容漂移: ${fullPath}\n  full(${a.length}) != partial(${b.length})`);
    failed++;
  } else {
    console.log(`✓ ${partialPath} (${a.length} chars)`);
  }
}

if (failed) process.exit(1);
console.log('parity OK');
