import * as THREE from 'three';
import { LAYOUT } from '../config/layout';
import type { LightingValues } from './presets';

/**
 * 窗外天空兜底。真实山景贴图尚未到位或加载失败时，仍按同一四时时间线绘制，
 * 不会闪回统一的蓝色渐变。只有量化后的色板变化时才重绘。
 */
export class SkyWindow {
  readonly mesh: THREE.Mesh;
  private texture: THREE.CanvasTexture;
  private canvas: HTMLCanvasElement;
  private lastKey = '';

  constructor(scene: THREE.Scene) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = 192;
    this.canvas.height = 256;
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;

    const material = new THREE.MeshBasicMaterial({
      map: this.texture,
      toneMapped: false,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2), material);
    this.mesh.name = 'sky_window';
    this.mesh.position.set(LAYOUT.window.x, LAYOUT.window.y, LAYOUT.wallZ - 0.4);
    scene.add(this.mesh);
  }

  setLighting(values: LightingValues): void {
    const key = [
      values.skyTop.getHexString(),
      values.skyMid.getHexString(),
      values.skyBottom.getHexString(),
      values.skyGlow.getHexString(),
      Math.round(values.skyGlowI * 24),
      Math.round(values.stars * 12),
      Math.round(values.sunPosition.x * 4),
      Math.round(values.sunPosition.y * 4),
    ].join(':');
    if (key === this.lastKey) return;
    this.lastKey = key;

    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const { width, height } = this.canvas;
    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, values.skyTop.getStyle());
    gradient.addColorStop(0.56, values.skyMid.getStyle());
    gradient.addColorStop(1, values.skyBottom.getStyle());
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    if (values.skyGlowI > 0.01) {
      const gx = THREE.MathUtils.mapLinear(values.sunPosition.x, -4, 4, width * 0.12, width * 0.88);
      const gy = THREE.MathUtils.mapLinear(
        THREE.MathUtils.clamp(values.sunPosition.y, 0, 4.5),
        0,
        4.5,
        height * 0.78,
        height * 0.2,
      );
      const radius = width * (0.16 + values.skyGlowI * 0.22);
      const glow = ctx.createRadialGradient(gx, gy, 1, gx, gy, radius);
      const glowColor = values.skyGlow.clone();
      const rgb = glowColor
        .toArray()
        .map((v) => Math.round(THREE.MathUtils.clamp(v, 0, 1) * 255));
      glow.addColorStop(0, `rgba(${rgb.join(',')},${Math.min(0.92, values.skyGlowI)})`);
      glow.addColorStop(0.35, `rgba(${rgb.join(',')},${values.skyGlowI * 0.3})`);
      glow.addColorStop(1, `rgba(${rgb.join(',')},0)`);
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, width, height);
    }

    if (values.stars > 0.02) {
      const stars: Array<[number, number, number]> = [
        [0.08, 0.1, 0.8], [0.19, 0.24, 0.45], [0.29, 0.08, 0.6],
        [0.41, 0.19, 0.35], [0.56, 0.11, 0.7], [0.7, 0.27, 0.42],
        [0.83, 0.08, 0.52], [0.91, 0.31, 0.3], [0.34, 0.37, 0.4],
      ];
      for (const [x, y, alpha] of stars) {
        ctx.fillStyle = `rgba(235,240,246,${values.stars * alpha})`;
        ctx.fillRect(Math.round(x * width), Math.round(y * height), 1, 1);
      }
    }

    this.texture.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
    this.mesh.removeFromParent();
  }
}
