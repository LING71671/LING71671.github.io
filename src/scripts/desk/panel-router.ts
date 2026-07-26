import type { DeskScene } from '../../three/main';
import { HOTSPOTS, postPartial, type HotspotId } from '../../lib/hotspots';
import { withBase } from '../../lib/url';
import { SITE } from '../../config/site';
import type { OverlayFSM } from './overlay-fsm';
import { session, KEYS } from './storage';

/**
 * 面板路由编排：
 * - 打开内容面板 → pushState 到真实内容 URL（地址栏永远可分享可刷新）
 * - 浏览器后退 = 关闭面板；X/ESC 内部调 history.back()，popstate 统一收口
 * - 面板内站内链接 → 换载 partial 再 pushState；外链新标签；/tags 等无 partial 路由整页跳转
 */

interface RouteTarget {
  hotspot: HotspotId;
  partial: string;
  href: string;
}

const LRU_MAX = 10;

export class PanelRouter {
  /** 当前聚焦的热点（面板打开中） */
  private currentHotspot: HotspotId | null = null;
  /** 我们向历史栈压入的深度（>0 时关闭走 history.back） */
  private pushDepth = 0;
  private cache = new Map<string, string>();
  private closing = false;

  constructor(
    private api: DeskScene,
    private overlay: OverlayFSM,
  ) {
    overlay.onRequestClose = () => this.requestClose();

    window.addEventListener('popstate', (e) => void this.onPopState(e));

    // 面板内链接拦截
    document.getElementById('panel-scroll')?.addEventListener('click', (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      const link = target.closest('a[href]');
      if (!(link instanceof HTMLAnchorElement)) return;
      if (link.origin !== location.origin) return; // 外链默认行为（内容里已 target=_blank）

      const route = this.resolveRoute(link.pathname);
      if (route) {
        e.preventDefault();
        void this.navigate(route, true);
        return;
      }
      if (link.pathname === withBase('/') || link.pathname === '/') {
        e.preventDefault();
        this.requestClose();
      }
      // 其余站内链接（/tags 等）整页跳转，离开 3D
    });
  }

  /** pathname → 面板路由（null = 非面板路由） */
  resolveRoute(pathname: string): RouteTarget | null {
    const strip = (p: string) => {
      const base = withBase('/');
      const rel = p.startsWith(base) ? p.slice(base.length - 1) : p;
      return rel.endsWith('/') ? rel : `${rel}/`;
    };
    const path = strip(pathname);

    for (const def of Object.values(HOTSPOTS)) {
      if (def.behavior === 'content' && def.href === path) {
        return { hotspot: def.id, partial: def.partial!, href: def.href };
      }
    }
    const postMatch = path.match(/^\/posts\/([^/]+)\/$/);
    if (postMatch) {
      return {
        hotspot: 'notebook',
        partial: postPartial(postMatch[1]!),
        href: path,
      };
    }
    return null;
  }

  /** 热点点击入口（scene 事件驱动） */
  async openHotspot(id: HotspotId): Promise<void> {
    const def = HOTSPOTS[id];
    if (def.behavior === 'in-scene') {
      // 就地阅读：只推近相机，内容由 3D 场景在物体表面渲染（不开面板、不 pushState）
      session.set(KEYS.lastHotspot, id);
      await this.api.focusHotspot(id);
      return;
    }
    if (def.behavior === 'content') {
      await this.navigate(
        { hotspot: id, partial: def.partial!, href: def.href! },
        true,
      );
    } else if (def.behavior === 'popover') {
      // 便签：小型弹层，不改 URL
      void this.prefetch(def.partial!);
      await this.api.focusHotspot(id);
      this.currentHotspot = id;
      const rect = this.api.anchorRect(id);
      this.overlay.showSkeleton(def.label);
      this.overlay.open(rect, true);
      const html = await this.fetchPartial(def.partial!);
      if (html) this.overlay.setContent(html);
      this.api.setRenderPaused(true);
      session.set(KEYS.lastHotspot, id);
    }
  }

  /** hover 预取 */
  prefetchHotspot(id: HotspotId): void {
    const def = HOTSPOTS[id];
    if (def.partial) void this.prefetch(def.partial);
  }

  /** 打开/切换到目标内容（push=true 时写入历史） */
  private async navigate(route: RouteTarget, push: boolean): Promise<void> {
    void this.prefetch(route.partial);

    const samePanel =
      this.overlay.state === 'open' && this.currentHotspot === route.hotspot;

    if (push) {
      history.pushState(
        { deskPanel: route.hotspot, depth: this.pushDepth + 1 },
        '',
        withBase(route.href),
      );
      this.pushDepth++;
    }

    if (samePanel) {
      // 同一热点内换内容（如笔记列表 → 文章）
      const html = await this.fetchPartial(route.partial);
      if (html) {
        const meta = this.overlay.setContent(html);
        if (meta.title) document.title = `${meta.title} · ${SITE.title}`;
      }
      return;
    }

    // 不同热点：如已有面板先收起（无起点动画，快速淡出）
    if (this.overlay.state === 'open' || this.overlay.state === 'opening') {
      this.api.setRenderPaused(false);
      await this.overlay.close(null);
      await this.api.unfocus();
    }

    this.currentHotspot = route.hotspot;
    session.set(KEYS.lastHotspot, route.hotspot);

    await this.api.focusHotspot(route.hotspot);
    const rect = this.api.anchorRect(route.hotspot);
    const cached = this.cache.get(route.partial);
    if (cached) {
      const meta = this.overlay.setContent(cached);
      if (meta.title) document.title = `${meta.title} · ${SITE.title}`;
    } else {
      this.overlay.showSkeleton(HOTSPOTS[route.hotspot].label);
    }
    this.overlay.open(rect);

    if (!cached) {
      const html = await this.fetchPartial(route.partial);
      if (html) {
        const meta = this.overlay.setContent(html);
        if (meta.title) document.title = `${meta.title} · ${SITE.title}`;
      }
    }
    this.api.setRenderPaused(true);
  }

  /** X / ESC / backdrop：统一走历史栈回退（popstate 收口） */
  requestClose(): void {
    if (this.closing) return;
    if (this.pushDepth > 0) {
      history.back();
    } else {
      void this.doClose();
    }
  }

  private async onPopState(e: PopStateEvent): Promise<void> {
    const route = this.resolveRoute(location.pathname);
    if (!route) {
      // 回到 '/'：关闭面板
      this.pushDepth = 0;
      await this.doClose();
      return;
    }
    // 前进/后退到某个面板路由：从 state 恢复深度，打开或切换（不再 push）
    const state = e.state as { depth?: number } | null;
    this.pushDepth = state?.depth ?? 0;
    await this.navigate(route, false);
  }

  private async doClose(): Promise<void> {
    if (this.overlay.state === 'idle') return;
    this.closing = true;
    this.api.setRenderPaused(false);

    // 收缩回物体当前投影位置（相机可能已环视，重新取）
    const rect = this.currentHotspot
      ? this.api.anchorRect(this.currentHotspot)
      : null;
    await Promise.all([this.overlay.close(rect), this.api.unfocus()]);
    this.currentHotspot = null;
    document.title = SITE.title;
    this.closing = false;
  }

  private async prefetch(partial: string): Promise<void> {
    if (this.cache.has(partial)) return;
    await this.fetchPartial(partial);
  }

  private async fetchPartial(partial: string): Promise<string | null> {
    const cached = this.cache.get(partial);
    if (cached) return cached;
    try {
      const res = await fetch(withBase(partial));
      if (!res.ok) throw new Error(String(res.status));
      const html = await res.text();
      this.cache.set(partial, html);
      // LRU 上限
      if (this.cache.size > LRU_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      return html;
    } catch {
      // 兜底：整页跳转真实 URL，绝不白屏（partial 路径去掉 /partials 前缀即深链）
      const href = partial.replace(/^\/partials/, '');
      location.assign(withBase(href));
      return null;
    }
  }
}
