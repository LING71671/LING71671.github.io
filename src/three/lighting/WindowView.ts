import * as THREE from 'three';
import { withBase } from '../../lib/url';

type WindowMoment = 'night' | 'dawn' | 'noon' | 'sunset';

interface WindowAnchor {
  minute: number;
  moment: WindowMoment;
}

const WINDOW_ANCHORS: WindowAnchor[] = [
  { minute: 0, moment: 'night' },
  { minute: 300, moment: 'night' },
  { minute: 440, moment: 'dawn' },
  { minute: 720, moment: 'noon' },
  { minute: 1100, moment: 'sunset' },
  { minute: 1320, moment: 'night' },
  { minute: 1440, moment: 'night' },
];

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/**
 * 同一山景的四次调色在离屏 canvas 中连续混合。这样只保留一个窗景 mesh / draw call，
 * 且所有时段像素严格对齐，不会在黎明、正午、黄昏之间“换了一座山”。
 */
export class WindowView {
  private canvas = document.createElement('canvas');
  private texture: THREE.CanvasTexture;
  private images = new Map<WindowMoment, HTMLImageElement>();
  private originalMap: THREE.Texture | null;
  private lastKey = '';
  private loaded = false;

  get ready(): boolean {
    return this.loaded;
  }

  constructor(
    private mesh: THREE.Mesh,
    private invalidate: () => void,
    maxAnisotropy: number,
  ) {
    this.canvas.width = 768;
    this.canvas.height = 512;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = Math.min(8, maxAnisotropy);
    this.originalMap = (mesh.material as THREE.MeshBasicMaterial).map ?? null;
  }

  async load(minute: number): Promise<void> {
    const moments: WindowMoment[] = ['dawn', 'noon', 'sunset', 'night'];
    const loaded = await Promise.all(
      moments.map(async (moment) => {
        const image = new Image();
        image.decoding = 'async';
        image.src = withBase(`/images/window/${moment}.webp`);
        await image.decode();
        return [moment, image] as const;
      }),
    );
    for (const [moment, image] of loaded) this.images.set(moment, image);
    this.loaded = true;
    this.setMinute(minute, true);
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    material.map = this.texture;
    material.color.set(0xffffff);
    material.needsUpdate = true;
    this.originalMap?.dispose();
    this.originalMap = null;
    this.invalidate();
  }

  setMinute(minute: number, force = false): void {
    if (!this.loaded) return;
    const normalized = ((minute % 1440) + 1440) % 1440;
    let from = WINDOW_ANCHORS[0]!;
    let to = WINDOW_ANCHORS[1]!;
    for (let i = 0; i < WINDOW_ANCHORS.length - 1; i += 1) {
      const a = WINDOW_ANCHORS[i]!;
      const b = WINDOW_ANCHORS[i + 1]!;
      if (normalized >= a.minute && normalized < b.minute) {
        from = a;
        to = b;
        break;
      }
    }
    const linear = (normalized - from.minute) / Math.max(1, to.minute - from.minute);
    const mix = smoothstep(THREE.MathUtils.clamp(linear, 0, 1));
    const quantized = Math.round(mix * 48) / 48;
    const key = `${from.moment}:${to.moment}:${quantized}`;
    if (!force && key === this.lastKey) return;
    this.lastKey = key;

    const a = this.images.get(from.moment);
    const b = this.images.get(to.moment);
    const ctx = this.canvas.getContext('2d');
    if (!a || !b || !ctx) return;
    ctx.globalAlpha = 1;
    ctx.drawImage(a, 0, 0, this.canvas.width, this.canvas.height);
    if (quantized > 0 && from.moment !== to.moment) {
      ctx.globalAlpha = quantized;
      ctx.drawImage(b, 0, 0, this.canvas.width, this.canvas.height);
      ctx.globalAlpha = 1;
    }
    this.texture.needsUpdate = true;
    this.invalidate();
  }

  dispose(): void {
    this.texture.dispose();
    this.images.clear();
  }
}
