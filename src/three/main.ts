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
import { AssetLoader } from './core/AssetLoader';
import { BookRenderer } from './content/BookRenderer';
import { ScreenOS } from './content/ScreenOS';
import { DrawerItems } from './content/DrawerItems';
import { withBase } from '../lib/url';
import { HOTSPOTS, type HotspotId } from '../lib/hotspots';
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
  private bookRenderer: BookRenderer | null = null;
  private screenOS: ScreenOS | null = null;
  private drawerItems: DrawerItems | null = null;
  /** 当前就地阅读聚焦的热点（notebook 书页 / monitor 屏幕系统） */
  private inSceneId: HotspotId | null = null;
  /** desk.glb 后台加载完成（占位路径下立即 resolved） */
  private deskReady: Promise<void> = Promise.resolve();

  async init(canvas: HTMLCanvasElement, opts: InitOptions = {}): Promise<void> {
    // canvas 尺寸就绪后再初始化（Astro 水合时机与布局竞态防护）
    await this.waitForSize(canvas);

    this.manager = new SceneManager(canvas);
    this.manager.onContextLost = () => this.bus.emit('contextlost');
    this.manager.setQuality(opts.quality ?? 'high');

    await this.composeScene();

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

    // 趁首屏白色期等待 HDRI 就绪：preload 后命中缓存，PMREM 同步处理很快，
    // 换来首帧已是最终环境贴图，消除 scene.environment 替换的可见突变
    await this.lighting.awaitEnvironment();

    this.manager.start();

    // desk.glb 到位后重建热点命中盒并重放光照（灯泡/屏幕强度落到新材质）
    void this.deskReady.then(() => {
      this.hotspots.build();
      // 只重放当前光照到新材质，不重算 current（入口渐亮期间重算会覆盖 setEntryReveal）
      this.lighting.reapplyValues();
      // 书页渲染器：把文章排版到笔记本书页上（就地阅读）
      this.bookRenderer = new BookRenderer(this.manager, this.registry);
      this.bookRenderer.onRequestExit = () => void this.unfocus();
      // 就地聚焦的点击分发：显示器聚焦时画布点击都视为「屏幕外」（DOM 屏幕自行消费自己的事件）
      this.interaction.onBookClick = (rc) => {
        if (this.inSceneId === 'monitor') return false;
        return this.bookRenderer?.handleClick(rc) ?? false;
      };
      this.interaction.onBookHover = (rc) => {
        if (this.inSceneId === 'monitor') return false;
        return this.bookRenderer?.hitTest(rc) ?? false;
      };
      this.interaction.onBookMiss = () => void this.unfocus();
      void this.bookRenderer.mount();
      // 屏幕系统：把可操作的桌面 OS 贴进显示器（失败时静默保留贴图屏幕）
      this.screenOS = new ScreenOS(this.manager, this.registry);
      this.screenOS.onRequestExit = () => void this.unfocus();
      this.screenOS.mount();
      // 抽屉物件：拉开后可点的小物 + 彩蛋卡片（不弹 HTML 面板）
      this.drawerItems = new DrawerItems(this.manager, this.registry);
      this.drawerItems.onRequestExit = () => void this.unfocus();
      this.interaction.onDrawerClick = (rc) =>
        this.drawerItems?.handleClick(rc) ?? false;
      this.interaction.onDrawerHover = (rc) =>
        this.drawerItems?.hitTest(rc) ?? false;
      this.interaction.onDrawerMiss = () => void this.unfocus();
      void this.drawerItems.mount();
      if (this.state === 'idle' || this.state === 'focusing' || this.state === 'focused') {
        this.screenOS.setRevealed(true);
      }
      this.manager.invalidate();
    });

    const dayBlend = LightingSystem.initialDayBlend();
    const lamp = opts.lamp ?? 'ambient';

    if (opts.skipEntry) {
      await this.deskReady;
      this.state = 'idle';
      this.rig.snapTo(HOME_POSE);
      this.lighting.snapTo({ phase: 'scene', dayBlend, lamp });
      this.clock.setToRealTime();
      this.interaction.mode = 'scene';
      this.rig.enableInput(true);
      this.screenOS?.setRevealed(true);
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

  /**
   * 场景来源：优先 GLTF（Blender 产物），失败回落占位几何体。
   * dev 下 ?placeholder=1 强制占位（对比调试）。
   */
  private async composeScene(): Promise<void> {
    const params = new URLSearchParams(location.search);
    const forcePlaceholder = import.meta.env.DEV && params.has('placeholder');
    const loader = new AssetLoader();

    if (!forcePlaceholder) {
      const clockScene = await loader.load(withBase('/models/clock.glb'));
      if (clockScene) {
        AssetLoader.prepare(clockScene);
        AssetLoader.ensureHandPivots(clockScene);
        AssetLoader.ensureClockHitProxy(clockScene);
        this.manager.scene.add(clockScene);
        this.registry.resolve(this.manager.scene);
        this.bus.emit('assets:progress', { loaded: 1, total: 2 });
        // 书桌在入口时钟交互期间后台并载；加载被仪式感吸收
        this.deskReady = loader.load(withBase('/models/desk.glb')).then((deskScene) => {
          if (deskScene) {
            AssetLoader.prepare(deskScene);
            this.manager.scene.add(deskScene);
            this.registry.resolve(this.manager.scene);
          }
          this.bus.emit('assets:progress', { loaded: 2, total: 2 });
        });
        return;
      }
    }

    const { root } = buildPlaceholderScene();
    this.manager.scene.add(root);
    this.registry.resolve(this.manager.scene);
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

    // 秒针已启动、短句显示中；停一拍让仪式感落地。
    // 若 desk.glb 未就绪则自然停驻在「时间继续了。」画面等待。
    await sleep(1.6);
    await this.deskReady;

    // 房间苏醒：光照渐变 + 指针扫向真实时间，同时相机开始后退
    void this.lighting.transitionTo({ phase: 'scene', dayBlend, lamp }, 4.5);
    void this.clock.sweepToRealTime(2.2);
    this.clock.setTickGlow(0);
    // 相机后退时显示器随房间一起「亮起」
    this.screenOS?.setRevealed(true);
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

    const inScene = HOTSPOTS[id].behavior === 'in-scene';
    // 就地阅读：飞行期间并行加载内容（书页目录 / 屏幕系统 partial 预取）
    if (inScene && id === 'notebook') void this.bookRenderer?.prepare();
    if (inScene && id === 'monitor') this.screenOS?.prepare();

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
    if (inScene) {
      // 就地阅读：点击交给书页 / 屏幕 / 抽屉物件，
      // 不发 focusComplete（HTML 层不加背景虚化、不开面板）
      this.inSceneId = id;
      this.interaction.mode = id === 'drawer' ? 'drawer' : 'book';
      if (id === 'notebook') this.bookRenderer?.setFocused(true);
      else if (id === 'monitor') this.screenOS?.setFocused(true);
      else if (id === 'drawer') this.drawerItems?.setFocused(true);
      return;
    }
    const rect =
      this.hotspots.anchorRect(id) ?? new DOMRectReadOnly(0, 0, 0, 0);
    this.bus.emit('camera:focusComplete', { id, anchorRect: rect });
  }

  async unfocus(): Promise<void> {
    if (this.state !== 'focused' && this.state !== 'focusing') return;
    this.state = 'unfocusing';
    this.interaction.mode = 'disabled';
    this.inSceneId = null;
    this.bookRenderer?.setFocused(false);
    this.screenOS?.setFocused(false);
    this.drawerItems?.setFocused(false);
    this.hotspots.setDrawerOpen(false, () => this.audio.drawer());

    await this.rig.flyTo(HOME_POSE, 0.7);
    this.state = 'idle';
    this.interaction.mode = 'scene';
    this.rig.enableInput(true);
    this.clock.quietTicks = false;
    this.bus.emit('camera:unfocusComplete');
  }

  /** 书页渲染器（desk.glb 未就绪或占位场景时为 null） */
  get book(): BookRenderer | null {
    return this.bookRenderer;
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
    this.screenOS?.dispose();
    this.bookRenderer?.dispose();
    this.drawerItems?.dispose();
    this.interaction?.dispose();
    this.manager?.dispose();
    this.bus.clear();
  }
}

export function createDeskScene(): DeskScene {
  return new DeskScene();
}
