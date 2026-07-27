import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { CameraRig } from '../camera/CameraRig';
import type { ClockController } from './ClockController';
import type { HotspotSystem } from './HotspotSystem';
import type { AudioManager } from '../audio/AudioManager';
import type { EventBus } from '../core/EventBus';
import { NODES } from '../config/naming';
import type { HotspotId } from '../../lib/hotspots';

export type InteractionMode = 'disabled' | 'entry' | 'scene' | 'book' | 'drawer';

/**
 * 指针输入统一入口：
 * entry 态 → 时钟拖动；scene 态 → hover / 点击 / 有限环视 / 视差；
 * book 态（聚焦笔记本就地阅读）→ 点击优先交给 BookRenderer，未命中书页视为退出意图；
 * drawer 态（拉开抽屉俯视托盘）→ 点击优先交给 DrawerItems，未命中物件视为退出意图。
 * >8px 位移认定为环视拖拽（与点击区分）；触摸设备禁视差。
 */
export class InteractionManager {
  mode: InteractionMode = 'disabled';

  /** book 态点击分发：返回 true 表示已被书页消费 */
  onBookClick: ((raycaster: THREE.Raycaster) => boolean) | null = null;
  /** book 态点击未命中书页（一般接 unfocus 退出阅读） */
  onBookMiss: (() => void) | null = null;
  /** book 态悬停命中测试（指针样式反馈） */
  onBookHover: ((raycaster: THREE.Raycaster) => boolean) | null = null;

  /** drawer 态点击分发：返回 true 表示已被抽屉物件消费 */
  onDrawerClick: ((raycaster: THREE.Raycaster) => boolean) | null = null;
  /** drawer 态点击未命中物件（一般接 unfocus 合上抽屉） */
  onDrawerMiss: (() => void) | null = null;
  /** drawer 态悬停命中测试（指针样式 + 物件暖起） */
  onDrawerHover: ((raycaster: THREE.Raycaster) => boolean) | null = null;

  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private pointerDown = false;
  private downPos = { x: 0, y: 0 };
  private lastPos = { x: 0, y: 0 };
  private orbiting = false;
  private downHotspot: HotspotId | null = null;
  private isTouch = false;
  private disposers: Array<() => void> = [];

  constructor(
    private manager: SceneManager,
    private rig: CameraRig,
    private clock: ClockController,
    private hotspots: HotspotSystem,
    private audio: AudioManager,
    private bus: EventBus,
  ) {
    const canvas = manager.canvas;
    canvas.style.touchAction = 'none';

    const on = <K extends keyof HTMLElementEventMap>(
      type: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(type, handler as EventListener);
      this.disposers.push(() =>
        canvas.removeEventListener(type, handler as EventListener),
      );
    };

    on('pointerdown', (e) => this.onPointerDown(e));
    on('pointermove', (e) => this.onPointerMove(e));
    on('pointerup', (e) => this.onPointerUp(e));
    on('pointercancel', (e) => this.onPointerUp(e));
    on('pointerleave', () => this.onPointerLeave());
  }

  private updateNdc(e: PointerEvent): void {
    const rect = this.manager.canvas.getBoundingClientRect();
    this.ndc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.manager.camera);
  }

  private onPointerDown(e: PointerEvent): void {
    this.audio.unlock();
    if (this.mode === 'disabled') return;
    this.isTouch = e.pointerType === 'touch';
    this.manager.canvas.setPointerCapture(e.pointerId);
    this.pointerDown = true;
    this.orbiting = false;
    this.downPos = { x: e.clientX, y: e.clientY };
    this.lastPos = { x: e.clientX, y: e.clientY };
    this.updateNdc(e);

    if (this.mode === 'entry') {
      // 命中分针代理（触摸放宽命中：代理本身已覆盖全表盘）
      const proxy = this.manager.scene.getObjectByName(NODES.hitClockMinute);
      const hit = proxy
        ? this.raycaster.intersectObject(proxy, false).length > 0
        : false;
      if (hit) this.clock.onDragStart(this.raycaster.ray);
      else this.clock.onWrongTarget();
      return;
    }

    if (this.mode === 'book' || this.mode === 'drawer') return; // 抬起时统一分发

    // scene：记录按下时的热点，抬起仍在其上才算点击
    this.downHotspot = this.hotspots.pick(this.raycaster);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.mode === 'disabled') return;
    this.updateNdc(e);

    if (this.mode === 'entry') {
      if (this.pointerDown) this.clock.onDragMove(this.raycaster.ray);
      else this.updateEntryCursor();
      return;
    }

    if (this.mode === 'book' || this.mode === 'drawer') {
      // 就地阅读 / 翻抽屉：无环视 / 视差，仅指针样式与物件反馈
      if (!this.pointerDown && !this.isTouch) {
        const hover =
          this.mode === 'book' ? this.onBookHover : this.onDrawerHover;
        this.manager.canvas.style.cursor = hover?.(this.raycaster)
          ? 'pointer'
          : 'default';
      }
      return;
    }

    // —— scene ——
    if (this.pointerDown) {
      const dx = e.clientX - this.downPos.x;
      const dy = e.clientY - this.downPos.y;
      if (!this.orbiting && Math.hypot(dx, dy) > 8) {
        this.orbiting = true;
        this.downHotspot = null;
        this.hotspots.setHovered(null, e.clientX, e.clientY);
      }
      if (this.orbiting && this.rig.orbitEnabled) {
        const rect = this.manager.canvas.getBoundingClientRect();
        this.rig.addOrbitDelta(
          (e.clientX - this.lastPos.x) / rect.width,
          (e.clientY - this.lastPos.y) / rect.height,
        );
      }
      this.lastPos = { x: e.clientX, y: e.clientY };
      return;
    }

    // hover + 视差（触摸无 hover / 无视差）
    if (!this.isTouch) {
      const id = this.hotspots.pick(this.raycaster);
      const rect = this.manager.canvas.getBoundingClientRect();
      this.hotspots.setHovered(id, e.clientX - rect.left, e.clientY - rect.top);
      this.manager.canvas.style.cursor = id ? 'pointer' : 'default';
      this.rig.setParallaxTarget(this.ndc.x, this.ndc.y);
    }
  }

  private onPointerUp(e: PointerEvent): void {
    if (!this.pointerDown) return;
    this.pointerDown = false;

    if (this.mode === 'entry') {
      this.clock.onDragEnd();
      return;
    }

    if (this.mode === 'book' || this.mode === 'drawer') {
      // 位移小于阈值才算点击（与拖拽区分）
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      if (moved <= 8) {
        this.updateNdc(e);
        const isBook = this.mode === 'book';
        const click = isBook ? this.onBookClick : this.onDrawerClick;
        const miss = isBook ? this.onBookMiss : this.onDrawerMiss;
        const handled = click?.(this.raycaster) ?? false;
        if (!handled) miss?.();
      }
      return;
    }

    if (this.mode === 'scene' && !this.orbiting && this.downHotspot) {
      this.updateNdc(e);
      const id = this.hotspots.pick(this.raycaster);
      if (id === this.downHotspot) {
        this.bus.emit('hotspot:click', { id });
      }
    }
    this.orbiting = false;
    this.downHotspot = null;
  }

  private onPointerLeave(): void {
    if (this.mode === 'scene' && !this.pointerDown) {
      this.hotspots.setHovered(null, 0, 0);
      this.rig.setParallaxTarget(0, 0);
    }
  }

  private updateEntryCursor(): void {
    const proxy = this.manager.scene.getObjectByName(NODES.hitClockMinute);
    const hit = proxy
      ? this.raycaster.intersectObject(proxy, false).length > 0
      : false;
    this.manager.canvas.style.cursor = hit ? 'grab' : 'default';
  }

  dispose(): void {
    for (const dispose of this.disposers) dispose();
  }
}
