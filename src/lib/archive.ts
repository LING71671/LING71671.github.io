import type { CollectionEntry } from 'astro:content';

type Post = CollectionEntry<'posts'>;

/** 过滤草稿并按发布时间倒序 */
export function publishedPosts(posts: Post[]): Post[] {
  return posts
    .filter((p) => !p.data.draft)
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
}

export interface MonthGroup {
  year: number;
  month: number; // 1-12
  posts: Post[];
}

export interface YearGroup {
  year: number;
  posts: Post[];
}

/** 按「年-月」分组，输入需已排序（倒序），输出保持时间倒序 */
export function groupByMonth(posts: Post[]): MonthGroup[] {
  const map = new Map<string, MonthGroup>();
  for (const p of posts) {
    const y = p.data.pubDate.getFullYear();
    const m = p.data.pubDate.getMonth() + 1;
    const key = `${y}-${m}`;
    if (!map.has(key)) map.set(key, { year: y, month: m, posts: [] });
    map.get(key)!.posts.push(p);
  }
  return [...map.values()];
}

export function groupByYear(posts: Post[]): YearGroup[] {
  const map = new Map<number, YearGroup>();
  for (const p of posts) {
    const y = p.data.pubDate.getFullYear();
    if (!map.has(y)) map.set(y, { year: y, posts: [] });
    map.get(y)!.posts.push(p);
  }
  return [...map.values()];
}

export interface TagGroup {
  tag: string;
  posts: Post[];
}

/** 按标签分组，标签按文章数降序 */
export function groupByTag(posts: Post[]): TagGroup[] {
  const map = new Map<string, TagGroup>();
  for (const p of posts) {
    for (const tag of p.data.tags) {
      if (!map.has(tag)) map.set(tag, { tag, posts: [] });
      map.get(tag)!.posts.push(p);
    }
  }
  return [...map.values()].sort((a, b) => b.posts.length - a.posts.length);
}
