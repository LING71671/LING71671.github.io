import { SceneManager } from './core/SceneManager';
import { EventBus, type DeskEvents } from './core/EventBus';
import { NodeRegistry } from './core/NodeRegistry';
import { CameraRig } from './camera/CameraRig';
import { ENTRY_POSE, HOME_POSE, FOCUS_POSES, resolveFocusPose } from './camera/poses';
import { LightingSystem } from './lighting/LightingSystem';
import { AudioManager } from './audio/AudioManager';
import { ClockController } from './interaction/ClockController';
import { HotspotSystem } from './interaction/HotspotSystem';
import { InteractionManager } from './interaction/InteractionManager';
import { buildPlaceholderScene } from './placeholder/PlaceholderDesk';
import type { HotspotId } from '../lib/hotspots';
import type { QualityTier } from '../scripts/desk/storage';

export type AppState =
  | 'loading'
  | 'entry'
  | 'transition'
  | 'idle'
  | 'focusing'
  | 'focused'
  | 'unfocusing';

export interface InitOptions {
  /** 会话内已完成校准 → 直接进入主场景（产品逻辑自动管理，非用户可见跳过入口） */
  skipEntry?: boolean;
  quality?: QualityTier;
  lamp?: LampMode;
  muted?: boolean;
}

const sleep = (s: number) => new Promise<void>((r) => setTimeout(r, s * 1000));

/**
 * 3D 书桌场景 —— 对 HTML 层的唯一边界。
 * 只发事件、不碰 DOM 结构 / URL / 存储。
 */
export class DeskScene {
  private bus = new EventBus();
  private manager!: SceneManager;
  private registry = new NodeRegistry();
  private rig!: CameraRig;
  private lighting!: LightingSystem;
  private audio = new AudioManager();
  private clock!: ClockController;
  private hotspots!: HotspotSystem;
  private interaction!: InteractionManager;
  private state: AppState = 'loading';
  private resizeObserver: ResizeObserver | null = null;

  async init(canvas: HTMLCanvasElement, opts: InitOptions = {}): Promise<void> {
    // canvas 尺寸就绪后再初始化（Astro 水合时机与布局竞态防护）
    await this.waitForSize(canvas);

    this.manager = new SceneManager(canvas);
    this.manager.onContextLost = () => this.bus.emit('contextlost');
    this.manager.setQuality(opts.quality ?? 'high');

    const { root } = buildPlaceholderScene();
    this.manager.scene.add(root);
    this.registry.resolve(this.manager.scene);

    this.rig = new CameraRig(this.manager);
    this.lighting = new LightingSystem(this.manager, this.registry);
    this.clock = new ClockController(this.manager, this.registry, this.bus, this.audio);
    this.hotspots = new HotspotSystem(this.manager, this.registry, this.bus);
    this.hotspots.build();
    this.interaction = new InteractionManager(
      this.manager,
      this.rig,
      this.clock,
      this.hotspots,
      this.audio,
      this.bus,
    );

    this.audio.setMuted(opts.muted ?? true);

    // 校准接近 → 刻度渐亮 + 环境微亮（0-25% 预热）
    this.bus.on('clock:progress', ({ minutesOff }) => {
      const closeness = Math.max(0, 1 - minutesOff / 30);
      this.clock.setTickGlow(closeness);
      if (this.state === 'entry') {
        this.lighting.setEntryReveal(closeness * 0.18);
      }
    });

    this.resizeObserver = new ResizeObserver(() => this.manager.resize());
    this.resizeObserver.observe(canvas);
    this.manager.resize();
    this.manager.start();

    const dayBlend = LightingSystem.initialDayBlend();
    const lamp = opts.lamp ?? 'ambient';

    if (opts.skipEntry) {
      this.state = 'idle';
      this.rig.snapTo(HOME_POSE);
      this.lighting.snapTo({ phase: 'scene', dayBlend, lamp });
      this.clock.setToRealTime();
      this.interaction.mode = 'scene';
      this.rig.enableInput(true);
      this.bus.emit('scene:ready');
      this.bus.emit('entry:complete');
      return;
    }

    this.state = 'entry';
    this.rig.snapTo(ENTRY_POSE);
    this.lighting.snapTo({ phase: 'entry', dayBlend, lamp });
    this.clock.begin();
    this.interaction.mode = 'entry';
    this.clock.onSuccess = () => void this.runEntrySequence(dayBlend, lamp);
    this.bus.emit('scene:ready');
  }

  private waitForSize(canvas: HTMLCanvasElement): Promise<void> {
    if (canvas.clientWidth > 0 && canvas.clientHeight > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const observer = new ResizeObserver(() => {
        if (canvas.clientWidth > 0 && canvas.clientHeight > 0) {
          observer.disconnect();
          resolve();
        }
      });
      observer.observe(canvas);
    });
  }

  /** 成功 → 「时间继续了。」→ 房间苏醒 → 相机后退 → 主场景 */
  private async runEntrySequence(dayBlend: number, lamp: LampMode): Promise<void> {
    this.state = 'transition';
    this.interaction.mode = 'disabled';

    // 秒针已启动、短句显示中；停一拍让仪式感落地
    await sleep(1.6);

    // 房间苏醒：光照渐变 + 指针扫向真实时间，同时相机开始后退
    void this.lighting.transitionTo({ phase: 'scene', dayBlend, lamp }, 4.5);
    void this.clock.sweepToRealTime(2.2);
    this.clock.setTickGlow(0);
    await this.rig.flyTo(HOME_POSE, 8);

    this.state = 'idle';
    this.interaction.mode = 'scene';
    this.rig.enableInput(true);
    this.bus.emit('entry:complete');
  }

  // —— DeskSceneAPI ——

  on<K extends keyof DeskEvents>(
    event: K,
    handler: (payload: DeskEvents[K]) => void,
  ): () => void {
    return this.bus.on(event, handler);
  }

  getState(): AppState {
    return this.state;
  }

  async focusHotspot(id: HotspotId): Promise<void> {
    if (this.state !== 'idle') return;
    const def = FOCUS_POSES[id];
    const anchor = this.hotspots.anchorWorld(id);
    if (!def || !anchor) return;

    this.state = 'focusing';
    this.interaction.mode = 'disabled';
    this.rig.disableInput();
    this.hotspots.setHovered(null, 0, 0);
    this.clock.quietTicks = true;
    if (id === 'drawer') {
      this.hotspots.setDrawerOpen(true, () => this.audio.drawer());
    }

    await this.rig.flyTo(resolveFocusPose(def, anchor), 0.8);
    this.state = 'focused';
    const rect =
      this.hotspots.anchorRect(id) ?? new DOMRectReadOnly(0, 0, 0, 0);
    this.bus.emit('camera:focusComplete', { id, anchorRect: rect });
  }

  async unfocus(): Promise<void> {
    if (this.state !== 'focused' && this.state !== 'focusing') return;
    this.state = 'unfocusing';
    this.hotspots.setDrawerOpen(false, () => this.audio.drawer());

    await this.rig.flyTo(HOME_POSE, 0.7);
    this.state = 'idle';
    this.interaction.mode = 'scene';
    this.rig.enableInput(true);
    this.clock.quietTicks = false;
    this.bus.emit('camera:unfocusComplete');
  }

  project(id: HotspotId): { x: number; y: number } | null {
    return this.hotspots.project(id);
  }

  anchorRect(id: HotspotId): DOMRectReadOnly | null {
    return this.hotspots.anchorRect(id);
  }

  setLampMode(mode: LampMode): void {
    this.audio.lampClick();
    void this.lighting.transitionTo({ lamp: mode }, 1.0);
    this.bus.emit('lamp:modeChange', { mode });
  }

  setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  setQuality(tier: QualityTier): void {
    this.manager.setQuality(tier);
  }

  setInputEnabled(enabled: boolean): void {
    if (!enabled) {
      this.interaction.mode = 'disabled';
      return;
    }
    this.interaction.mode = this.state === 'entry' ? 'entry' : 'scene';
  }

  /** 面板全开时暂停渲染省电 */
  setRenderPaused(paused: boolean): void {
    this.manager.setRenderPaused(paused);
  }

  /** GLTF 换模验收工具 */
  validateContract(): string[] {
    return this.registry.validateContract();
  }

  /** dev/test：直接完成时钟（生产构建不暴露入口） */
  debugCompleteClock(): void {
    if (this.state !== 'entry') return;
    this.clock.setToRealTime();
    void this.runEntrySequence(LightingSystem.initialDayBlend(), 'ambient');
  }

  dispose(): void {
    this.resizeObserver?.disconnect();
    this.interaction?.dispose();
    this.manager?.dispose();
    this.bus.clear();
  }
}

export function createDeskScene(): DeskScene {
  return new DeskScene();
}
