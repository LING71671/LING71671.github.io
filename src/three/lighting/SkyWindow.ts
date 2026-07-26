import * as THREE from 'three';
import { LAYOUT } from '../config/layout';

/**
 * 窗外天空：CanvasTexture 垂直渐变面片，贴在窗后。
 * 仅昼夜混合值明显变化时重绘（非每帧）。
 */
export class SkyWindow {
  readonly mesh: THREE.Mesh;
  private texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private lastBlend = -1;

  constructor(scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 64;
    this.canvas.height = 128;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.0), material);
    this.mesh.name = 'sky_window';
    this.mesh.position.set(LAYOUT.window.x, LAYOUT.window.y, LAYOUT.wallZ - 0.4);
    scene.add(this.mesh);
    this.setBlend(1);
  }

  /** blend: 0 夜 – 1 昼 */
  setBlend(blend: number): void {
    const q = Math.round(blend * 24) / 24;
    if (q === this.lastBlend) return;
    this.lastBlend = q;

    const ctx = this.canvas.getContext('2d')!;
    const h = this.canvas.height;
    const grad = ctx.createLinearGradient(0, 0, 0, h);

    const lerpHex = (a: number[], b: number[], t: number) =>
      `rgb(${a.map((v, i) => Math.round(v + (b[i]! - v) * t)).join(',')})`;

    const nightTop = [15, 20, 32];
    const nightBottom = [42, 33, 51];
    const dayTop = [156, 196, 224];
    const dayBottom = [244, 232, 207];

    grad.addColorStop(0, lerpHex(nightTop, dayTop, q));
    grad.addColorStop(1, lerpHex(nightBottom, dayBottom, q));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.canvas.width, h);

    if (q > 0.55) {
      // 日间：太阳光晕
      const glow = ctx.createRadialGradient(46, 34, 2, 46, 34, 22);
      glow.addColorStop(0, `rgba(255, 244, 214, ${0.95 * q})`);
      glow.addColorStop(1, 'rgba(255, 244, 214, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, this.canvas.width, h);
    } else if (q < 0.3) {
      // 夜间：月亮与星
      ctx.fillStyle = `rgba(240, 236, 220, ${0.9 * (1 - q * 3)})`;
      ctx.beginPath();
      ctx.arc(44, 28, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.5 * (1 - q * 3)})`;
      for (const [x, y] of [[12, 18], [26, 44], [52, 60], [18, 76], [38, 12]]) {
        ctx.fillRect(x!, y!, 1, 1);
      }
    }

    this.texture.needsUpdate = true;
  }
}
