import type { CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'posts'>;

/**
 * 相关文章：优先 frontmatter 手动指定，其次按标签交集评分，
 * 同分类 +1，不足时用最新文章补齐。
 */
export function relatedPosts(current: Post, all: Post[], limit = 3): Post[] {
  const pool = all.filter((p) => p.id !== current.id);
  const picked: Post[] = [];

  if (current.data.related?.length) {
    for (const ref of current.data.related) {
      const hit = pool.find((p) => p.id === ref.id);
      if (hit) picked.push(hit);
    }
  }

  const tags = new Set(current.data.tags);
  const scored = pool
    .filter((p) => !picked.includes(p))
    .map((p) => {
      let score = p.data.tags.filter((t) => tags.has(t)).length * 2;
      if (p.data.category === current.data.category) score += 1;
      return { p, score };
    })
    .filter(({ score }) => score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || b.p.data.pubDate.valueOf() - a.p.data.pubDate.valueOf(),
    );

  for (const { p } of scored) {
    if (picked.length >= limit) break;
    picked.push(p);
  }

  for (const p of pool) {
    if (picked.length >= limit) break;
    if (!picked.includes(p)) picked.push(p);
  }

  return picked.slice(0, limit);
}
