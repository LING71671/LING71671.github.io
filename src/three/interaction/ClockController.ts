import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import type { EventBus } from '../core/EventBus';
import type { AudioManager } from '../audio/AudioManager';
import { NODES } from '../config/naming';
import {
  circularDist,
  hmToMinutes,
  minutesToHourAngle,
  minutesToMinuteAngle,
  shortestDeg,
  MINUTES_PER_CYCLE,
} from '../utils/angles';
import { damp } from '../utils/tween';

/** 校准目标：7:20，容差 ±1 分钟 */
const TARGET_MINUTES = hmToMinutes(7, 20);
const TOLERANCE = 1;
/** 初始停摆位：6:50（拖到 7:20 约半圈分针，符合 0-8s 拖动节奏） */
export const LOADER_HANDOFF_MINUTES = hmToMinutes(6, 50);
/** 成功判定需要指针静止驻留的时长（防扫过误判） */
const DWELL_SECONDS = 0.5;

/**
 * 入口校准时钟：
 * 拖动只作用于分针（相对拖拽：跟随指针角增量），时针 1:12 联动；
 * 分钟刻度软磁吸；到达 7:20±1min 且静止 ≥500ms 判定成功。
 */
export class ClockController {
  /** 连续分钟数（可为小数，跨 12 点不回绕） */
  private totalMinutes = LOADER_HANDOFF_MINUTES;
  private displayMinutes = LOADER_HANDOFF_MINUTES;

  private dragging = false;
  private prevPointerAngle = 0;
  private dwell = 0;
  private succeeded = false;
  private startedAt = 0;
  private wrongTargetCount = 0;
  private lastHintAt = 0;
  private lastDetentMinute = Math.round(LOADER_HANDOFF_MINUTES);

  private facePlane = new THREE.Plane();
  private removeUpdater: (() => void) | null = null;

  // 秒针
  private secondRunning = false;
  private secondAngle = 0;
  private secondAccum = 0;
  quietTicks = false;

  onSuccess: (() => void) | null = null;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
    private bus: EventBus,
    private audio: AudioManager,
  ) {}

  /** 进入入口态时调用 */
  begin(): void {
    this.startedAt = performance.now();
    this.succeeded = false;
    this.totalMinutes = LOADER_HANDOFF_MINUTES;
    this.displayMinutes = LOADER_HANDOFF_MINUTES;
    this.applyHands();
    this.wake();
  }

  /** 表盘世界平面（每次拖动开始时刷新，支持相机移动） */
  private updateFacePlane(): void {
    const face = this.registry.require(NODES.clockFace);
    const normal = new THREE.Vector3(0, 0, 1)
      .applyQuaternion(face.getWorldQuaternion(new THREE.Quaternion()))
      .normalize();
    const point = face.getWorldPosition(new THREE.Vector3());
    this.facePlane.setFromNormalAndCoplanarPoint(normal, point);
  }

  /** 射线 → 表盘局部角度（12 点为 0，顺时针为正，deg）；null = 不与平面相交 */
  private pointerAngleFromRay(ray: THREE.Ray): number | null {
    const hit = new THREE.Vector3();
    if (!ray.intersectPlane(this.facePlane, hit)) return null;
    const face = this.registry.require(NODES.clockFace);
    const local = face.worldToLocal(hit.clone());
    return THREE.MathUtils.radToDeg(Math.atan2(local.x, local.y));
  }

  /** InteractionManager：按下命中分针代理 */
  onDragStart(ray: THREE.Ray): void {
    if (this.succeeded) return;
    this.updateFacePlane();
    const angle = this.pointerAngleFromRay(ray);
    if (angle === null) return;
    this.dragging = true;
    this.prevPointerAngle = angle;
    this.dwell = 0;
    this.wake();
  }

  onDragMove(ray: THREE.Ray): void {
    if (!this.dragging || this.succeeded) return;
    const angle = this.pointerAngleFromRay(ray);
    if (angle === null) return;
    const delta = shortestDeg(this.prevPointerAngle, angle);
    this.prevPointerAngle = angle;
    this.totalMinutes += delta / 6;
    this.dwell = 0;
    this.emitProgress();
  }

  onDragEnd(): void {
    if (!this.dragging) return;
    this.dragging = false;
    // 松手硬吸附到最近分钟
    this.totalMinutes = Math.round(this.totalMinutes);
    this.emitProgress();
    this.maybeHintOnRelease();
  }

  /** 按到时钟以外的目标（失败提示信号） */
  onWrongTarget(): void {
    if (this.succeeded) return;
    this.wrongTargetCount++;
    if (this.wrongTargetCount >= 2) this.hint('look-minute');
  }

  private minutesOff(): number {
    return circularDist(
      Math.round(this.totalMinutes),
      TARGET_MINUTES,
      MINUTES_PER_CYCLE,
    );
  }

  private emitProgress(): void {
    this.bus.emit('clock:progress', { minutesOff: this.minutesOff() });
  }

  private maybeHintOnRelease(): void {
    const off = this.minutesOff();
    if (off > TOLERANCE && off <= 5) this.hint('almost');
    else if (off > 5 && performance.now() - this.startedAt > 20_000) {
      this.hint('look-minute');
    }
  }

  private hint(kind: 'almost' | 'look-minute'): void {
    const now = performance.now();
    if (now - this.lastHintAt < 8000) return;
    this.lastHintAt = now;
    this.bus.emit('clock:hint', { kind });
  }

  private wake(): void {
    if (this.removeUpdater) return;
    this.removeUpdater = this.manager.addUpdater((dt) => this.update(dt));
  }

  private update(dt: number): boolean {
    // 软磁吸：接近整分钟时把目标吸向刻度
    let displayTarget = this.totalMinutes;
    const snapped = Math.round(this.totalMinutes);
    if (Math.abs(this.totalMinutes - snapped) < 0.25) displayTarget = snapped;

    const moving =
      this.dragging || Math.abs(this.displayMinutes - displayTarget) > 1e-3;
    if (moving) {
      this.displayMinutes = damp(this.displayMinutes, displayTarget, 14, dt);
      this.applyHands();

      // 跨刻度齿轮反馈
      const currentMinute = Math.round(this.displayMinutes);
      if (currentMinute !== this.lastDetentMinute) {
        this.lastDetentMinute = currentMinute;
        this.audio.detent();
      }
    }

    // 成功判定：静止驻留（在容差内时保持 updater 活跃以累计驻留时长）
    const nearTarget = !this.succeeded && this.minutesOff() <= TOLERANCE;
    if (nearTarget && !this.dragging) {
      this.dwell += dt;
      if (this.dwell >= DWELL_SECONDS) this.succeed();
    } else if (!this.dragging) {
      this.dwell = 0;
    }

    // 秒针（每秒仅步进一帧渲染）
    if (this.secondRunning) {
      this.secondAccum += dt;
      if (this.secondAccum >= 1) {
        this.secondAccum -= 1;
        this.secondAngle = (this.secondAngle + 6) % 360;
        this.applySecondHand();
        if (!this.quietTicks) this.audio.tick();
        this.manager.invalidate();
      }
    }

    const needsRun = moving || this.secondRunning || nearTarget;
    if (!needsRun) {
      this.removeUpdater = null;
      return false;
    }
    return true;
  }

  private succeed(): void {
    this.succeeded = true;
    this.audio.chime();
    this.startSecondHand();
    this.bus.emit('clock:success');
    this.onSuccess?.();
  }

  startSecondHand(): void {
    this.secondRunning = true;
    this.wake();
  }

  /** 成功后指针快速平滑扫到真实本地时间 */
  sweepToRealTime(duration = 2): Promise<void> {
    const now = new Date();
    const real = hmToMinutes(now.getHours(), now.getMinutes());
    // 选最短方向（连续量上就近）
    const current = ((this.totalMinutes % MINUTES_PER_CYCLE) + MINUTES_PER_CYCLE) % MINUTES_PER_CYCLE;
    let diff = real - current;
    if (diff > MINUTES_PER_CYCLE / 2) diff -= MINUTES_PER_CYCLE;
    if (diff < -MINUTES_PER_CYCLE / 2) diff += MINUTES_PER_CYCLE;
    const from = this.totalMinutes;
    const to = this.totalMinutes + diff;

    this.secondAngle = now.getSeconds() * 6;
    this.applySecondHand();

    return new Promise((resolve) => {
      this.manager.tweens.run({
        duration,
        onUpdate: (t) => {
          this.totalMinutes = from + (to - from) * t;
          this.displayMinutes = this.totalMinutes;
          this.applyHands();
        },
        onComplete: () => resolve(),
      });
    });
  }

  /**
   * HOME 加载海报的确定性交接位。与 ENTRY 共用 6:50，并将秒针
   * 收在 12 点，避免静态海报和 WebGL 首帧出现两组指针。
   */
  setToLoaderHandoff(): void {
    this.removeUpdater?.();
    this.removeUpdater = null;
    this.dragging = false;
    this.secondRunning = false;
    this.secondAccum = 0;
    this.secondAngle = 0;
    this.totalMinutes = LOADER_HANDOFF_MINUTES;
    this.displayMinutes = LOADER_HANDOFF_MINUTES;
    this.lastDetentMinute = Math.round(LOADER_HANDOFF_MINUTES);
    this.succeeded = true;
    this.applyHands();
    this.applySecondHand();
  }

  /** 加载层真正移除后，从确定位平滑进入访问当下的本地时间。 */
  releaseLoaderHandoff(duration = 1.35): Promise<void> {
    const now = new Date();
    const real = hmToMinutes(now.getHours(), now.getMinutes());
    const current =
      ((this.totalMinutes % MINUTES_PER_CYCLE) + MINUTES_PER_CYCLE) % MINUTES_PER_CYCLE;
    let minuteDiff = real - current;
    if (minuteDiff > MINUTES_PER_CYCLE / 2) minuteDiff -= MINUTES_PER_CYCLE;
    if (minuteDiff < -MINUTES_PER_CYCLE / 2) minuteDiff += MINUTES_PER_CYCLE;
    const minuteFrom = this.totalMinutes;

    const secondFrom = this.secondAngle;
    const secondTarget = ((now.getSeconds() + duration) % 60) * 6;
    const secondDiff = shortestDeg(secondFrom, secondTarget);

    return new Promise((resolve) => {
      this.manager.tweens.run({
        duration,
        onUpdate: (t) => {
          this.totalMinutes = minuteFrom + minuteDiff * t;
          this.displayMinutes = this.totalMinutes;
          this.secondAngle = secondFrom + secondDiff * t;
          this.applyHands();
          this.applySecondHand();
        },
        onComplete: () => {
          // 补间歇期内经过的时间，再启动每秒步进。
          this.setToRealTime();
          resolve();
        },
      });
    });
  }

  /** 跳过入口（会话内返回）时直接设为真实时间 */
  setToRealTime(): void {
    const now = new Date();
    this.totalMinutes = hmToMinutes(now.getHours(), now.getMinutes());
    this.displayMinutes = this.totalMinutes;
    this.secondAngle = now.getSeconds() * 6;
    this.succeeded = true;
    this.applyHands();
    this.applySecondHand();
    this.startSecondHand();
  }

  /** 校准接近度 → 刻度发光（0-1） */
  setTickGlow(glow: number): void {
    const ticks = this.manager.scene.getObjectByName('clock_ticks');
    if (!ticks) return;
    ticks.traverse((obj) => {
      if (obj instanceof THREE.Mesh) {
        (obj.material as THREE.MeshStandardMaterial).emissiveIntensity = glow * 0.9;
      }
    });
    this.manager.invalidate();
  }

  private applyHands(): void {
    const minuteHand = this.registry.get(NODES.clockHandMinute);
    const hourHand = this.registry.get(NODES.clockHandHour);
    if (minuteHand) {
      minuteHand.rotation.z = -THREE.MathUtils.degToRad(
        minutesToMinuteAngle(this.displayMinutes),
      );
    }
    if (hourHand) {
      hourHand.rotation.z = -THREE.MathUtils.degToRad(
        minutesToHourAngle(this.displayMinutes),
      );
    }
    this.manager.invalidate();
  }

  private applySecondHand(): void {
    const second = this.registry.get(NODES.clockHandSecond);
    if (second) {
      second.rotation.z = -THREE.MathUtils.degToRad(this.secondAngle);
    }
  }
}
