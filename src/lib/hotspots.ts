/**
 * 热点 → 内容 契约表：3D 场景热点 id 与 partial URL / 深链 URL 的唯一映射。
 * 整合层（panel-router）与 3D 场景（HotspotSystem）共同引用此表。
 */

export type HotspotId =
  | 'window'
  | 'lamp'
  | 'monitor'
  | 'calendar'
  | 'coffee'
  | 'notebook'
  | 'drawer'
  | 'sticky';

export type HotspotBehavior =
  /** 打开内容面板（pushState 到真实 URL） */
  | 'content'
  /** 就地阅读：只推近相机，内容渲染在 3D 物体表面（不开面板、不 pushState） */
  | 'in-scene'
  /** 小型弹层（不改 URL，如便签） */
  | 'popover'
  /** 场景状态切换（台灯三档） */
  | 'mode-toggle'
  /** 只弹氛围提示（窗户） */
  | 'ambient-info';

export interface HotspotDef {
  id: HotspotId;
  label: string;
  hint: string;
  behavior: HotspotBehavior;
  /** 面板加载的 partial 片段 URL（content/popover 有） */
  partial?: string;
  /** pushState 的规范深链 URL（content 有） */
  href?: string;
}

export const HOTSPOTS: Record<HotspotId, HotspotDef> = {
  notebook: {
    id: 'notebook',
    label: '笔记本',
    hint: '博客文章 · 就地翻阅',
    // 就地阅读：文章直接渲染在书页上；/posts/ 完整页面与深链仍然可用（SEO）
    behavior: 'in-scene',
    partial: '/partials/posts/',
    href: '/posts/',
  },
  monitor: {
    id: 'monitor',
    label: '显示器',
    hint: '桌面系统 · 屏幕内浏览',
    // 屏幕内操作：内容渲染在 3D 显示器的屏幕里（ScreenOS）；/projects/ 完整页面与深链仍然可用
    behavior: 'in-scene',
    partial: '/partials/projects/',
    href: '/projects/',
  },
  calendar: {
    id: 'calendar',
    label: '日历',
    hint: '归档与时间线',
    behavior: 'content',
    partial: '/partials/archive/',
    href: '/archive/',
  },
  drawer: {
    id: 'drawer',
    label: '抽屉',
    hint: '几件旧物 · 就地翻看',
    // 就地翻看：拉开抽屉后物件可点，彩蛋卡片渲染在 3D 里（不开面板、不 pushState）；
    // /about/ 完整页面仍然可用（SEO 与直接访问）
    behavior: 'in-scene',
    href: '/about/',
  },
  coffee: {
    id: 'coffee',
    label: '咖啡杯',
    hint: '最近状态 / 碎碎念',
    behavior: 'content',
    partial: '/partials/status/',
    href: '/status/',
  },
  sticky: {
    id: 'sticky',
    label: '便签',
    hint: '快速链接 / 临时想法',
    behavior: 'popover',
    partial: '/partials/sticky/',
  },
  lamp: {
    id: 'lamp',
    label: '台灯',
    hint: '昼夜与专注模式',
    behavior: 'mode-toggle',
  },
  window: {
    id: 'window',
    label: '窗户',
    hint: '拉上 / 拉开窗帘',
    behavior: 'ambient-info',
  },
};

/** 文章 slug → partial / 深链 */
export function postPartial(slug: string): string {
  return `/partials/posts/${slug}/`;
}

export function postHref(slug: string): string {
  return `/posts/${slug}/`;
}
