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

  // 加载调试（?debug=load）：t0 取自页面开始，记录到 run() 执行的时间差
  const debugLoad = new URLSearchParams(location.search).get('debug') === 'load';
  const t0 = performance.now();
  /** 用 WebGL readPixels 采样 canvas 多点平均色（中心+四角） */
  const sampleCanvas = (): string => {
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) return ' (no gl)';
      const w = canvas.width, h = canvas.height;
      const sz = 8;
      // 采样 5 个点：中心 + 四角
      const points = [
        [Math.floor(w/2-sz/2), Math.floor(h/2-sz/2)],     // 中心
        [Math.floor(w*0.1), Math.floor(h*0.1)],              // 左上
        [Math.floor(w*0.9-sz), Math.floor(h*0.1)],          // 右上
        [Math.floor(w*0.1), Math.floor(h*0.9-sz)],          // 左下
        [Math.floor(w*0.9-sz), Math.floor(h*0.9-sz)],       // 右下
      ];
      const labels = ['C', 'TL', 'TR', 'BL', 'BR'];
      const parts: string[] = [];
      for (let p = 0; p < points.length; p++) {
        const px = new Uint8Array(sz * sz * 4);
        gl.readPixels(points[p][0], points[p][1], sz, sz, gl.RGBA, gl.UNSIGNED_BYTE, px);
        let r = 0, g = 0, b = 0;
        for (let i = 0; i < px.length; i += 4) { r += px[i]; g += px[i + 1]; b += px[i + 2]; }
        const n = px.length / 4;
        parts.push(`${labels[p]}=rgb(${Math.round(r/n)},${Math.round(g/n)},${Math.round(b/n)})`);
      }
      return ' ' + parts.join(' ');
    } catch {
      return ' (readPixels failed)';
    }
  };
  const log = (tag: string): void => {
    if (!debugLoad) return;
    const ms = Math.round(performance.now() - t0);
    const line = `[load] +${ms}ms ${tag}${sampleCanvas()}`;
    console.log(line);
    // 存到全局数组 + DOM 隐藏元素，便于外部读取（自动化测试）
    const arr = (window as unknown as { __deskLog?: string[] }).__deskLog ??= [];
    arr.push(line);
    const el = document.getElementById('debug-log') ?? (() => {
      const d = document.createElement('pre');
      d.id = 'debug-log';
      d.style.cssText = 'position:fixed;bottom:0;left:0;z-index:9999;font:11px monospace;background:rgba(0,0,0,.9);color:#0f0;padding:8px;max-height:60vh;overflow:auto;white-space:pre-wrap;pointer-events:auto;';
      document.body.appendChild(d);
      return d;
    })();
    el.textContent += line + '\n';
  };
  if (debugLoad) console.log(`[load] +0ms boot:run`);

  // 刷新 → 重新体验入口（会话标记清除）
  const navEntry = performance.getEntriesByType('navigation')[0] as
    | PerformanceNavigationTiming
    | undefined;
  if (navEntry?.type === 'reload') clearClockDone();

  let mod: typeof import('../../three/main');
  try {
    log('import:three/main');
    mod = await import('../../three/main');
    log('import:done');
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
  const curtain = $('load-curtain');
  const curtainGlow = curtain?.querySelector<HTMLElement>('.curtain-glow');

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

  // 加载遮罩：assets:progress 驱动中心微光渐强；scene:ready（首帧已渲染）后淡出揭幕
  api.on('assets:progress', ({ loaded, total }) => {
    log(`assets:progress ${loaded}/${total}`);
    if (curtainGlow) curtainGlow.style.opacity = String(0.4 + 0.6 * (loaded / total));
  });
  api.on('scene:ready', () => {
    // 用 DOM data 属性标记 scene:ready 是否触发（便于外部读取，不依赖 console）
    document.documentElement.setAttribute('data-scene-ready', '1');
    console.log('[boot] scene:ready received');
    if (debugLoad) log('scene:ready');
    if (debugLoad) {
      console.log('[load] 调试模式：遮罩未自动揭幕。手动揭幕：window.__deskLoad.lift()');
      return;
    }
    // 直接揭幕（不用 requestAnimationFrame，IAB 中 raf 可能被暂停导致回调丢失）
    if (!curtain) {
      document.documentElement.setAttribute('data-curtain-null', '1');
      return;
    }
    curtain.classList.add('lift');
    document.documentElement.setAttribute('data-curtain-lift', '1');
    curtain.addEventListener('transitionend', () => curtain.remove(), { once: true });
    window.setTimeout(() => curtain.remove(), 1200);
  });

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
      onStage: debugLoad ? log : undefined,
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
      api,
    } as typeof window.__desk;
  }

  // 加载调试钩子（生产也可用，?debug=load 时暴露）
  if (debugLoad) {
    log('boot:debug hooks ready');
    Object.assign(window, {
      __deskLoad: {
        lift: () => {
          console.log('[load] 手动揭幕');
          curtain?.classList.add('lift');
          curtain?.addEventListener('transitionend', () => curtain.remove(), { once: true });
        },
        removeCurtain: () => curtain?.remove(),
        sample: () => console.log(`[load] ${sampleCanvas()}`),
        screenshot: () => {
          const a = document.createElement('a');
          a.download = `desk-${Date.now()}.png`;
          a.href = canvas.toDataURL('image/png');
          a.click();
        },
        curtain,
      },
    });
    console.log('[load] 调试模式已开启。可用命令：');
    console.log('  __deskLoad.lift()      - 手动揭幕（观察遮罩下画面）');
    console.log('  __deskLoad.sample()    - 采样当前 canvas 像素');
    console.log('  __deskLoad.screenshot()- 下载当前 canvas 截图');
    console.log('  __deskLoad.removeCurtain() - 移除遮罩');
  }
}

void run();
