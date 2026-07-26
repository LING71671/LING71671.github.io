import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import type { EventBus } from '../core/EventBus';
import { NODES, type NodeName } from '../config/naming';
import { HOTSPOTS, type HotspotId } from '../../lib/hotspots';
import { LAYOUT } from '../config/layout';
import { easeOutCubic, type EaseFn, type Tween } from '../utils/tween';

/** 热点 id → 锚点节点 */
const ANCHORS: Record<HotspotId, NodeName> = {
  notebook: NODES.notebookRoot,
  monitor: NODES.monitorRoot,
  calendar: NODES.calendarRoot,
  coffee: NODES.coffeeRoot,
  drawer: NODES.drawerRoot,
  sticky: NODES.stickyRoot,
  lamp: NODES.lampRoot,
  window: NODES.windowRoot,
};

/** 桌面上有「接触光晕」的热点（窗户在墙上、抽屉在桌沿下，均不适用） */
const GLOW_IDS = new Set<HotspotId>([
  'notebook',
  'monitor',
  'calendar',
  'coffee',
  'sticky',
  'lamp',
]);

/** hover 参数：克制的物理反馈，不染色 */
const HOVER = {
  lift: 0, // 不抬起：物件浮空看着假，反馈只靠接触光晕与表面反光
  drawerPeek: 0.014, // 抽屉不抬起，改为轻微探出
  glowOpacity: 0.2, // 接触光晕峰值透明度
  glowOpacityLamp: 0.13, // 台灯自身发光，光晕更收敛
  glowColor: 0xffb46b, // 暖琥珀
  sheenEnv: 0.22, // envMapIntensity 增益比例
  sheenRough: 0.1, // roughness 减益比例
  lampShadeE: 0.05, // 灯罩暖起峰值
  inDur: 0.24,
  outDur: 0.18,
} as const;

/** 轻微回弹（重量感），过冲约 5% */
const easeOutBackSoft: EaseFn = (t) => {
  const c = 1.0;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
};

/** 径向渐变光晕贴图：全局仅生成一次并复用 */
let glowTexture: THREE.CanvasTexture | null = null;
function getGlowTexture(): THREE.CanvasTexture {
  if (glowTexture) return glowTexture;
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.5)');
  g.addColorStop(0.65, 'rgba(255,255,255,0.14)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

interface HoverMat {
  mat: THREE.MeshStandardMaterial;
  rough: number;
  env: number;
}

/**
 * 热点系统：不可见命中盒（由锚点包围盒生成）、hover 反馈（桌面接触光晕 +
 * 微抬起 + 表面反光微增，不做整体染色）、抽屉动画、屏幕坐标投影。
 */
export class HotspotSystem {
  private hitboxes: THREE.Mesh[] = [];
  private hoveredId: HotspotId | null = null;
  private baseY = new Map<HotspotId, number>();
  private hoverMats = new Map<HotspotId, HoverMat[]>();
  private lampShadeMats: THREE.MeshStandardMaterial[] = [];
  private glows = new Map<HotspotId, THREE.Mesh>();
  private hoverK = new Map<HotspotId, number>();
  private hoverTweens = new Map<HotspotId, Tween>();
  private reducedMotion =
    typeof matchMedia === 'function' &&
    matchMedia('(prefers-reduced-motion: reduce)').matches;
  private drawerOpen = false;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
    private bus: EventBus,
  ) {}

  /** 场景就绪后构建命中盒并克隆材质（hover 微调不影响共享材质） */
  build(): void {
    this.resetHover();
    for (const hitbox of this.hitboxes) hitbox.removeFromParent();
    this.hitboxes = [];
    this.hoverMats.clear();
    this.lampShadeMats = [];
    for (const glow of this.glows.values()) {
      glow.removeFromParent();
      glow.geometry.dispose();
      (glow.material as THREE.Material).dispose();
    }
    this.glows.clear();

    for (const id of Object.keys(ANCHORS) as HotspotId[]) {
      const anchor = this.registry.get(ANCHORS[id]);
      if (!anchor) continue;

      const box = new THREE.Box3().setFromObject(anchor);
      if (box.isEmpty()) continue;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      // 命中盒放大，便于点选（触摸端由 InteractionManager 再放宽）
      const pad = Math.max(0.02, Math.min(size.x, size.y, size.z) * 0.2);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size.x + pad, size.y + pad, size.z + pad),
        new THREE.MeshBasicMaterial({ visible: false }),
      );
      mesh.name = `hit_${id}`;
      mesh.position.copy(center);
      mesh.userData.hotspotId = id;
      this.manager.scene.add(mesh);
      this.hitboxes.push(mesh);

      this.baseY.set(id, anchor.position.y);

      // 克隆锚点下的标准材质（每热点独立；hover 仅微调反光，不改颜色）
      const mats: HoverMat[] = [];
      anchor.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          // 灯泡/屏幕材质本身承担自发光职责，不参与 hover 微调
          if (obj.name === NODES.lampBulb || obj.name === NODES.monitorScreen) return;
          const cloned = obj.material.clone();
          obj.material = cloned;
          mats.push({ mat: cloned, rough: cloned.roughness, env: cloned.envMapIntensity });
        }
      });
      this.hoverMats.set(id, mats);

      // 台灯：灯头（灯罩）单独收集，hover 时极轻微暖起
      if (id === 'lamp') {
        const head = this.registry.get(NODES.lampHead);
        head?.traverse((obj) => {
          if (
            obj instanceof THREE.Mesh &&
            obj.material instanceof THREE.MeshStandardMaterial &&
            obj.name !== NODES.lampBulb
          ) {
            obj.material.emissive.setHex(0xffc98a);
            this.lampShadeMats.push(obj.material);
          }
        });
      }

      // 接触光晕：物体正下方桌面上的椭圆暖光（加色混合，默认隐藏）
      if (GLOW_IDS.has(id)) {
        const gw = Math.max(0.13, size.x * 1.45);
        const gd = Math.max(0.13, size.z * 1.45);
        const glow = new THREE.Mesh(
          new THREE.PlaneGeometry(gw, gd),
          new THREE.MeshBasicMaterial({
            map: getGlowTexture(),
            color: HOVER.glowColor,
            transparent: true,
            opacity: 0,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
            toneMapped: false,
          }),
        );
        glow.name = `glow_${id}`;
        glow.rotation.x = -Math.PI / 2;
        glow.position.set(center.x, box.min.y + 0.0015, center.z);
        glow.visible = false;
        glow.renderOrder = 1;
        this.manager.scene.add(glow);
        this.glows.set(id, glow);
      }
    }
  }

  /** 归零所有 hover 状态（重建前调用，避免抬起量污染 baseY） */
  private resetHover(): void {
    for (const tween of this.hoverTweens.values()) tween.cancel();
    this.hoverTweens.clear();
    for (const id of [...this.hoverK.keys()]) {
      if ((this.hoverK.get(id) ?? 0) > 0) this.applyHover(id, 0);
    }
    this.hoverK.clear();
    this.hoveredId = null;
  }

  get raycastTargets(): THREE.Object3D[] {
    return this.hitboxes;
  }

  /** 拾取：返回命中的热点 id */
  pick(raycaster: THREE.Raycaster): HotspotId | null {
    const hits = raycaster.intersectObjects(this.hitboxes, false);
    const first = hits[0]?.object.userData.hotspotId as HotspotId | undefined;
    return first ?? null;
  }

  /** hover 状态切换（含浮起动画与 HUD 事件） */
  setHovered(id: HotspotId | null, screenX: number, screenY: number): void {
    if (id === this.hoveredId) {
      if (id) this.emitHover(id, screenX, screenY);
      return;
    }
    const prev = this.hoveredId;
    this.hoveredId = id;
    if (prev) this.animateHighlight(prev, false);
    if (id) {
      this.animateHighlight(id, true);
      this.emitHover(id, screenX, screenY);
    } else {
      this.bus.emit('hotspot:hover', { id: null, x: screenX, y: screenY });
    }
  }

  private emitHover(id: HotspotId, x: number, y: number): void {
    const def = HOTSPOTS[id];
    this.bus.emit('hotspot:hover', { id, label: def.label, hint: def.hint, x, y });
  }

  private animateHighlight(id: HotspotId, on: boolean): void {
    if (!this.registry.get(ANCHORS[id])) return;
    this.hoverTweens.get(id)?.cancel();

    const from = this.hoverK.get(id) ?? 0;
    const to = on ? 1 : 0;
    if (from === to) return;

    // 减动效：瞬时（光晕/反光直接到位，无位移过程可感知）
    const duration = this.reducedMotion ? 0.01 : on ? HOVER.inDur : HOVER.outDur;
    const ease = on && !this.reducedMotion ? easeOutBackSoft : easeOutCubic;
    const tween = this.manager.tweens.run({
      duration,
      ease,
      onUpdate: (t) => {
        const k = from + (to - from) * t;
        this.hoverK.set(id, k);
        this.applyHover(id, k);
      },
      onComplete: () => this.hoverTweens.delete(id),
    });
    this.hoverTweens.set(id, tween);
  }

  /** 以 hover 进度 k（0-1，可轻微过冲）驱动全部反馈通道 */
  private applyHover(id: HotspotId, k: number): void {
    const anchor = this.registry.get(ANCHORS[id]);
    if (!anchor) return;

    // 微抬起：窗户固定在墙上、抽屉嵌在桌体内，均不抬
    if (id !== 'window' && id !== 'drawer' && !this.reducedMotion) {
      const baseY = this.baseY.get(id);
      if (baseY !== undefined) anchor.position.y = baseY + HOVER.lift * k;
    }

    // 抽屉：轻微探出一条缝（打开状态下不干扰开合动画）
    if (id === 'drawer' && !this.drawerOpen && !this.reducedMotion) {
      const slide = this.registry.get(NODES.drawerSlide);
      if (slide) slide.position.z = HOVER.drawerPeek * Math.max(0, k);
    }

    // 接触光晕淡入淡出
    const glow = this.glows.get(id);
    if (glow) {
      const peak = id === 'lamp' ? HOVER.glowOpacityLamp : HOVER.glowOpacity;
      const mat = glow.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.max(0, peak * k);
      glow.visible = mat.opacity > 0.004;
    }

    // 表面反光微增（不改颜色）：envMap 稍亮、粗糙度稍降
    for (const entry of this.hoverMats.get(id) ?? []) {
      entry.mat.envMapIntensity = entry.env * (1 + HOVER.sheenEnv * k);
      entry.mat.roughness = Math.max(0.04, entry.rough * (1 - HOVER.sheenRough * k));
    }

    // 台灯灯罩极轻微暖起
    if (id === 'lamp') {
      const e = HOVER.lampShadeE * Math.max(0, k);
      for (const mat of this.lampShadeMats) mat.emissiveIntensity = e;
    }

    this.manager.invalidate();
  }

  /** 抽屉滑出/收回（原点在关闭位，+Z 拉出） */
  setDrawerOpen(open: boolean, audioCb?: () => void): void {
    if (this.drawerOpen === open) return;
    this.drawerOpen = open;
    const slide = this.registry.get(NODES.drawerSlide);
    if (!slide) return;
    audioCb?.();
    const from = slide.position.z;
    const to = open ? LAYOUT.drawer.travel : 0;
    this.manager.tweens.run({
      duration: 0.4,
      onUpdate: (t) => {
        slide.position.z = from + (to - from) * t;
        this.manager.invalidate();
      },
      onComplete: () => this.manager.updateShadows(),
    });
  }

  /** 锚点世界坐标 */
  anchorWorld(id: HotspotId): THREE.Vector3 | null {
    const anchor = this.registry.get(ANCHORS[id]);
    if (!anchor) return null;
    const box = new THREE.Box3().setFromObject(anchor);
    return box.isEmpty()
      ? anchor.getWorldPosition(new THREE.Vector3())
      : box.getCenter(new THREE.Vector3());
  }

  /** 锚点屏幕坐标（CSS px） */
  project(id: HotspotId): { x: number; y: number } | null {
    const world = this.anchorWorld(id);
    if (!world) return null;
    return this.projectPoint(world);
  }

  projectPoint(world: THREE.Vector3): { x: number; y: number } {
    const { camera, canvas } = this.manager;
    const ndc = world.clone().project(camera);
    return {
      x: ((ndc.x + 1) / 2) * canvas.clientWidth,
      y: ((1 - ndc.y) / 2) * canvas.clientHeight,
    };
  }

  /** 锚点包围盒的屏幕矩形（面板展开起点） */
  anchorRect(id: HotspotId): DOMRectReadOnly | null {
    const anchor = this.registry.get(ANCHORS[id]);
    if (!anchor) return null;
    const box = new THREE.Box3().setFromObject(anchor);
    if (box.isEmpty()) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const corner = new THREE.Vector3();
    for (let i = 0; i < 8; i++) {
      corner.set(
        i & 1 ? box.max.x : box.min.x,
        i & 2 ? box.max.y : box.min.y,
        i & 4 ? box.max.z : box.min.z,
      );
      const p = this.projectPoint(corner);
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    return new DOMRectReadOnly(minX, minY, maxX - minX, maxY - minY);
  }
}
