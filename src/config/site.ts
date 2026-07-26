/**
 * 站点身份与全局配置 —— 唯一占位内容源。
 * 「三页」等身份信息来自设计效果图，正式上线前在此一处替换即可。
 * SITE.url 需与 astro.config.mjs 的 site 保持一致。
 */

export const SITE = {
  name: '三页',
  title: '三页的书桌',
  description:
    '一个私人的数字书桌 / 学习空间博客。在宁静、专注、可探索的环境中记录与思考。',
  url: 'https://sanye.design',
  email: 'hello@sanye.design',
  location: '中国 · 杭州',
  roles: ['产品设计师', '独立开发者', '内容创作者'],
  bio: '专注于数字产品设计与体验思考，喜欢把复杂的想法，变成简单温暖的界面。',
  motto: '这是一张属于我的书桌，也是我与世界对话的方式。',
} as const;

export const NAV = [
  { label: '笔记', href: '/posts/' },
  { label: '项目', href: '/projects/' },
  { label: '归档', href: '/archive/' },
  { label: '状态', href: '/status/' },
  { label: '关于', href: '/about/' },
] as const;

export const SOCIALS = [
  { label: '邮箱', value: SITE.email, href: `mailto:${SITE.email}` },
  { label: '网站', value: 'sanye.design', href: SITE.url },
  { label: '微博', value: '@三页设计', href: 'https://weibo.com/' },
  { label: '公众号', value: '三页设计笔记' },
] as const;

/** 便签快捷链接（书桌上的便签热点内容） */
export const NOTES = [
  { label: '写作习惯的养成', href: '/posts/writing-habit/', external: false },
  { label: '阅读清单', href: '/projects/', external: false },
  { label: 'MDN Web Docs', href: 'https://developer.mozilla.org/', external: true },
  { label: 'Three.js 文档', href: 'https://threejs.org/docs/', external: true },
  { label: '待办：给日历页加上季节配色', href: null, external: false },
] as const;

/** 评论配置：v1 关闭，后续可切换为 giscus */
export const COMMENTS = {
  provider: 'none' as 'none' | 'giscus',
};
