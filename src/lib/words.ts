import type { CollectionEntry } from 'astro:content';
import { countWords } from './remark-word-count.mjs';

export { countWords };

/** 判断两个日期是否同一天（本地时区） */
export function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * 「今日已写 N 字」：以最新一条状态的日期为「今日」，
 * 统计当日发布的 posts + status 正文字数（构建期快照）。
 */
export function wordsWrittenOn(
  day: Date,
  posts: CollectionEntry<'posts'>[],
  statuses: CollectionEntry<'status'>[],
): number {
  let total = 0;
  for (const p of posts) {
    if (sameDay(p.data.pubDate, day)) total += countWords(p.body ?? '');
  }
  for (const s of statuses) {
    if (sameDay(s.data.date, day)) total += countWords(s.body ?? '');
  }
  return total;
}
