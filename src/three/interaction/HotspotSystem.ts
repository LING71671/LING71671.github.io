import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import type { EventBus } from '../core/EventBus';
import { NODES, type NodeName } from '../config/naming';
import { HOTSPOTS, type HotspotId } from '../../lib/hotspots';
import { LAYOUT } from '../config/layout';
import { easeOutCubic } from '../utils/tween';

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

/**
 * 热点系统：不可见命中盒（由锚点包围盒生成）、hover 高亮（浮起 + 自发光）、
 * 抽屉动画、屏幕坐标投影（HUD 提示与面板展开起点）。
 */
export class HotspotSystem {
  private hitboxes: THREE.Mesh[] = [];
  private hoveredId: HotspotId | null = null;
  private baseY = new Map<HotspotId, number>();
  private emissiveMats = new Map<HotspotId, THREE.MeshStandardMaterial[]>();
  private drawerOpen = false;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
    private bus: EventBus,
  ) {}

  /** 场景就绪后构建命中盒并克隆材质（高亮不影响共享材质） */
  build(): void {
    for (const hitbox of this.hitboxes) hitbox.removeFromParent();
    this.hitboxes = [];
    this.emissiveMats.clear();

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

      // 克隆锚点下的标准材质（每热点独立，hover 提亮）
      const mats: THREE.MeshStandardMaterial[] = [];
      anchor.traverse((obj) => {
        if (obj instanceof THREE.Mesh && obj.material instanceof THREE.MeshStandardMaterial) {
          // 灯泡/屏幕材质本身承担自发光职责，不参与 hover 提亮
          if (obj.name === NODES.lampBulb || obj.name === NODES.monitorScreen) return;
          const cloned = obj.material.clone();
          obj.material = cloned;
          mats.push(cloned);
        }
      });
      this.emissiveMats.set(id, mats);
    }
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
    const anchor = this.registry.get(ANCHORS[id]);
    if (!anchor) return;
    // 窗户不浮起（固定在墙上）
    const canLift = id !== 'window';
    const baseY = this.baseY.get(id) ?? anchor.position.y;
    const fromY = anchor.position.y;
    const toY = on && canLift ? baseY + 0.008 : baseY;

    const mats = this.emissiveMats.get(id) ?? [];
    const fromE = mats[0]?.emissiveIntensity ?? 0;
    const toE = on ? 0.22 : 0;
    for (const mat of mats) mat.emissive.setHex(0xc9a45c);

    this.manager.tweens.run({
      duration: 0.18,
      ease: easeOutCubic,
      onUpdate: (t) => {
        anchor.position.y = fromY + (toY - fromY) * t;
        for (const mat of mats) {
          mat.emissiveIntensity = fromE + (toE - fromE) * t;
        }
        this.manager.invalidate();
      },
    });
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
