import { defineCollection, reference, z } from 'astro:content';
import { glob } from 'astro/loaders';

/** 分类同时用作面包屑第三级与项目页 tab */
export const CATEGORIES = ['设计', '开发', '灵感', '其他'] as const;

const posts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/posts' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string().max(160),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      category: z.enum(CATEGORIES).default('设计'),
      tags: z.array(z.string()).default([]),
      cover: image().optional(),
      coverAlt: z.string().optional(),
      draft: z.boolean().default(false),
      related: z.array(reference('posts')).optional(),
    }),
});

const projects = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      category: z.enum(CATEGORIES),
      cover: image(),
      coverAlt: z.string().optional(),
      date: z.coerce.date(),
      tags: z.array(z.string()).default([]),
      link: z.string().url().optional(),
      featured: z.boolean().default(false),
      draft: z.boolean().default(false),
    }),
});

const status = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/status' }),
  schema: z.object({
    date: z.coerce.date(),
    mood: z.string().optional(),
    pinned: z.boolean().default(false),
  }),
});

export const collections = { posts, projects, status };
