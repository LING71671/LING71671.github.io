/**
 * 引导器：能力检测、动态加载 3D、质量分级、HUD 文案、降级切换。
 * 「无跳过入口」语义：同标签页站内往返不重放时钟（sessionStorage），
 * 主动刷新 / 新标签 / 新会话重放；全程无任何用户可见跳过 UI。
 */
import type { DeskScene } from '../../three/main';
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

  // —— 事件接线 ——
  api.on('hotspot:hover', ({ id, label, hint, x, y }) => {
    if (!tip) return;
    if (!id) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = `<strong>${label}</strong><span>${hint}</span>`;
    tip.style.left = `${x + 14}px`;
    tip.style.top = `${y + 14}px`;
    tip.hidden = false;
    router.prefetchHotspot(id);
  });

  api.on('hotspot:click', ({ id }) => {
    if (tip) tip.hidden = true;
    if (id === 'lamp') {
      const current = window.deskTheme?.getLamp() ?? 'ambient';
      const next: LampMode =
        current === 'ambient' ? 'focus' : current === 'focus' ? 'night' : 'ambient';
      window.deskTheme?.setLamp(next);
      return;
    }
    if (id === 'window') {
      const now = new Date();
      const hh = String(now.getHours()).padStart(2, '0');
      const mm = String(now.getMinutes()).padStart(2, '0');
      const phase = now.getHours() >= 6 && now.getHours() < 18 ? '白天' : '夜晚';
      showToast(`现在是 ${hh}:${mm} · 窗外是${phase}`);
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

  // 聚焦时背景虚化（CSS blur，性能优先的景深近似）
  api.on('camera:focusComplete', () => canvas.classList.add('blurred'));
  api.on('camera:unfocusComplete', () => canvas.classList.remove('blurred'));

  api.on('contextlost', () => degrade());

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
    };
  }
}

void run();
