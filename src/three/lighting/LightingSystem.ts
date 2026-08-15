import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import { NODES } from '../config/naming';
import { CLOCK_CENTER } from '../config/layout';
import { withBase } from '../../lib/url';
import {
  DAY,
  NIGHT,
  ENTRY,
  cloneValues,
  lerpValues,
  dayBlendFromDate,
  type LightingValues,
} from './presets';
import { SkyWindow } from './SkyWindow';
import { easeInOutCubic } from '../utils/tween';

export interface LightingState {
  /** 'entry' 为入口暗态；否则按昼夜混合 + 台灯档位 */
  phase: 'entry' | 'scene';
  /** 0 夜 – 1 昼（phase='scene' 时生效） */
  dayBlend: number;
  lamp: LampMode;
}

/**
 * 光源装配与状态插值。
 * 光源 ≤4：Hemisphere 填充 + Directional 窗光 + Spot 台灯 + 时钟补光。
 * 同一时刻仅一个 castShadow 光；阴影手动调度。
 */
export class LightingSystem {
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private lampSpot: THREE.SpotLight;
  private clockFill: THREE.PointLight;
  private sky: SkyWindow;
  /** 窗外实景照片（模型提供时存在）；昼夜通过给它调色体现 */
  private windowView: THREE.Mesh | null = null;
  /** desk.glb 是在光照系统建好之后才异步到位的，节点要惰性解析 */
  private windowViewResolved = false;
  private static readonly VIEW_DAY = new THREE.Color(0xffffff);
  private static readonly VIEW_NIGHT = new THREE.Color(0x27334d);

  private current: LightingValues;
  private state: LightingState = { phase: 'entry', dayBlend: 1, lamp: 'ambient' };

  /** 环境贴图强度乘数：HDRI 替换时用它柔化淡入淡出，掩盖 PBR 反射突变 */
  private envDim = 1;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
  ) {
    const scene = manager.scene;

    this.hemi = new THREE.HemisphereLight(0xdbe8f0, 0x8a6a42, 0.6);
    scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xfff1d8, 1.9);
    this.sun.position.set(-1.9, 2.5, 0.7);
    this.sun.target.position.set(0.3, 0.75, -0.1);
    this.sun.castShadow = true;
    this.sun.shadow.intensity = 0.82; // 柔化阴影，避免死黑
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.camera.left = -1.4;
    this.sun.shadow.camera.right = 1.4;
    this.sun.shadow.camera.top = 2.2;
    this.sun.shadow.camera.bottom = 0;
    this.sun.shadow.camera.near = 0.5;
    this.sun.shadow.camera.far = 7;
    this.sun.shadow.bias = -0.002;
    scene.add(this.sun, this.sun.target);

    this.lampSpot = new THREE.SpotLight(0xffb46b, 0, 3.2, 0.62, 0.6, 1.4);
    this.lampSpot.position.set(-0.5, 1.22, -0.14);
    this.lampSpot.target.position.set(0.05, 0.75, 0.08);
    this.lampSpot.shadow.intensity = 0.88;
    this.lampSpot.shadow.mapSize.set(512, 512);
    this.lampSpot.shadow.bias = -0.002;
    scene.add(this.lampSpot, this.lampSpot.target);

    this.clockFill = new THREE.PointLight(0xd8b878, 0, 0.9, 1.6);
    this.clockFill.position.set(CLOCK_CENTER.x + 0.1, CLOCK_CENTER.y + 0.12, CLOCK_CENTER.z + 0.28);
    scene.add(this.clockFill);

    this.sky = new SkyWindow(scene);
    this.setupEnvironment();

    this.current = cloneValues(ENTRY);
    this.applyValues(this.current);
    this.updateShadowCasters();
  }

  /**
   * 环境光照（金属/PBR 材质的反射来源）：
   * 先用 RoomEnvironment 立即可用，HDRI（CC0, Poly Haven artist_workshop）
   * 异步加载完成后替换，得到自然的室内反射与漫射。
   * 替换时用 envDim 把 environmentIntensity 短暂压低再恢复（淡出->换图->淡入），
   * 掩盖 RoomEnvironment->HDR 的 PBR 反射突变，无需阻塞首帧。
   */
  private setupEnvironment(): void {
    const pmrem = new THREE.PMREMGenerator(this.manager.renderer);
    const scene = this.manager.scene;
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    new RGBELoader()
      .loadAsync(withBase('/env/artist_workshop_1k.hdr'))
      .then((hdr) => {
        const envMap = pmrem.fromEquirectangular(hdr).texture;
        hdr.dispose();
        pmrem.dispose();
        // 柔化过渡：淡出反射 -> 换贴图 -> 淡入新反射
        const apply = (): void => {
          scene.environmentIntensity = this.current.envI * this.envDim;
          this.manager.invalidate();
        };
        this.manager.tweens.run({
          duration: 0.25,
          ease: easeInOutCubic,
          onUpdate: (t) => {
            this.envDim = 1 - t;
            apply();
          },
          onComplete: () => {
            // 反射最弱时换贴图（此时替换无感）
            this.envDim = 0;
            scene.environment = envMap;
            apply();
            this.manager.tweens.run({
              duration: 0.25,
              ease: easeInOutCubic,
              onUpdate: (t) => {
                this.envDim = t;
                apply();
              },
              onComplete: () => {
                this.envDim = 1;
                apply();
              },
            });
          },
        });
      })
      .catch(() => {
        pmrem.dispose(); // HDRI 加载失败时保留 RoomEnvironment
      });
  }

  static initialDayBlend(): number {
    return dayBlendFromDate(new Date());
  }

  getState(): LightingState {
    return { ...this.state };
  }

  /** 计算某状态下的目标光照值 */
  private computeTarget(state: LightingState): LightingValues {
    if (state.phase === 'entry') return cloneValues(ENTRY);

    // 台灯档位主导观感（与 HTML data-theme 严格一致）：
    // 环境/专注 = 自然光基底；夜间 = 琥珀夜色。
    // 真实时间的 dayBlend 只在自然光基底内微调（白天全亮，真实夜里选环境模式则给柔和日光）。
    const blend = state.lamp === 'night' ? 0 : Math.max(state.dayBlend, 0.8);
    const base = cloneValues(NIGHT);
    lerpValues(base, NIGHT, DAY, blend);

    if (state.lamp === 'focus') {
      // 专注：台灯亮起聚焦桌面，环境略降、屏幕略暗
      base.lampI = Math.max(base.lampI, 1.5);
      base.bulbE = Math.max(base.bulbE, 1.1);
      base.hemiI *= 0.8;
      base.screenE *= 0.85;
    }
    return base;
  }

  /** 平滑过渡到新状态 */
  transitionTo(next: Partial<LightingState>, duration = 1.0): Promise<void> {
    this.state = { ...this.state, ...next };
    const from = cloneValues(this.current);
    const to = this.computeTarget(this.state);
    // 阴影贴图重建是过渡期掉帧的主因：节流到 ≥150ms 一次，结束时收口
    let lastShadowAt = 0;

    return new Promise((resolve) => {
      this.manager.tweens.run({
        duration,
        ease: easeInOutCubic,
        onUpdate: (t) => {
          lerpValues(this.current, from, to, t);
          this.applyValues(this.current);
          const now = performance.now();
          if (now - lastShadowAt > 150) {
            lastShadowAt = now;
            this.manager.updateShadows();
          }
        },
        onComplete: () => {
          this.updateShadowCasters();
          resolve();
        },
      });
    });
  }

  /**
   * 重放当前光照（不改变数值）：用于 GLTF 到位后让灯泡 / 屏幕 emissive
   * 强度落到新材质上。入口校准渐亮期间 desk.glb 到位时若用 snapTo({}) 会
   * 把 computeTarget 重算为 ENTRY 暗态，覆盖 setEntryReveal 的渐亮，造成
   * 「突然变暗一个度」。这里只重放 applyValues + 阴影，保持 current 不变。
   */
  reapplyValues(): void {
    this.applyValues(this.current);
    this.updateShadowCasters();
  }

  /** 立即应用状态（无过渡） */
  snapTo(next: Partial<LightingState>): void {
    this.state = { ...this.state, ...next };
    this.current = this.computeTarget(this.state);
    this.applyValues(this.current);
    this.updateShadowCasters();
  }

  /** 入口渐亮：t 0-1，从 ENTRY 暗态插值到目标场景态 */
  setEntryReveal(t: number): void {
    const target = this.computeTarget({ ...this.state, phase: 'scene' });
    lerpValues(this.current, ENTRY, target, t);
    this.applyValues(this.current);
    if (t >= 1) this.updateShadowCasters();
  }

  /** 窗帘拉上进度 0=拉开 1=拉上 */
  private curtainProgress = 0;

  /** 窗帘拉上联动：衰减窗外直射光 */
  setCurtainDrawn(progress: number): void {
    this.curtainProgress = progress;
    this.applyValues(this.current);
  }

  private applyValues(v: LightingValues): void {
    this.hemi.intensity = v.hemiI;
    this.hemi.color.copy(v.hemiSky);
    this.hemi.groundColor.copy(v.hemiGround);
    const sunCurtainMult = 1 - this.curtainProgress * 0.65;
    this.sun.intensity = v.sunI * sunCurtainMult;
    this.sun.color.copy(v.sunColor);
    this.lampSpot.intensity = v.lampI;
    this.lampSpot.color.copy(v.lampColor);
    this.clockFill.intensity = v.clockFillI;
    this.manager.renderer.toneMappingExposure = v.exposure;
    this.manager.scene.environmentIntensity = v.envI * this.envDim;
    this.sky.setBlend(v.skyBlend);

    // 窗外照片按昼夜调色：白天原色，夜里压成冷蓝的暗景。
    // 模型带了实景照片就隐藏渐变天空板，否则它会挡在照片前面。
    if (!this.windowViewResolved) {
      const node = this.registry.get(NODES.windowView);
      if (node instanceof THREE.Mesh) {
        this.windowView = node;
        this.sky.mesh.visible = false;
        this.windowViewResolved = true;
      }
    }
    if (this.windowView) {
      const mat = this.windowView.material as THREE.MeshBasicMaterial;
      if (mat.color) {
        mat.color.lerpColors(
          LightingSystem.VIEW_NIGHT,
          LightingSystem.VIEW_DAY,
          v.skyBlend,
        );
      }
    }

    const bulb = this.registry.get(NODES.lampBulb);
    if (bulb instanceof THREE.Mesh) {
      (bulb.material as THREE.MeshStandardMaterial).emissiveIntensity = v.bulbE;
    }
    const screen = this.registry.get(NODES.monitorScreen);
    if (screen instanceof THREE.Mesh) {
      (screen.material as THREE.MeshStandardMaterial).emissiveIntensity = v.screenE;
    }
    this.manager.invalidate();
  }

  /** 同一时刻仅一个 castShadow 光源 */
  private updateShadowCasters(): void {
    const sunActive = this.current.sunI > 0.4;
    this.sun.castShadow = sunActive;
    this.lampSpot.castShadow = !sunActive && this.current.lampI > 0.5;
    this.manager.updateShadows();
  }
}
