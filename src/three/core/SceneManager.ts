import * as THREE from 'three';
import { TweenRunner } from '../utils/tween';
import type { QualityTier } from '../../scripts/desk/storage';

/**
 * 渲染器与按需渲染循环。
 * 一切视觉变更必须经 invalidate() 请求帧；空闲时零渲染。
 * 持续性动画（阻尼、补间）通过 updaters 注册，返回 true 表示仍活跃。
 */
/**
 * 每帧回调。返回值只表示「是否继续存活」，**不代表需要重绘**。
 * 需要出帧必须显式调用 invalidate()，否则像秒针这种长期存活、
 * 每秒才变一次的 updater 会把按需渲染变成 60fps 常驻渲染。
 */
export type Updater = (dt: number) => boolean;

export class SceneManager {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly tweens = new TweenRunner();

  private needsRender = true;
  private updaters = new Set<Updater>();
  private lastFrameTime = 0;
  private running = false;
  private rafId = 0;
  private renderPaused = false;
  private afterRender = new Set<() => void>();

  constructor(readonly canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 20);

    const onLost = (e: Event) => {
      e.preventDefault();
      this.onContextLost?.();
    };
    canvas.addEventListener('webglcontextlost', onLost);
  }

  onContextLost: (() => void) | null = null;

  setQuality(tier: QualityTier): void {
    const dpr = window.devicePixelRatio || 1;
    const cap = tier === 'low' ? 1 : tier === 'mid' ? 1.5 : 2;
    this.renderer.setPixelRatio(Math.min(dpr, cap));
    this.resize();
  }

  resize(): void {
    const { clientWidth: w, clientHeight: h } = this.canvas;
    if (w === 0 || h === 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate(): void {
    this.needsRender = true;
  }

  /**
   * 等待下一张 WebGL 帧真正提交。
   * 首屏揭示以这个信号为准，避免 DOM 已进入 ready 而 canvas 仍停在清屏色。
   */
  afterNextRender(): Promise<void> {
    return new Promise((resolve) => {
      this.afterRender.add(resolve);
      this.invalidate();
    });
  }

  /** 阴影贴图重建（灯光/可动件变化时调用一次） */
  updateShadows(): void {
    this.renderer.shadowMap.needsUpdate = true;
    this.invalidate();
  }

  addUpdater(fn: Updater): () => void {
    this.updaters.add(fn);
    this.invalidate();
    return () => this.updaters.delete(fn);
  }

  /** 面板全开时暂停渲染省电（画面被遮住） */
  setRenderPaused(paused: boolean): void {
    this.renderPaused = paused;
    if (!paused) this.invalidate();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrameTime = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      this.rafId = requestAnimationFrame(loop);
      const dt = Math.min((now - this.lastFrameTime) / 1000, 0.1);
      this.lastFrameTime = now;

      for (const updater of [...this.updaters]) {
        if (!updater(dt)) this.updaters.delete(updater);
      }
      // 补间是短时的，且并非每个 onUpdate 都会自行 invalidate，统一按帧出图
      if (this.tweens.update(dt)) this.needsRender = true;

      if (this.needsRender && !this.renderPaused) {
        this.needsRender = false;
        this.renderer.render(this.scene, this.camera);
        if (this.afterRender.size > 0) {
          const waiters = [...this.afterRender];
          this.afterRender.clear();
          for (const resolve of waiters) resolve();
        }
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    for (const resolve of this.afterRender) resolve();
    this.afterRender.clear();
    this.renderer.dispose();
  }
}
