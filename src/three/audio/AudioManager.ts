/**
 * 音频反馈：全部用 WebAudio 合成（齿轮顿挫 / 秒针滴答 / 成功轻音 / 开关声），
 * v1 无需任何音频素材文件。AudioContext 必须在真实用户手势内创建/恢复
 * （时钟拖动天然提供首次交互）。
 */
export class AudioManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastDetent = 0;
  muted = true;

  /** 在 pointerdown 处理器内调用（iOS 要求真实手势栈） */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      this.ctx = new AudioContext();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
  }

  private blip(
    freq: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
  ): void {
    if (this.muted || !this.ctx || !this.master) return;
    if (this.ctx.state !== 'running') return;
    const t0 = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
    osc.connect(gain).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + duration);
  }

  /** 分钟刻度齿轮顿挫（节流 ≥40ms，随机音高 0.95–1.05） */
  detent(): void {
    const now = performance.now();
    if (now - this.lastDetent < 40) return;
    this.lastDetent = now;
    this.blip(320 * (0.95 + Math.random() * 0.1), 0.03, 0.045, 'triangle');
  }

  /** 秒针滴答（极低音量） */
  tick(): void {
    this.blip(1600, 0.025, 0.018, 'sine');
    this.blip(2400, 0.012, 0.008, 'sine');
  }

  /** 校准成功轻音 */
  chime(): void {
    this.blip(660, 0.45, 0.06, 'sine');
    setTimeout(() => this.blip(880, 0.6, 0.05, 'sine'), 140);
  }

  /** 台灯开关 */
  lampClick(): void {
    this.blip(180, 0.04, 0.06, 'square');
  }

  /** 抽屉滑动（软噪声近似） */
  drawer(): void {
    this.blip(90, 0.16, 0.04, 'triangle');
  }
}
