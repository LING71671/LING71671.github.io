// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// 站点 URL（与 src/config/site.ts 的 SITE.url 保持一致），换域名时两处同改
export default defineConfig({
  site: 'https://ling71671.github.io',
  integrations: [
    sitemap({
      // partial 片段路由不进 sitemap
      filter: (page) => !page.includes('/partials/'),
    }),
  ],
  vite: {
    build: {
      assetsInlineLimit: 0,
    },
  },
});
