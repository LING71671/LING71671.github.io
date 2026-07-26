/**
 * 覆盖面板：从物体屏幕位置 FLIP 展开 / 收缩，滚动隔离与焦点管理。
 * 状态：idle → opening → open → closing → idle
 */

export type OverlayState = 'idle' | 'opening' | 'open' | 'closing';

const OPEN_MS = 260;
const CLOSE_MS = 200;
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

export interface OverlayElements {
  backdrop: HTMLElement;
  panel: HTMLElement;
  scroll: HTMLElement;
  title: HTMLElement;
  closeBtn: HTMLElement;
}

export class OverlayFSM {
  state: OverlayState = 'idle';
  private lastFocus: Element | null = null;
  private reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');

  onRequestClose: (() => void) | null = null;

  constructor(private el: OverlayElements) {
    el.closeBtn.addEventListener('click', () => this.onRequestClose?.());
    el.backdrop.addEventListener('click', () => this.onRequestClose?.());
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && (this.state === 'open' || this.state === 'opening')) {
        this.onRequestClose?.();
      }
    });
    // 面板内滚动不传导到场景
    el.scroll.style.overscrollBehavior = 'contain';
  }

  /** 注入片段 HTML，返回 panel-meta（title/url） */
  setContent(html: string): { title?: string; url?: string } {
    this.el.scroll.innerHTML = html;
    this.el.scroll.scrollTop = 0;
    let meta: { title?: string; url?: string } = {};
    const metaEl = this.el.scroll.querySelector('script[data-panel-meta]');
    if (metaEl?.textContent) {
      try {
        meta = JSON.parse(metaEl.textContent);
      } catch {
        /* 忽略坏数据 */
      }
    }
    if (meta.title) this.el.title.textContent = meta.title;
    return meta;
  }

  showSkeleton(title: string): void {
    this.el.title.textContent = title;
    this.el.scroll.innerHTML =
      '<div class="panel-skeleton" aria-hidden="true">' +
      '<div class="sk sk-title"></div><div class="sk"></div><div class="sk"></div>' +
      '<div class="sk sk-short"></div><div class="sk"></div><div class="sk sk-short"></div>' +
      '</div>';
  }

  /** 从屏幕矩形（物体投影）展开面板 */
  open(origin: DOMRectReadOnly | null, popover = false): void {
    if (this.state === 'open' || this.state === 'opening') return;
    this.state = 'opening';
    this.lastFocus = document.activeElement;

    this.lockScroll(true);
    this.el.backdrop.hidden = false;
    this.el.panel.hidden = false;
    this.el.panel.classList.toggle('popover', popover);

    requestAnimationFrame(() => {
      this.el.backdrop.animate([{ opacity: 0 }, { opacity: 1 }], {
        duration: OPEN_MS,
        easing: EASE,
        fill: 'forwards',
      });

      const anim = this.buildPanelAnimation(origin, false);
      anim.onfinish = () => {
        this.state = 'open';
        (this.el.panel as HTMLElement).focus?.();
      };
    });
  }

  /** 收缩回物体位置后隐藏；resolve 于动画完成 */
  close(origin: DOMRectReadOnly | null): Promise<void> {
    if (this.state === 'idle' || this.state === 'closing') return Promise.resolve();
    this.state = 'closing';

    return new Promise((resolve) => {
      this.el.backdrop.animate([{ opacity: 1 }, { opacity: 0 }], {
        duration: CLOSE_MS,
        easing: 'ease-out',
        fill: 'forwards',
      });
      const anim = this.buildPanelAnimation(origin, true);
      anim.onfinish = () => {
        this.el.panel.hidden = true;
        this.el.backdrop.hidden = true;
        this.state = 'idle';
        this.lockScroll(false);
        if (this.lastFocus instanceof HTMLElement) this.lastFocus.focus();
        resolve();
      };
    });
  }

  private buildPanelAnimation(origin: DOMRectReadOnly | null, reverse: boolean): Animation {
    const panel = this.el.panel;
    if (this.reduceMotion.matches || !origin) {
      // 无障碍 / 无起点：纯交叉淡入
      const frames = [{ opacity: 0 }, { opacity: 1 }];
      return panel.animate(reverse ? frames.slice().reverse() : frames, {
        duration: reverse ? CLOSE_MS : OPEN_MS,
        easing: 'ease',
        fill: 'forwards',
      });
    }

    const rect = panel.getBoundingClientRect();
    const originX = origin.x + origin.width / 2;
    const originY = origin.y + origin.height / 2;
    const dx = originX - (rect.left + rect.width / 2);
    const dy = originY - (rect.top + rect.height / 2);
    const fromTransform = `translate(${dx}px, ${dy}px) scale(0.12)`;
    const frames = [
      { transform: fromTransform, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ];
    return panel.animate(reverse ? frames.slice().reverse() : frames, {
      duration: reverse ? CLOSE_MS : OPEN_MS,
      easing: EASE,
      fill: 'forwards',
    });
  }

  /** iOS 上唯一可靠的滚动锁 */
  private lockScroll(lock: boolean): void {
    const body = document.body;
    if (lock) {
      body.dataset.scrollY = String(window.scrollY);
      body.style.position = 'fixed';
      body.style.top = `-${window.scrollY}px`;
      body.style.width = '100%';
    } else {
      const y = Number(body.dataset.scrollY ?? '0');
      body.style.position = '';
      body.style.top = '';
      body.style.width = '';
      window.scrollTo(0, y);
    }
  }
}
