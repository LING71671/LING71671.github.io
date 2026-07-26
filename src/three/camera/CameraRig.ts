import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import { damp, easeInOutCubic } from '../utils/tween';
import { ORBIT_LIMITS, PARALLAX, type CameraPose } from './poses';

/**
 * 相机系统：三层叠加
 *   基础位姿（补间层）→ 有限环视（yaw/pitch, ±15°/±8°, 阻尼）→ 视差微位移
 * 补间期间环视与视差冻结渐出；聚焦态禁用环视。
 */
export class CameraRig {
  private basePos = new THREE.Vector3();
  private baseTarget = new THREE.Vector3();
  private baseFov = 42;

  private yaw = 0;
  private pitch = 0;
  private yawTarget = 0;
  private pitchTarget = 0;

  private parallax = new THREE.Vector2();
  private parallaxTarget = new THREE.Vector2();
  /** 环视/视差整体权重（补间期间渐出到 0） */
  private inputWeight = 0;
  private inputWeightTarget = 0;

  private tweening = false;
  private removeUpdater: (() => void) | null = null;

  orbitEnabled = false;
  parallaxEnabled = true;

  constructor(private manager: SceneManager) {}

  /** 立即跳到位姿（无动画） */
  snapTo(pose: CameraPose): void {
    this.basePos.copy(pose.position);
    this.baseTarget.copy(pose.target);
    this.baseFov = pose.fov;
    this.yaw = this.yawTarget = 0;
    this.pitch = this.pitchTarget = 0;
    this.compose();
    this.manager.invalidate();
  }

  /** 补间到位姿；resolve 于动画完成 */
  flyTo(pose: CameraPose, duration: number): Promise<void> {
    this.tweening = true;
    this.inputWeightTarget = 0;
    const fromPos = this.basePos.clone();
    const fromTarget = this.baseTarget.clone();
    const fromFov = this.baseFov;
    // 环视残留角并入起始位姿，避免跳变
    this.bakeOrbitIntoBase(fromPos, fromTarget);
    this.yaw = this.yawTarget = 0;
    this.pitch = this.pitchTarget = 0;

    return new Promise((resolve) => {
      this.manager.tweens.run({
        duration,
        ease: easeInOutCubic,
        onUpdate: (t) => {
          this.basePos.lerpVectors(fromPos, pose.position, t);
          this.baseTarget.lerpVectors(fromTarget, pose.target, t);
          this.baseFov = fromFov + (pose.fov - fromFov) * t;
          this.compose();
        },
        onComplete: () => {
          this.tweening = false;
          resolve();
        },
      });
    });
  }

  /** 把当前环视角烘焙进基础位姿（flyTo 起点用） */
  private bakeOrbitIntoBase(outPos: THREE.Vector3, target: THREE.Vector3): void {
    if (this.yaw === 0 && this.pitch === 0) return;
    const offset = outPos.clone().sub(target);
    const rotated = this.applyOrbit(offset, this.yaw, this.pitch);
    outPos.copy(target).add(rotated);
  }

  private applyOrbit(
    offset: THREE.Vector3,
    yaw: number,
    pitch: number,
  ): THREE.Vector3 {
    const spherical = new THREE.Spherical().setFromVector3(offset);
    spherical.theta += yaw;
    spherical.phi = THREE.MathUtils.clamp(
      spherical.phi - pitch,
      0.15,
      Math.PI / 2 - 0.02,
    );
    return new THREE.Vector3().setFromSpherical(spherical);
  }

  /** 空白区拖拽：dx/dy 为归一化位移（-1..1 量级） */
  addOrbitDelta(dx: number, dy: number): void {
    const maxYaw = THREE.MathUtils.degToRad(ORBIT_LIMITS.yawDeg);
    const maxPitch = THREE.MathUtils.degToRad(ORBIT_LIMITS.pitchDeg);
    this.yawTarget = THREE.MathUtils.clamp(this.yawTarget - dx * 1.6, -maxYaw, maxYaw);
    this.pitchTarget = THREE.MathUtils.clamp(
      this.pitchTarget - dy * 1.2,
      -maxPitch,
      maxPitch,
    );
    this.wake();
  }

  /** 鼠标位置驱动视差（NDC -1..1） */
  setParallaxTarget(nx: number, ny: number): void {
    if (!this.parallaxEnabled) return;
    this.parallaxTarget.set(nx, ny);
    this.wake();
  }

  /** 进入交互态（环视/视差生效） */
  enableInput(orbit: boolean): void {
    this.orbitEnabled = orbit;
    this.inputWeightTarget = 1;
    this.wake();
  }

  disableInput(): void {
    this.inputWeightTarget = 0;
    this.wake();
  }

  private wake(): void {
    if (this.removeUpdater) return;
    this.removeUpdater = this.manager.addUpdater((dt) => this.update(dt));
  }

  private update(dt: number): boolean {
    const lambda = 8;
    this.yaw = damp(this.yaw, this.yawTarget * this.inputWeight, lambda, dt);
    this.pitch = damp(this.pitch, this.pitchTarget * this.inputWeight, lambda, dt);
    this.parallax.x = damp(this.parallax.x, this.parallaxTarget.x * this.inputWeight, 5, dt);
    this.parallax.y = damp(this.parallax.y, this.parallaxTarget.y * this.inputWeight, 5, dt);
    this.inputWeight = damp(this.inputWeight, this.inputWeightTarget, 6, dt);

    if (!this.tweening) this.compose();

    const settled =
      Math.abs(this.yaw - this.yawTarget * this.inputWeight) < 1e-4 &&
      Math.abs(this.pitch - this.pitchTarget * this.inputWeight) < 1e-4 &&
      Math.abs(this.parallax.x - this.parallaxTarget.x * this.inputWeight) < 1e-4 &&
      Math.abs(this.parallax.y - this.parallaxTarget.y * this.inputWeight) < 1e-4 &&
      Math.abs(this.inputWeight - this.inputWeightTarget) < 1e-3;

    if (settled) {
      this.removeUpdater = null;
      return false;
    }
    return true;
  }

  /** 由基础位姿 + 环视 + 视差合成最终相机 */
  private compose(): void {
    const camera = this.manager.camera;
    const offset = this.basePos.clone().sub(this.baseTarget);
    const rotated =
      this.yaw !== 0 || this.pitch !== 0
        ? this.applyOrbit(offset, this.yaw, this.pitch)
        : offset;

    camera.position
      .copy(this.baseTarget)
      .add(rotated)
      .add(
        new THREE.Vector3(
          this.parallax.x * PARALLAX.posAmp,
          -this.parallax.y * PARALLAX.posAmp * 0.6,
          0,
        ),
      );

    const lookTarget = this.baseTarget
      .clone()
      .add(
        new THREE.Vector3(
          this.parallax.x * PARALLAX.targetAmp,
          -this.parallax.y * PARALLAX.targetAmp,
          0,
        ),
      );
    camera.lookAt(lookTarget);

    if (Math.abs(camera.fov - this.baseFov) > 1e-3) {
      camera.fov = this.baseFov;
      camera.updateProjectionMatrix();
    }
    this.manager.invalidate();
  }
}
