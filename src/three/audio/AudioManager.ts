/**
 * 音频反馈：全部用 WebAudio 合成（齿轮顿挫 / 秒针滴答 / 成功轻音 / 开关声），
 * v1 无需任何音频素材文件。AudioContext 必须在真实用户手势内创建/恢复
 * （时钟拖动天然提供首次交互）。
 */
export class AudioManager {
  /**
   * 当前实例。给拿不到构造注入的模块用（如 BookRenderer 的翻页纸声）。
   * 全站只会构造一个 AudioManager（DeskScene 持有）。
   */
  static current: AudioManager | null = null;

  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastDetent = 0;
  muted = true;

  constructor() {
    AudioManager.current = this;
  }

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

  /**
   * 翻书页：一段极短的噪声，双峰包络（起手轻擦 + 落纸一声），
   * 带通中心频率上扫模拟纸张滑过的「沙」声。静音时不响。
   */
  paper(): void {
    if (this.muted || !this.ctx || !this.master) return;
    if (this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const dur = 0.28;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) {
      const p = i / len;
      const rustle = Math.exp(-p * 11) * 0.75; // 起手掀起
      const k = (p - 0.66) / 0.11;
      const land = Math.exp(-(k * k)) * 0.55; // 落纸
      data[i] = (Math.random() * 2 - 1) * (rustle + land);
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 0.75;
    band.frequency.setValueAtTime(1400, t0);
    band.frequency.exponentialRampToValueAtTime(4600, t0 + dur);
    const gain = ctx.createGain();
    gain.gain.value = 0.055;
    src.connect(band).connect(gain).connect(this.master);
    src.start(t0);
    src.stop(t0 + dur);
  }
}
