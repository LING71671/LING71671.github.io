import * as THREE from 'three';
import { TweenRunner } from '../utils/tween';
import type { QualityTier } from '../../scripts/desk/storage';

/**
 * 渲染器与按需渲染循环。
 * 一切视觉变更必须经 invalidate() 请求帧；空闲时零渲染。
 * 持续性动画（阻尼、补间）通过 updaters 注册，返回 true 表示仍活跃。
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

      let active = false;
      for (const updater of [...this.updaters]) {
        if (updater(dt)) active = true;
        else this.updaters.delete(updater);
      }
      if (this.tweens.update(dt)) active = true;
      if (active) this.needsRender = true;

      if (this.needsRender && !this.renderPaused) {
        this.needsRender = false;
        this.renderer.render(this.scene, this.camera);
      }
    };
    this.rafId = requestAnimationFrame(loop);
  }

  dispose(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
    this.renderer.dispose();
  }
}
