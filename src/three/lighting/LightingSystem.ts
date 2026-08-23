import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import { NODES } from '../config/naming';
import { CLOCK_CENTER, LAYOUT } from '../config/layout';
import { withBase } from '../../lib/url';
import {
  cloneValues,
  dayBlendFromDate,
  entryValues,
  lerpValues,
  lightingFromDate,
  type LightingValues,
  type TimeLightingSample,
} from './presets';
import { SkyWindow } from './SkyWindow';
import { WindowView } from './WindowView';
import { easeInOutCubic, type Tween } from '../utils/tween';

export interface LightingState {
  /** entry 保留现实色温，但压低环境；scene 为完整现实时间状态 */
  phase: 'entry' | 'scene';
  /** 人工灯只叠加于现实时间，不再覆盖太阳和天空 */
  lamp: LampMode;
}

/**
 * 连续现实时间摄影光照。
 *
 * 太阳位于窗外，真实穿过窗洞 / 窗框形成长影；RectAreaLight 提供大面积天空填充；
 * 台灯由 Spot + 无投影 Point 组合，避免夜间只有一枚硬光锥。
 */
export class LightingSystem {
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private windowArea: THREE.RectAreaLight;
  private windowPattern: THREE.SpotLight;
  private windowPatternTexture: THREE.CanvasTexture;
  private lampSpot: THREE.SpotLight;
  private lampBounce: THREE.PointLight;
  private clockFill: THREE.PointLight;
  private sky: SkyWindow;
  private fog: THREE.FogExp2;
  private background = new THREE.Color();
  private windowView: WindowView | null = null;
  private windowMesh: THREE.Mesh | null = null;
  private current: LightingValues;
  private sample: TimeLightingSample;
  private state: LightingState = { phase: 'entry', lamp: 'ambient' };
  private realtimeTimer = 0;
  private transitionTween: Tween | null = null;
  private transitionResolve: (() => void) | null = null;
  private environmentTexture: THREE.Texture | null = null;
  private environmentUpgradeStarted = false;
  private disposed = false;
  private curtainProgress = 0;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
  ) {
    const scene = manager.scene;
    RectAreaLightUniformsLib.init();

    this.sample = lightingFromDate(LightingSystem.now());
    this.current = entryValues(this.sample.values);

    this.hemi = new THREE.HemisphereLight(0xdbe8f0, 0x6a5038, 0.4);
    scene.add(this.hemi);

    // 灯在墙后，光线必须真正穿过窗洞，窗框才会在墙面与桌上留下结构化阴影。
    this.sun = new THREE.DirectionalLight(0xffeed5, 1.8);
    this.sun.position.copy(this.current.sunPosition);
    this.sun.target.position.copy(this.current.sunTarget);
    this.sun.castShadow = true;
    this.sun.shadow.intensity = 0.86;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.camera.left = -1.65;
    this.sun.shadow.camera.right = 1.65;
    this.sun.shadow.camera.top = 2.4;
    this.sun.shadow.camera.bottom = -0.12;
    this.sun.shadow.camera.near = 0.25;
    this.sun.shadow.camera.far = 9;
    this.sun.shadow.bias = -0.00045;
    this.sun.shadow.normalBias = 0.018;
    this.sun.shadow.radius = 4;
    this.sun.shadow.blurSamples = 12;
    scene.add(this.sun, this.sun.target);

    this.windowArea = new THREE.RectAreaLight(0xd9e8ee, 2.4, LAYOUT.window.w, LAYOUT.window.h);
    this.windowArea.position.set(LAYOUT.window.x, LAYOUT.window.y, LAYOUT.wallZ + 0.035);
    this.windowArea.lookAt(0.05, 0.58, 0.2);
    scene.add(this.windowArea);

    // 摄影 gobo：无阴影 cookie 聚光只补窗格结构，与真实太阳分工，
    // 避免为了墙影把桌面方向光推到过曝，也不增加一张动态 shadow map。
    this.windowPatternTexture = this.createWindowPatternTexture();
    this.windowPattern = new THREE.SpotLight(0xffd2a0, 0, 6, 0.7, 0.4, 1.2);
    this.windowPattern.name = 'window_pattern_projection';
    this.windowPattern.position.set(-1.15, 2.5, 1.8);
    this.windowPattern.target.position.set(0.65, 1.25, LAYOUT.wallZ);
    this.windowPattern.map = this.windowPatternTexture;
    this.windowPattern.castShadow = false;
    scene.add(this.windowPattern, this.windowPattern.target);

    this.lampSpot = new THREE.SpotLight(0xffb46b, 0, 3.1, 0.52, 0.72, 1.8);
    this.lampSpot.position.set(LAYOUT.lamp.x, 1.2, LAYOUT.lamp.z);
    this.lampSpot.target.position.set(0.02, 0.73, 0.09);
    this.lampSpot.shadow.intensity = 0.78;
    this.lampSpot.shadow.mapSize.set(1024, 1024);
    this.lampSpot.shadow.bias = -0.0005;
    this.lampSpot.shadow.normalBias = 0.014;
    this.lampSpot.shadow.radius = 3;
    this.lampSpot.shadow.blurSamples = 8;
    scene.add(this.lampSpot, this.lampSpot.target);

    // 桌面二次反弹位于主光锥下方、稍靠观者：既托住灯旁物件，也让深色抽屉
    // 在夜景中留有极弱木纹，而不是剪成一整块纯黑。
    this.lampBounce = new THREE.PointLight(0xffb46b, 0, 2.2, 2);
    this.lampBounce.position.set(-0.25, 0.55, 0.75);
    scene.add(this.lampBounce);

    this.clockFill = new THREE.PointLight(0xd8b878, 0, 0.82, 1.7);
    this.clockFill.position.set(
      CLOCK_CENTER.x + 0.08,
      CLOCK_CENTER.y + 0.1,
      CLOCK_CENTER.z + 0.3,
    );
    scene.add(this.clockFill);

    this.fog = new THREE.FogExp2(this.current.fogColor, this.current.fogDensity);
    scene.fog = this.fog;
    scene.background = this.background;
    this.sky = new SkyWindow(scene);
    this.resolveWindowView();
    this.setupEnvironment();
    this.applyValues(this.current);
    this.updateShadowCasters();
  }

  private createWindowPatternTexture(): THREE.CanvasTexture {
    const size = 192;
    const canvas = document.createElement('canvas');
    const stencil = document.createElement('canvas');
    canvas.width = stencil.width = size;
    canvas.height = stencil.height = size;
    const context = canvas.getContext('2d');
    const stencilContext = stencil.getContext('2d');
    if (context && stencilContext) {
      stencilContext.fillStyle = 'rgba(255,255,255,0.88)';
      const panes: Array<[number, number, number, number]> = [
        [5, 7, 51, 78], [70, 7, 51, 78], [135, 7, 51, 78],
        [5, 107, 51, 78], [70, 107, 51, 78], [135, 107, 51, 78],
      ];
      for (const pane of panes) stencilContext.fillRect(...pane);
      context.clearRect(0, 0, size, size);
      context.filter = 'blur(3.2px)';
      context.drawImage(stencil, 0, 0);
      context.filter = 'none';
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.name = 'window-pattern-gobo';
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    return texture;
  }

  /** 生产永远使用设备本地时间；开发环境允许 ?time=HH:MM 做四时视觉验收。 */
  static now(): Date {
    const now = new Date();
    if (!import.meta.env.DEV || typeof location === 'undefined') return now;
    const raw = new URLSearchParams(location.search).get('time');
    const match = raw?.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    if (!match) return now;
    now.setHours(Number(match[1]), Number(match[2]), 0, 0);
    return now;
  }

  static initialDayBlend(): number {
    return dayBlendFromDate(LightingSystem.now());
  }

  static initialTime(): TimeLightingSample {
    return lightingFromDate(LightingSystem.now());
  }

  /** 四张同机位窗景很小，作为完整首帧的一部分原子准备。失败时保留 GLB 内置照片。 */
  async prepare(): Promise<void> {
    if (!this.windowView) return;
    try {
      await this.windowView.load(this.sample.minute);
      this.sky.mesh.visible = false;
      this.applyValues(this.current);
    } catch (error) {
      if (import.meta.env.DEV) console.warn('[desk] 四时窗景加载失败，保留内置窗景', error);
    }
  }

  startRealtime(): void {
    if (this.realtimeTimer) return;
    // 每 30 秒重新采样；值本身按秒连续，切换后用 2.4 秒缓动消除定时器台阶。
    this.realtimeTimer = window.setInterval(() => this.syncToDate(LightingSystem.now()), 30_000);
  }

  getState(): LightingState {
    return { ...this.state };
  }

  getTimeSample(): TimeLightingSample {
    return {
      ...this.sample,
      values: cloneValues(this.sample.values),
    };
  }

  private resolveWindowView(): void {
    const node = this.registry.get(NODES.windowView);
    if (!(node instanceof THREE.Mesh)) return;
    this.windowMesh = node;
    const material = node.material;
    if (!(material instanceof THREE.MeshBasicMaterial)) return;
    this.windowView = new WindowView(
      node,
      () => this.manager.invalidate(),
      this.manager.renderer.capabilities.getMaxAnisotropy(),
    );
    this.sky.mesh.visible = false;
  }

  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.manager.renderer);
    const scene = this.manager.scene;
    this.environmentTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environment = this.environmentTexture;
    pmrem.dispose();
  }

  /** 海报与首帧共用 RoomEnvironment；遮罩移除后再异步升级 HDR。 */
  releaseLoaderHandoff(): void {
    if (this.environmentUpgradeStarted || this.disposed) return;
    this.environmentUpgradeStarted = true;
    const pmrem = new THREE.PMREMGenerator(this.manager.renderer);
    const scene = this.manager.scene;
    new HDRLoader()
      .loadAsync(withBase('/env/artist_workshop_1k.hdr'))
      .then((hdr) => {
        const envMap = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        pmrem.dispose();
        if (this.disposed) {
          envMap.dispose();
          return;
        }
        // 不经「反射淡到黑」的中间态：它会让整个房间在 loader 后明显闪暗。
        // HDR 只替换材质反射来源，环境强度始终由当前现实时间 preset 连续控制。
        this.environmentTexture?.dispose();
        this.environmentTexture = envMap;
        scene.environment = envMap;
        scene.environmentIntensity = this.current.envI;
        this.manager.invalidate();
      })
      .catch(() => pmrem.dispose());
  }

  private computeTarget(state: LightingState): LightingValues {
    const base = cloneValues(this.sample.values);

    // 模式只控制室内人工灯，不得把现实中的正午改成“夜晚天空”。
    if (state.lamp === 'focus') {
      base.lampI = Math.max(base.lampI, 2.85);
      base.bulbE = Math.max(base.bulbE, 1.55);
      base.windowI *= 0.9;
      base.screenE *= 0.82;
    } else if (state.lamp === 'night') {
      base.lampI = Math.max(base.lampI, 2.35);
      base.bulbE = Math.max(base.bulbE, 1.4);
      // 白天手动切到夜间模式才压暗自然光；现实深夜的 preset 已经完成低调曝光，
      // 再乘一次会吞掉抽屉和热点轮廓。
      if (base.sunI > 0.15) {
        base.sunI *= 0.78;
        base.windowI *= 0.82;
        base.exposure *= 0.94;
      }
    }

    return state.phase === 'entry' ? entryValues(base) : base;
  }

  transitionTo(next: Partial<LightingState>, duration = 1): Promise<void> {
    this.state = { ...this.state, ...next };
    return this.transitionCurrent(duration);
  }

  private transitionCurrent(duration: number): Promise<void> {
    const from = cloneValues(this.current);
    const to = this.computeTarget(this.state);
    let lastShadowAt = 0;

    this.transitionTween?.cancel();
    this.transitionTween = null;
    this.transitionResolve?.();
    this.transitionResolve = null;

    return new Promise((resolve) => {
      this.transitionResolve = resolve;
      this.transitionTween = this.manager.tweens.run({
        duration,
        ease: easeInOutCubic,
        onUpdate: (t) => {
          lerpValues(this.current, from, to, t);
          this.applyValues(this.current);
          const now = performance.now();
          if (now - lastShadowAt > 120) {
            lastShadowAt = now;
            this.manager.updateShadows();
          }
        },
        onComplete: () => {
          this.transitionTween = null;
          this.transitionResolve = null;
          this.updateShadowCasters();
          resolve();
        },
      });
    });
  }

  syncToDate(date: Date, duration = 2.4): void {
    const next = lightingFromDate(date);
    if (Math.abs(next.minute - this.sample.minute) < 0.01) return;
    this.sample = next;
    this.windowView?.setMinute(next.minute);
    void this.transitionCurrent(duration);
  }

  reapplyValues(): void {
    this.applyValues(this.current);
    this.updateShadowCasters();
  }

  snapTo(next: Partial<LightingState>): void {
    this.state = { ...this.state, ...next };
    this.current = this.computeTarget(this.state);
    this.applyValues(this.current);
    this.updateShadowCasters();
  }

  /** 入口校准进度只改变亮度，冷暖与太阳方向始终来自当前现实时间。 */
  setEntryReveal(t: number): void {
    const from = this.computeTarget({ ...this.state, phase: 'entry' });
    const to = this.computeTarget({ ...this.state, phase: 'scene' });
    lerpValues(this.current, from, to, THREE.MathUtils.clamp(t, 0, 1));
    this.applyValues(this.current);
    if (t >= 1) this.updateShadowCasters();
  }

  setCurtainDrawn(progress: number): void {
    this.curtainProgress = THREE.MathUtils.clamp(progress, 0, 1);
    this.applyValues(this.current);
  }

  private applyValues(v: LightingValues): void {
    this.hemi.intensity = v.hemiI;
    this.hemi.color.copy(v.hemiSky);
    this.hemi.groundColor.copy(v.hemiGround);

    const directMult = 1 - this.curtainProgress * 0.88;
    const windowMult = 1 - this.curtainProgress * 0.72;
    this.sun.intensity = v.sunI * directMult;
    this.sun.color.copy(v.sunColor);
    this.sun.position.copy(v.sunPosition);
    this.sun.target.position.copy(v.sunTarget);
    this.sun.target.updateMatrixWorld();

    this.windowArea.intensity = v.windowI * windowMult;
    this.windowArea.color.copy(v.windowColor);
    this.windowArea.lookAt(v.sunTarget);

    // 正午 6.4 的摄影量标定为约 2.35 的实际聚光强度；其余锚点连续插值。
    const patternIntensity = Math.max(0, v.patternI * 0.367 * directMult);
    this.windowPattern.intensity = patternIntensity;
    this.windowPattern.color.copy(v.patternColor);
    this.windowPattern.visible = patternIntensity > 0.003;

    this.lampSpot.intensity = v.lampI;
    this.lampSpot.color.copy(v.lampColor);
    this.lampBounce.intensity = v.lampI * 0.045;
    this.lampBounce.color.copy(v.lampColor);
    this.clockFill.intensity = v.clockFillI;

    this.manager.renderer.toneMappingExposure = v.exposure;
    this.manager.scene.environmentIntensity = v.envI;
    this.manager.scene.environmentRotation.y = Math.atan2(v.sunPosition.x, -v.sunPosition.z);
    this.background.copy(v.sceneColor);
    this.fog.color.copy(v.fogColor);
    this.fog.density = v.fogDensity;
    this.sky.setLighting(v);
    this.windowView?.setMinute(this.sample.minute);

    // 四时图片已自行分级；它就绪前才用乘色让 GLB 内置黄昏照片接近当前时段。
    if (this.windowMesh && !this.windowView?.ready) {
      const material = this.windowMesh.material as THREE.MeshBasicMaterial;
      material.color.copy(v.windowTint);
    }

    const bulb = this.registry.get(NODES.lampBulb);
    if (bulb instanceof THREE.Mesh) {
      const material = bulb.material as THREE.MeshStandardMaterial;
      material.emissive.copy(v.lampColor);
      material.emissiveIntensity = v.bulbE;
    }
    const screen = this.registry.get(NODES.monitorScreen);
    if (screen instanceof THREE.Mesh) {
      (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = v.screenE;
    }
    this.manager.invalidate();
  }

  private updateShadowCasters(): void {
    const sunActive = this.current.sunI > 0.12;
    this.sun.castShadow = sunActive;
    this.lampSpot.castShadow = !sunActive && this.current.lampI > 0.45;
    this.manager.updateShadows();
  }

  dispose(): void {
    this.disposed = true;
    if (this.realtimeTimer) window.clearInterval(this.realtimeTimer);
    this.transitionTween?.cancel();
    this.transitionResolve?.();
    this.windowView?.dispose();
    this.sky.dispose();
    this.windowPatternTexture.dispose();
    this.windowPattern.removeFromParent();
    this.windowPattern.target.removeFromParent();
    this.environmentTexture?.dispose();
  }
}
