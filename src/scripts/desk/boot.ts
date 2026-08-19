/**
 * 引导器：能力检测、动态加载 3D、质量分级、HUD 文案、降级切换。
 * 「无跳过入口」语义：同标签页站内往返不重放时钟（sessionStorage），
 * 主动刷新 / 新标签 / 新会话重放；全程无任何用户可见跳过 UI。
 */
import type { DeskScene } from '../../three/main';
import { HOTSPOTS } from '../../lib/hotspots';
import { PanelRouter } from './panel-router';
import { OverlayFSM } from './overlay-fsm';
import {
  clearClockDone,
  isClockDoneThisSession,
  markClockDone,
  isMuted,
  setMutedStored,
  getStoredQuality,
  storeQuality,
  local,
  KEYS,
  type QualityTier,
} from './storage';

function $(id: string): HTMLElement | null {
  return document.getElementById(id);
}

function degrade(): void {
  document.documentElement.classList.remove('webgl');
}

function detectQuality(): QualityTier {
  const stored = getStoredQuality();
  if (stored) return stored;

  const nav = navigator as Navigator & {
    deviceMemory?: number;
    hardwareConcurrency?: number;
  };
  const mem = nav.deviceMemory ?? 8;
  const cores = nav.hardwareConcurrency ?? 8;
  const smallTouch = matchMedia('(pointer: coarse) and (max-width: 820px)').matches;

  let tier: QualityTier = 'high';
  if (mem <= 2 || cores <= 2) tier = 'low';
  else if (mem <= 4 || cores <= 4 || smallTouch) tier = 'mid';
  storeQuality(tier);
  return tier;
}

function lampLabel(mode: LampMode): string {
  return mode === 'ambient' ? '环境模式' : mode === 'focus' ? '专注模式' : '夜间氛围';
}

async function run(): Promise<void> {
  if (!document.documentElement.classList.contains('webgl')) return;
  const canvas = $('desk-canvas') as HTMLCanvasElement | null;
  if (!canvas) return;
  const deskRoot = $('desk-root');
  const sceneLoader = $('scene-loader');

  // 刷新 → 重新体验入口（会话标记清除）
  const navEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navEntry?.type === 'reload') clearClockDone();

  let mod: typeof import('../../three/main');
  try {
    mod = await import('../../three/main');
  } catch {
    degrade();
    return;
  }

  const api: DeskScene = mod.createDeskScene();

  const overlay = new OverlayFSM({
    backdrop: $('overlay-backdrop')!,
    panel: $('panel')!,
    scroll: $('panel-scroll')!,
    title: $('panel-title')!,
    closeBtn: $('panel-close')!,
  });
  const router = new PanelRouter(api, overlay);

  // —— HUD 元素 ——
  const tip = $('hotspot-tip');
  const toast = $('toast');
  const entryUi = $('entry-ui');
  const entryCaption = $('entry-caption');
  const entryFeedback = $('entry-feedback');
  const vignette = $('vignette');
  const muteBtn = $('mute-btn');

  let toastTimer = 0;
  const showToast = (text: string, ms = 2600): void => {
    if (!toast) return;
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      toast.classList.remove('show');
      toastTimer = window.setTimeout(() => (toast.hidden = true), 300);
    }, ms);
  };

  // —— 悬停标签：短延迟防掠过闪烁、平滑跟随、视口边缘自动翻转 ——
  let tipShowTimer = 0;
  let tipKey: string | null = null;

  const moveTip = (x: number, y: number, instant: boolean): void => {
    if (!tip) return;
    const w = tip.offsetWidth;
    const h = tip.offsetHeight;
    let tx = x + 16;
    let ty = y + 22;
    if (tx + w + 8 > window.innerWidth) tx = x - w - 14;
    if (ty + h + 8 > window.innerHeight) ty = y - h - 16;
    if (instant) tip.style.transition = 'none';
    tip.style.transform = `translate3d(${Math.round(tx)}px, ${Math.round(ty)}px, 0)`;
    if (instant) {
      void tip.offsetWidth; // 强制回流，随后恢复 CSS 过渡
      tip.style.transition = '';
    }
  };

  const hideTip = (): void => {
    clearTimeout(tipShowTimer);
    tipKey = null;
    tip?.classList.remove('show');
  };

  api.on('hotspot:hover', ({ id, label, hint, x, y }) => {
    if (!tip) return;
    if (!id) {
      hideTip();
      return;
    }
    const fresh = tipKey === null;
    if (tipKey !== id) {
      tipKey = id;
      tip.innerHTML = `<strong>${label}</strong><span>${hint}</span>`;
    }
    if (fresh) {
      // 首次出现：位置直接就位，延迟 80ms 淡入（掠过不闪）
      moveTip(x, y, true);
      clearTimeout(tipShowTimer);
      tipShowTimer = window.setTimeout(() => tip.classList.add('show'), 80);
    } else {
      moveTip(x, y, false);
    }
    router.prefetchHotspot(id);
  });

  api.on('hotspot:click', ({ id }) => {
    hideTip();
    if (id === 'lamp') {
      const current = window.deskTheme?.getLamp() ?? 'ambient';
      const next: LampMode =
        current === 'ambient' ? 'focus' : current === 'focus' ? 'night' : 'ambient';
      window.deskTheme?.setLamp(next);
      return;
    }
    if (id === 'window') {
      void (async () => {
        const drawn = await api.toggleCurtain();
        const now = new Date();
        const phase = now.getHours() >= 6 && now.getHours() < 18 ? '白天' : '夜晚';
        const msg = drawn
          ? '已拉上窗帘 · 室内光线调柔'
          : `已拉开窗帘 · 窗外是${phase}`;
        showToast(msg);
      })();
      return;
    }
    void router.openHotspot(id);
  });

  api.on('clock:hint', ({ kind }) => {
    if (!entryFeedback) return;
    entryFeedback.textContent =
      kind === 'almost' ? '好像还差一点。' : '看看分针的位置。';
    entryFeedback.hidden = false;
    setTimeout(() => (entryFeedback.hidden = true), 3000);
  });

  api.on('clock:success', () => {
    if (entryCaption) entryCaption.textContent = '时间继续了。';
    if (entryFeedback) entryFeedback.hidden = true;
    vignette?.classList.add('fade-out');
  });

  api.on('entry:complete', () => {
    markClockDone();
    entryUi?.classList.add('fade-out');
    setTimeout(() => entryUi?.remove(), 600);
    vignette?.remove();
    // 首访提示
    if (local.get(KEYS.visited) !== '1') {
      local.set(KEYS.visited, '1');
      showToast('拖动环视书桌 · 点击物件进入内容', 3600);
    }
  });

  api.on('lamp:modeChange', ({ mode }) => showToast(lampLabel(mode), 1600));

  // 聚焦时背景虚化：只在真的弹出 HTML 面板时才做。
  // 就地阅读（in-scene，如书页/显示器）内容长在 3D 物体上，虚化会把它一起糊掉。
  api.on('camera:focusComplete', ({ id }) => {
    const behavior = HOTSPOTS[id]?.behavior;
    if (behavior === 'content' || behavior === 'popover') {
      canvas.classList.add('blurred');
    }
  });
  api.on('camera:unfocusComplete', () => canvas.classList.remove('blurred'));

  api.on('contextlost', () => degrade());

  // 完整资产、最终相机/光照和第一张 WebGL 帧都就绪后，才一次性揭示场景。
  let sceneRevealed = false;
  const revealScene = (): void => {
    if (sceneRevealed) return;
    sceneRevealed = true;
    deskRoot?.classList.add('scene-ready');
    deskRoot?.setAttribute('aria-busy', 'false');
    if (!sceneLoader) return;
    sceneLoader.addEventListener(
      'transitionend',
      (event) => {
        if (event.propertyName === 'opacity') sceneLoader.remove();
      },
      { once: true },
    );
    // 页面恢复、降动效或浏览器跳过 transitionend 时的收口。
    window.setTimeout(() => sceneLoader.remove(), 800);
  };
  api.on('scene:ready', revealScene);

  // 主题（台灯档位）驱动 3D 光照 —— window.deskTheme 是唯一主题耦合点
  window.addEventListener('desk:theme', () => {
    const lamp = window.deskTheme?.getLamp() ?? 'ambient';
    api.setLampMode(lamp);
  });

  // 静音开关
  const applyMuteUi = (muted: boolean): void => {
    muteBtn?.classList.toggle('muted', muted);
    muteBtn?.setAttribute('aria-pressed', muted ? 'false' : 'true');
  };
  const initialMuted = isMuted();
  applyMuteUi(initialMuted);
  muteBtn?.addEventListener('click', () => {
    const next = !isMuted();
    setMutedStored(next);
    api.setMuted(next);
    applyMuteUi(next);
    showToast(next ? '环境音已关闭' : '环境音已开启', 1400);
  });

  const skipEntry = isClockDoneThisSession();
  if (skipEntry) {
    entryUi?.remove();
    vignette?.remove();
  }

  try {
    await api.init(canvas, {
      skipEntry,
      quality: detectQuality(),
      lamp: window.deskTheme?.getLamp() ?? 'ambient',
      muted: initialMuted,
    });
    // 事件监听是主路径；这里保证未来实现变更也不会让加载层永久滞留。
    revealScene();
  } catch {
    degrade();
    return;
  }

  // dev/test 钩子（生产构建物理剔除）
  if (import.meta.env.DEV) {
    window.__desk = {
      test: {
        activateHotspot: (id) => void router.openHotspot(id as never),
        completeClock: () => api.debugCompleteClock(),
      },
      api,
    } as typeof window.__desk;
  }
}

void run();
