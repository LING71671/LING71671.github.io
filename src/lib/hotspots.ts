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
    hint: '博客文章',
    behavior: 'content',
    partial: '/partials/posts/',
    href: '/posts/',
  },
  monitor: {
    id: 'monitor',
    label: '显示器',
    hint: '项目与作品',
    behavior: 'content',
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
    hint: '关于我',
    behavior: 'content',
    partial: '/partials/about/',
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
    hint: '时间与氛围',
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
