/**
 * 站点身份与全局配置 —— 唯一身份内容源。
 * SITE.url 需与 astro.config.mjs 的 site 保持一致。
 */

export const SITE = {
  name: 'Ling',
  title: 'Ling 的书桌',
  description:
    '一张放在网上的书桌。研究 AI 编码工具的内部实现，做逆向工程的自动化，偶尔写点别的。',
  url: 'https://ling71671.github.io',
  location: 'Paradise',
  roles: ['逆向工程', 'AI 工具', '独立开发'],
  bio: '拆开工具看它怎么工作的人。最近在读 Claude Code 的源码，维护一个逆向工程知识库，写一些自己每天会用的小程序。',
  motto: 'All in the game, all in game.',
} as const;

export const NAV = [
  { label: '笔记', href: '/posts/' },
  { label: '项目', href: '/projects/' },
  { label: '归档', href: '/archive/' },
  { label: '状态', href: '/status/' },
  { label: '关于', href: '/about/' },
] as const;

export const SOCIALS = [
  { label: 'GitHub', value: '@LING71671', href: 'https://github.com/LING71671' },
] as const;

/** 便签快捷链接（书桌上的便签热点内容） */
export const NOTES = [
  { label: 'Open-ClaudeCode 源码考古', href: 'https://github.com/LING71671/Open-ClaudeCode', external: true },
  { label: 'open-reverselab 知识库', href: 'https://github.com/LING71671/open-reverselab', external: true },
  { label: 'Frida 文档', href: 'https://frida.re/docs/home/', external: true },
  { label: 'MCP 协议规范', href: 'https://modelcontextprotocol.io/', external: true },
  { label: '待办：给知识库补 PE 壳的几篇', href: null, external: false },
] as const;

/** 评论配置：v1 关闭，后续可切换为 giscus */
export const COMMENTS = {
  provider: 'none' as 'none' | 'giscus',
};
