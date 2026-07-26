import * as THREE from 'three';
import {
  CSS3DRenderer,
  CSS3DObject,
} from 'three/addons/renderers/CSS3DRenderer.js';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import { NODES } from '../config/naming';
import { withBase } from '../../lib/url';
import { postPartial, postHref } from '../../lib/hotspots';

/**
 * ScreenOS：把一个可真正操作的「桌面系统」渲染进 3D 显示器的屏幕里。
 *
 * 做法：CSS3DRenderer 把一块真实 DOM（1024px 逻辑宽）用 3D 变换严丝合缝地
 * 贴到 monitor_screen 平面上，与 WebGL 同一相机每帧对齐（scene.onAfterRender 钩子，
 * 只在 WebGL 真正出帧时同步渲染，不破坏按需渲染）。DOM 文字始终清晰、可滚动、可点击。
 *
 * 界面：顶部菜单栏（Ling OS + 本地时间）、桌面文件夹网格（笔记 / 项目 / 归档 / 关于 / 状态）、
 * 屏幕内窗口（fetch partial 注入、窗口内导航带返回、内容区滚动）。
 * 未聚焦时纯展示（pointer-events: none）；聚焦完成后开启 DOM 交互；
 * Esc 或点击屏幕外退出。CSS3D 初始化失败时静默缺席，保留原 canvas 贴图屏幕。
 */

/** DOM 逻辑分辨率宽度（高度按屏幕几何比例推导） */
const PX_W = 1024;
const CACHE_MAX = 12;

interface AppDef {
  id: string;
  label: string;
  partial: string;
  href: string;
  /** 文件夹内的极简线条图形（SVG 片段） */
  glyph: string;
}

const GLYPH_STROKE =
  'fill="none" stroke="rgba(233,216,172,0.92)" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"';

const APPS: AppDef[] = [
  {
    id: 'posts',
    label: '笔记',
    partial: '/partials/posts/',
    href: '/posts/',
    glyph: `<path d="M23 27 h18 M23 34 h12" ${GLYPH_STROKE}/>`,
  },
  {
    id: 'projects',
    label: '项目',
    partial: '/partials/projects/',
    href: '/projects/',
    glyph: `<path d="M27 24 l-7 6.5 7 6.5 M37 24 l7 6.5 -7 6.5" ${GLYPH_STROKE}/>`,
  },
  {
    id: 'archive',
    label: '归档',
    partial: '/partials/archive/',
    href: '/archive/',
    glyph: `<path d="M23 24 h18 v13 h-18 z M23 30 h18 M29 24 v6" ${GLYPH_STROKE}/>`,
  },
  {
    id: 'about',
    label: '关于',
    partial: '/partials/about/',
    href: '/about/',
    glyph: `<circle cx="32" cy="27" r="4" ${GLYPH_STROKE}/><path d="M25 37.5 c2.4 -4.4 11.6 -4.4 14 0" ${GLYPH_STROKE}/>`,
  },
  {
    id: 'status',
    label: '状态',
    partial: '/partials/status/',
    href: '/status/',
    glyph: `<path d="M22 31 h5 l3 -7 4 13 3 -6 h5" ${GLYPH_STROKE}/>`,
  },
];

/** 极简文件夹图标（不用 emoji、不走手绘风） */
function folderSvg(glyph: string): string {
  return (
    `<svg viewBox="0 0 64 50" width="54" height="42" aria-hidden="true">` +
    `<path d="M5 12 a4 4 0 0 1 4 -4 h13 l6 6 h27 a4 4 0 0 1 4 4 v24 a4 4 0 0 1 -4 4 H9 a4 4 0 0 1 -4 -4 z"` +
    ` fill="rgba(201,164,92,0.13)" stroke="rgba(210,176,106,0.85)" stroke-width="2"/>` +
    `<path d="M5 20 h54" stroke="rgba(210,176,106,0.35)" stroke-width="1.4"/>` +
    glyph +
    `</svg>`
  );
}

const SKELETON_HTML =
  `<div class="sos-skel" aria-hidden="true">` +
  `<i style="width:42%;height:22px"></i><i style="width:26%"></i>` +
  `<i style="width:92%"></i><i style="width:88%"></i><i style="width:64%"></i>` +
  `<i style="width:90%"></i><i style="width:52%"></i>` +
  `</div>`;

/** 屏幕系统样式：色相全部取自 --brass / --ink / --paper 体系；窗口内容承接站点 token 昼夜主题 */
const SOS_CSS = `
.sos-root{
  display:flex;flex-direction:column;overflow:hidden;
  font-family:var(--font-serif);
  --sos-bg-hi:#2b2213;--sos-bg:#1d1710;--sos-bg-lo:#131009;
  --sos-text:#ece1c4;--sos-dim:#a8946c;--sos-accent:#c9a45c;
  --sos-line:rgba(201,164,92,0.2);
  background:radial-gradient(130% 105% at 50% 0%,var(--sos-bg-hi) 0%,var(--sos-bg) 54%,var(--sos-bg-lo) 100%);
  color:var(--sos-text);
  border-radius:6px;
  box-shadow:inset 0 0 46px rgba(0,0,0,0.5);
  -webkit-font-smoothing:antialiased;
}
[data-theme='night'] .sos-root{
  --sos-bg-hi:#251d0f;--sos-bg:#18120a;--sos-bg-lo:#0f0c06;
  --sos-text:#e0d2b0;--sos-dim:#95815c;--sos-accent:#d8a24a;
}
.sos-glare{
  position:absolute;inset:0;pointer-events:none;z-index:9;border-radius:6px;
  background:linear-gradient(112deg,rgba(255,246,224,0.05) 0%,rgba(255,246,224,0.015) 30%,transparent 46%);
}
.sos-bar{
  display:flex;align-items:center;gap:16px;height:44px;padding:0 20px;flex-shrink:0;
  border-bottom:1px solid var(--sos-line);background:rgba(0,0,0,0.18);
}
.sos-dots{display:flex;gap:7px}
.sos-dots i{width:11px;height:11px;border-radius:50%;background:var(--sos-accent)}
.sos-dots i:nth-child(2){background:#97794a}
.sos-dots i:nth-child(3){background:#645130}
.sos-brand{font-size:15px;font-weight:600;letter-spacing:0.14em;color:var(--sos-text)}
.sos-time{margin-left:auto;font-size:15px;color:var(--sos-dim);letter-spacing:0.04em;font-variant-numeric:tabular-nums}
.sos-desktop{
  flex:1;padding:34px 42px;min-height:0;
  display:grid;grid-template-rows:repeat(3,max-content);grid-auto-flow:column;
  gap:20px 18px;justify-content:start;align-content:start;
}
.sos-app{
  appearance:none;background:none;border:1px solid transparent;border-radius:12px;
  width:118px;padding:12px 8px 10px;display:grid;justify-items:center;gap:8px;
  cursor:pointer;color:var(--sos-text);font-family:inherit;
}
.sos-app:hover{background:rgba(201,164,92,0.09);border-color:rgba(201,164,92,0.22)}
.sos-app:focus-visible{outline:1px solid var(--sos-accent);outline-offset:2px}
.sos-app span{font-size:16px;letter-spacing:0.05em;text-shadow:0 1px 4px rgba(0,0,0,0.5)}
.sos-window{
  position:absolute;left:94px;right:94px;top:58px;bottom:44px;z-index:5;
  display:flex;flex-direction:column;overflow:hidden;
  background:var(--paper);color:var(--ink);
  border:1px solid rgba(201,164,92,0.4);border-radius:10px;
  box-shadow:0 24px 60px rgba(0,0,0,0.55);
  animation:sos-pop 0.2s var(--ease-out);
}
.sos-window[hidden]{display:none !important}
@keyframes sos-pop{from{opacity:0;transform:scale(0.965) translateY(6px)}}
.sos-win-bar{
  display:flex;align-items:center;gap:8px;height:46px;padding:0 8px 0 6px;flex-shrink:0;
  background:var(--paper-raised);border-bottom:1px solid var(--line-soft);
}
.sos-win-bar button{
  appearance:none;background:none;border:none;width:32px;height:32px;border-radius:8px;
  display:grid;place-items:center;color:var(--ink-faint);cursor:pointer;font-family:inherit;padding:0;
}
.sos-win-bar button:hover{background:var(--paper-sunken);color:var(--brass)}
.sos-back[disabled]{opacity:0.3;pointer-events:none}
.sos-win-title{
  font-size:15.5px;font-weight:700;color:var(--ink-soft);
  white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
}
.sos-close{margin-left:auto}
.sos-win-body{
  flex:1;overflow-y:auto;overscroll-behavior:contain;padding:8px 26px 28px;
  user-select:text;-webkit-user-select:text;
  scrollbar-width:thin;scrollbar-color:var(--line) transparent;
}
.sos-win-body::-webkit-scrollbar{width:8px}
.sos-win-body::-webkit-scrollbar-thumb{background:var(--line);border-radius:4px}
.sos-status{
  display:flex;justify-content:space-between;align-items:center;gap:16px;
  height:32px;padding:0 20px;flex-shrink:0;font-size:13px;
  color:rgba(196,176,130,0.55);border-top:1px solid rgba(201,164,92,0.14);
}
.sos-skel{padding:26px 4px;display:grid;gap:14px}
.sos-skel i{display:block;height:14px;border-radius:4px;background:var(--paper-sunken);animation:sos-sk 1.2s ease-in-out infinite}
@keyframes sos-sk{50%{opacity:0.55}}
.sos-error{padding:40px 8px;display:grid;gap:12px;justify-items:start;color:var(--ink-soft);font-size:15px}
.sos-error a{color:var(--brass)}
@media (prefers-reduced-motion: reduce){
  .sos-window{animation:none}
  .sos-skel i{animation:none}
}
`;

interface NavEntry {
  partial: string;
  href: string;
  title: string;
}

export class ScreenOS {
  /** Esc 请求退出（由 main.ts 接到 unfocus） */
  onRequestExit: (() => void) | null = null;

  private ready = false;
  private revealed = false;
  private pendingReveal = false;
  private focused = false;
  private disposed = false;
  private prefetched = false;

  private cssRenderer: CSS3DRenderer | null = null;
  private cssScene = new THREE.Scene();
  private layer: HTMLElement | null = null;
  private layerOwned = false;

  private root: HTMLDivElement | null = null;
  private timeEl: HTMLElement | null = null;
  private winEl: HTMLElement | null = null;
  private winTitle: HTMLElement | null = null;
  private winBody: HTMLElement | null = null;
  private backBtn: HTMLButtonElement | null = null;
  private statusPath: HTMLElement | null = null;
  private statusHint: HTMLElement | null = null;

  private stack: NavEntry[] = [];
  private cache = new Map<string, string>();
  private clockTimer = 0;
  private resizeObs: ResizeObserver | null = null;
  private restoreAfterRender: (() => void) | null = null;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
  ) {}

  /** desk.glb 就绪后调用；任何一步失败都静默缺席（保留原 canvas 贴图屏幕） */
  mount(): void {
    try {
      this.mountInner();
    } catch {
      this.teardownDom();
    }
  }

  get available(): boolean {
    return this.ready;
  }

  private mountInner(): void {
    const mesh = this.registry.get(NODES.monitorScreen);
    if (!(mesh instanceof THREE.Mesh)) return;

    // 屏幕平面的世界尺寸与朝向（由包围盒推导，换模自动适配）
    const geo = mesh.geometry;
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    if (!bb) return;
    const size = bb.getSize(new THREE.Vector3());
    mesh.updateWorldMatrix(true, false);
    const ws = mesh.getWorldScale(new THREE.Vector3());

    // 最薄的轴是法线方向；支持局部 XY（法线 Z）与 XZ（法线 Y）两种平面
    const thin =
      size.x < size.y
        ? size.x < size.z ? 'x' : 'z'
        : size.y < size.z ? 'y' : 'z';
    if (thin === 'x') return;
    const pre = new THREE.Quaternion();
    let worldW: number;
    let worldH: number;
    if (thin === 'z') {
      worldW = size.x * Math.abs(ws.x);
      worldH = size.y * Math.abs(ws.y);
    } else {
      worldW = size.x * Math.abs(ws.x);
      worldH = size.z * Math.abs(ws.z);
      pre.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
    }
    if (worldW < 1e-4 || worldH < 1e-4) return;

    const pos = bb.getCenter(new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
    const quat = mesh.getWorldQuaternion(new THREE.Quaternion()).multiply(pre);
    // 元素正面朝向相机一侧（背对则绕自身竖轴翻 180 度）
    const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    if (normal.dot(this.manager.camera.position.clone().sub(pos)) < 0) {
      quat.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    }

    // DOM 与 CSS3D 装配
    this.injectStyle();
    const pxH = Math.max(2, Math.round((PX_W * worldH) / worldW));
    const root = this.buildDom(pxH);

    const renderer = new CSS3DRenderer();
    const canvas = this.manager.canvas;
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    const dom = renderer.domElement;
    dom.style.position = 'absolute';
    dom.style.inset = '0';
    dom.style.pointerEvents = 'none';

    let layer = document.getElementById('screen-os-layer');
    if (!layer) {
      // 页面没给占位容器时自行创建（紧跟 canvas 之后，位于 HUD 之下）
      layer = document.createElement('div');
      layer.id = 'screen-os-layer';
      layer.style.cssText =
        'position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden;';
      canvas.parentElement?.insertBefore(layer, canvas.nextSibling);
      this.layerOwned = true;
    }
    layer.appendChild(dom);
    this.layer = layer;

    const obj = new CSS3DObject(root);
    root.style.pointerEvents = 'none'; // CSS3DObject 默认 auto，未聚焦时必须关掉
    obj.position.copy(pos);
    obj.quaternion.copy(quat);
    obj.scale.set(worldW / PX_W, worldH / pxH, 1);
    this.cssScene.add(obj);
    this.cssRenderer = renderer;

    // 3D 屏幕材质转为纯黑无发光：DOM 顶替屏幕画面，避免双重显示。
    // 只改颜色与贴图，保留材质实例（LightingSystem 仍会写 emissiveIntensity，黑色发光无效果）
    const mat = mesh.material as THREE.MeshStandardMaterial;
    if (mat && 'emissive' in mat) {
      mat.map = null;
      mat.emissiveMap = null;
      mat.emissive.setHex(0x000000);
      mat.color.setHex(0x050403);
      mat.needsUpdate = true;
    }

    // 与 WebGL 同帧渲染 CSS3D：只在 WebGL 真正出帧时跟随，不引入常驻动画循环
    const scene = this.manager.scene;
    const prev = scene.onAfterRender as unknown as (
      r: THREE.WebGLRenderer,
      s: THREE.Scene,
      c: THREE.Camera,
    ) => void;
    scene.onAfterRender = (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera): void => {
      prev.call(scene, r, s, c);
      if (this.ready && this.revealed && this.cssRenderer) {
        this.cssRenderer.render(this.cssScene, this.manager.camera);
      }
    };
    this.restoreAfterRender = () => {
      scene.onAfterRender = prev as THREE.Scene['onAfterRender'];
    };

    this.resizeObs = new ResizeObserver(() => {
      this.cssRenderer?.setSize(canvas.clientWidth, canvas.clientHeight);
      this.manager.invalidate();
    });
    this.resizeObs.observe(canvas);

    this.tickClock();
    // 先渲染一帧就位，避免 reveal 瞬间 DOM 出现在未变换的位置
    renderer.render(this.cssScene, this.manager.camera);

    this.ready = true;
    if (this.pendingReveal) this.setRevealed(true);
    this.manager.invalidate();
  }

  // ———————————————————————— 状态开关 ————————————————————————

  /** 进入主场景后屏幕点亮（入口时钟阶段隐藏，避免脱离相机语境的 DOM 闪现） */
  setRevealed(on: boolean): void {
    if (!this.ready) {
      this.pendingReveal = on;
      return;
    }
    this.revealed = on;
    this.layer?.classList.toggle('on', on);
    if (this.layerOwned && this.layer) this.layer.style.opacity = on ? '1' : '0';
    this.manager.invalidate();
  }

  /** 聚焦态开关：开启 DOM 交互与 Esc 退出 */
  setFocused(on: boolean): void {
    if (!this.ready || !this.root || this.focused === on) return;
    this.focused = on;
    this.root.style.pointerEvents = on ? 'auto' : 'none';
    this.root.inert = !on;
    this.layer?.setAttribute('aria-hidden', on ? 'false' : 'true');
    if (on) {
      window.addEventListener('keydown', this.onKey);
      this.updateHint();
    } else {
      window.removeEventListener('keydown', this.onKey);
    }
  }

  /** 相机飞行期间预取各目录 partial（只做一次） */
  prepare(): void {
    if (!this.ready || this.prefetched) return;
    this.prefetched = true;
    for (const app of APPS) void this.fetchPartial(app.partial);
  }

  dispose(): void {
    this.disposed = true;
    this.setFocused(false);
    this.restoreAfterRender?.();
    this.restoreAfterRender = null;
    this.resizeObs?.disconnect();
    this.resizeObs = null;
    clearTimeout(this.clockTimer);
    this.teardownDom();
    this.ready = false;
  }

  private teardownDom(): void {
    this.cssRenderer?.domElement.remove();
    this.cssRenderer = null;
    if (this.layerOwned) this.layer?.remove();
    this.layer = null;
    this.root = null;
  }

  // ———————————————————————— DOM 装配 ————————————————————————

  private injectStyle(): void {
    if (document.getElementById('sos-style')) return;
    const style = document.createElement('style');
    style.id = 'sos-style';
    style.textContent = SOS_CSS;
    document.head.appendChild(style);
  }

  private buildDom(pxH: number): HTMLDivElement {
    const root = document.createElement('div');
    root.className = 'sos-root';
    root.style.width = `${PX_W}px`;
    root.style.height = `${pxH}px`;
    root.inert = true;

    const icons = APPS.map(
      (app) =>
        `<button class="sos-app" type="button" data-app="${app.id}">` +
        folderSvg(app.glyph) +
        `<span>${app.label}</span></button>`,
    ).join('');

    root.innerHTML =
      `<header class="sos-bar">` +
      `<span class="sos-dots" aria-hidden="true"><i></i><i></i><i></i></span>` +
      `<span class="sos-brand">Ling OS</span>` +
      `<span class="sos-time"></span>` +
      `</header>` +
      `<main class="sos-desktop">${icons}</main>` +
      `<section class="sos-window" hidden>` +
      `<header class="sos-win-bar">` +
      `<button class="sos-back" type="button" aria-label="返回" disabled>` +
      `<svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M10 3 L5 8 l5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>` +
      `</button>` +
      `<span class="sos-win-title"></span>` +
      `<button class="sos-close" type="button" aria-label="关闭窗口">` +
      `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4 4 l8 8 M12 4 l-8 8" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>` +
      `</button>` +
      `</header>` +
      `<div class="sos-win-body"></div>` +
      `</section>` +
      `<footer class="sos-status">` +
      `<span class="sos-hint"></span>` +
      `<span class="sos-path">~/ling</span>` +
      `</footer>` +
      `<div class="sos-glare" aria-hidden="true"></div>`;

    this.root = root;
    this.timeEl = root.querySelector('.sos-time');
    this.winEl = root.querySelector('.sos-window');
    this.winTitle = root.querySelector('.sos-win-title');
    this.winBody = root.querySelector('.sos-win-body');
    this.backBtn = root.querySelector('.sos-back');
    this.statusPath = root.querySelector('.sos-path');
    this.statusHint = root.querySelector('.sos-hint');
    this.updateHint();

    // 桌面：单击文件夹打开；悬停预取
    const desktop = root.querySelector('.sos-desktop');
    desktop?.addEventListener('click', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('.sos-app');
      const app = APPS.find((a) => a.id === btn?.dataset.app);
      if (app) void this.openEntry({ partial: app.partial, href: app.href, title: app.label }, true);
    });
    desktop?.addEventListener('pointerover', (e) => {
      const btn = (e.target as Element).closest<HTMLElement>('.sos-app');
      const app = APPS.find((a) => a.id === btn?.dataset.app);
      if (app) void this.fetchPartial(app.partial);
    });

    this.backBtn?.addEventListener('click', () => this.back());
    root.querySelector('.sos-close')?.addEventListener('click', () => this.closeWindow());

    // 3D 变换子树里浏览器原生滚动不可靠（合成器命中近似），手动接管滚轮与触摸拖动
    this.winBody?.addEventListener(
      'wheel',
      (e) => {
        if (!this.winBody) return;
        e.preventDefault();
        this.winBody.scrollTop += e.deltaMode === 1 ? e.deltaY * 24 : e.deltaY;
      },
      { passive: false },
    );
    let touchY: number | null = null;
    this.winBody?.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch') touchY = e.clientY;
    });
    this.winBody?.addEventListener('pointermove', (e) => {
      if (touchY === null || e.pointerType !== 'touch' || !this.winBody) return;
      this.winBody.scrollTop += touchY - e.clientY;
      touchY = e.clientY;
    });
    const endTouch = (): void => {
      touchY = null;
    };
    this.winBody?.addEventListener('pointerup', endTouch);
    this.winBody?.addEventListener('pointercancel', endTouch);

    // 窗口内链接：能解析成 partial 的就地打开，其余新标签（不离开 3D 场景）
    this.winBody?.addEventListener('click', (e) => {
      const link = (e.target as Element).closest<HTMLAnchorElement>('a[href]');
      if (!link) return;
      if (link.origin !== location.origin) return; // 外链走默认（已被 harden 成新标签）
      e.preventDefault();
      const path = link.pathname;
      // 「首页」面包屑：回到屏幕桌面，而不是开新标签
      if (path === withBase('/') || path === '/') {
        this.closeWindow();
        return;
      }
      const entry = this.resolveLink(path);
      if (entry) void this.openEntry(entry, true);
      else window.open(link.href, '_blank', 'noopener');
    });

    return root;
  }

  private updateHint(): void {
    if (!this.statusHint) return;
    this.statusHint.textContent = this.winEl?.hidden
      ? '单击文件夹打开内容'
      : 'Esc 或点击屏幕外回到书桌';
  }

  // ———————————————————————— 窗口导航 ————————————————————————

  /** pathname 解析为屏幕内可打开的 partial（null 表示不属于屏幕系统） */
  private resolveLink(pathname: string): NavEntry | null {
    const base = withBase('/');
    let p = pathname;
    if (base !== '/' && p.startsWith(base)) p = `/${p.slice(base.length)}`;
    if (!p.endsWith('/')) p += '/';

    const post = p.match(/^\/posts\/([^/]+)\/$/);
    if (post?.[1]) {
      const slug = decodeURIComponent(post[1]);
      return { partial: postPartial(slug), href: postHref(slug), title: '笔记' };
    }
    const app = APPS.find((a) => a.href === p);
    return app ? { partial: app.partial, href: app.href, title: app.label } : null;
  }

  private async openEntry(entry: NavEntry, push: boolean): Promise<void> {
    if (!this.winEl || !this.winBody || !this.winTitle) return;
    if (push) this.stack.push(entry);
    this.winEl.hidden = false;
    this.winTitle.textContent = entry.title;
    if (this.statusPath) this.statusPath.textContent = `~${entry.href}`;
    if (this.backBtn) this.backBtn.disabled = this.stack.length <= 1;
    this.updateHint();
    this.winBody.innerHTML = SKELETON_HTML;
    this.winBody.scrollTop = 0;

    const html = await this.fetchPartial(entry.partial);
    if (this.disposed || this.stack[this.stack.length - 1] !== entry) return;
    if (html === null) {
      this.winBody.innerHTML =
        `<div class="sos-error"><p>这份内容暂时打不开。</p>` +
        `<p><a href="${withBase(entry.href)}" target="_blank" rel="noopener">在新标签页中打开</a></p></div>`;
      return;
    }
    this.winBody.innerHTML = html;
    this.hardenLinks();
    // 文章标题回填窗口标题栏
    const h1 = this.winBody.querySelector('.article-head h1');
    const title = h1?.textContent?.trim();
    if (title) {
      entry.title = title;
      this.winTitle.textContent = title;
    }
    this.winBody.scrollTop = 0;
  }

  private back(): void {
    if (this.stack.length <= 1) return;
    this.stack.pop();
    const prev = this.stack[this.stack.length - 1];
    if (prev) void this.openEntry(prev, false);
  }

  private closeWindow(): void {
    this.stack = [];
    if (this.winEl) this.winEl.hidden = true;
    if (this.statusPath) this.statusPath.textContent = '~/ling';
    this.updateHint();
  }

  /** 注入内容的外链一律新标签打开（避免整页跳转毁掉 3D 场景） */
  private hardenLinks(): void {
    if (!this.winBody) return;
    for (const a of Array.from(this.winBody.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
      if (a.origin !== location.origin) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    }
  }

  private async fetchPartial(partial: string): Promise<string | null> {
    const cached = this.cache.get(partial);
    if (cached !== undefined) return cached;
    try {
      const res = await fetch(withBase(partial));
      if (!res.ok) return null;
      const html = await res.text();
      this.cache.set(partial, html);
      if (this.cache.size > CACHE_MAX) {
        const oldest = this.cache.keys().next().value;
        if (oldest) this.cache.delete(oldest);
      }
      return html;
    } catch {
      return null;
    }
  }

  // ———————————————————————— 时钟与键盘 ————————————————————————

  private tickClock = (): void => {
    if (this.disposed) return;
    if (this.timeEl) {
      const d = new Date();
      const wd = '日一二三四五六'.charAt(d.getDay());
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      this.timeEl.textContent = `${d.getMonth() + 1} 月 ${d.getDate()} 日 周${wd} · ${hh}:${mm}`;
    }
    // 对齐到下一整分再更新
    this.clockTimer = window.setTimeout(this.tickClock, 60050 - (Date.now() % 60000));
  };

  private onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.onRequestExit?.();
      return;
    }
    // 窗口打开时的键盘滚动（方向键 / 翻页键）
    if (!this.winBody || this.winEl?.hidden) return;
    const page = this.winBody.clientHeight * 0.85;
    const jump: Record<string, number> = {
      ArrowDown: 64,
      ArrowUp: -64,
      PageDown: page,
      PageUp: -page,
    };
    const dy = jump[e.key];
    if (dy !== undefined) {
      e.preventDefault();
      this.winBody.scrollTop += dy;
    } else if (e.key === 'Home') {
      e.preventDefault();
      this.winBody.scrollTop = 0;
    } else if (e.key === 'End') {
      e.preventDefault();
      this.winBody.scrollTop = this.winBody.scrollHeight;
    }
  };
}
