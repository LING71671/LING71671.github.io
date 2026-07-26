/**
 * 极简补间工具：无第三方依赖。
 * 由 SceneManager 的 update 循环驱动；活动补间存在时保持渲染。
 */

export type EaseFn = (t: number) => number;

export const easeInOutCubic: EaseFn = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

export const easeOutCubic: EaseFn = (t) => 1 - Math.pow(1 - t, 3);

export const linear: EaseFn = (t) => t;

export interface Tween {
  /** 返回 true 表示已完成 */
  update(dt: number): boolean;
  cancel(): void;
}

interface TweenOpts {
  duration: number;
  ease?: EaseFn;
  onUpdate: (t: number) => void;
  onComplete?: () => void;
}

export class TweenRunner {
  private active = new Set<InternalTween>();

  run(opts: TweenOpts): Tween {
    const tween = new InternalTween(opts, () => this.active.delete(tween));
    this.active.add(tween);
    return tween;
  }

  /** 每帧调用；返回是否仍有活动补间 */
  update(dt: number): boolean {
    for (const tween of [...this.active]) {
      tween.update(dt);
    }
    return this.active.size > 0;
  }

  get hasActive(): boolean {
    return this.active.size > 0;
  }
}

class InternalTween implements Tween {
  private elapsed = 0;
  private done = false;

  constructor(
    private opts: TweenOpts,
    private remove: () => void,
  ) {}

  update(dt: number): boolean {
    if (this.done) return true;
    this.elapsed += dt;
    const raw = Math.min(1, this.elapsed / this.opts.duration);
    const eased = (this.opts.ease ?? easeInOutCubic)(raw);
    this.opts.onUpdate(eased);
    if (raw >= 1) {
      this.done = true;
      this.remove();
      this.opts.onComplete?.();
    }
    return this.done;
  }

  cancel(): void {
    if (this.done) return;
    this.done = true;
    this.remove();
  }
}

/** 指数阻尼（帧率无关），同 THREE.MathUtils.damp */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return target + (current - target) * Math.exp(-lambda * dt);
}
