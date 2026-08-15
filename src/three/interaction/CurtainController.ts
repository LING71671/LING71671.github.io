import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import type { AudioManager } from '../audio/AudioManager';
import type { LightingSystem } from '../lighting/LightingSystem';
import { NODES } from '../config/naming';
import { easeOutCubic } from '../utils/tween';

export class CurtainController {
  private curtainMesh: THREE.Mesh | null = null;
  private curtainTie: THREE.Object3D | null = null;
  private pottedPlant: THREE.Object3D | null = null;
  private isDrawn = false;
  private progress = 0; // 0 = open (gathered at side), 1 = closed (covering window)
  private animating = false;

  constructor(
    private manager: SceneManager,
    private registry: NodeRegistry,
    private audio: AudioManager,
    private lighting: LightingSystem,
  ) {}

  /** GLTF 资产到位后挂载绑定 */
  mount(): void {
    const meshNode = this.registry.get(NODES.curtain);
    if (meshNode instanceof THREE.Mesh) {
      this.curtainMesh = meshNode;
    }
    const tieNode = this.registry.get(NODES.curtainTie);
    if (tieNode) {
      this.curtainTie = tieNode;
    }
    const plantNode = this.registry.get(NODES.pottedPlant);
    if (plantNode) {
      this.pottedPlant = plantNode;
    }
    this.applyProgress(this.progress);
  }

  get drawn(): boolean {
    return this.isDrawn;
  }

  /** 切换窗帘开合状态 */
  async toggle(): Promise<boolean> {
    return this.setDrawn(!this.isDrawn);
  }

  /** 设置窗帘状态 */
  setDrawn(drawn: boolean, immediate = false): Promise<boolean> {
    if (this.isDrawn === drawn && !this.animating) {
      return Promise.resolve(this.isDrawn);
    }
    this.isDrawn = drawn;
    const from = this.progress;
    const to = drawn ? 1 : 0;

    if (immediate) {
      this.progress = to;
      this.applyProgress(to);
      return Promise.resolve(this.isDrawn);
    }

    this.audio.curtain(drawn);
    this.animating = true;

    return new Promise((resolve) => {
      this.manager.tweens.run({
        duration: 0.55,
        ease: easeOutCubic,
        onUpdate: (t) => {
          this.progress = from + (to - from) * t;
          this.applyProgress(this.progress);
        },
        onComplete: () => {
          this.progress = to;
          this.applyProgress(to);
          this.animating = false;
          resolve(this.isDrawn);
        },
      });
    });
  }

  private applyProgress(k: number): void {
    if (this.curtainMesh && this.curtainMesh.morphTargetInfluences) {
      this.curtainMesh.morphTargetInfluences[0] = k;
    }

    if (this.curtainTie) {
      // 黄铜抱钩在拉开收拢在左侧时显现，拉上时隐藏
      this.curtainTie.visible = k < 0.15;
    }

    if (this.pottedPlant) {
      // 窗帘拉上时，窗台盆栽隐入窗帘背后，防止叶片穿模
      this.pottedPlant.visible = k < 0.08;
    }

    this.lighting.setCurtainDrawn(k);
    this.manager.invalidate();
  }
}
