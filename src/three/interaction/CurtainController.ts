import * as THREE from 'three';
import type { SceneManager } from '../core/SceneManager';
import type { NodeRegistry } from '../core/NodeRegistry';
import type { AudioManager } from '../audio/AudioManager';
import type { LightingSystem } from '../lighting/LightingSystem';
import { NODES } from '../config/naming';
import { easeOutCubic, type Tween } from '../utils/tween';

export class CurtainController {
  private curtainMesh: THREE.Mesh | null = null;
  private curtainTie: THREE.Object3D | null = null;
  private pottedPlant: THREE.Object3D | null = null;
  private morphIndex = -1;
  private isDrawn = false;
  private progress = 0; // 0 = open (gathered at side), 1 = closed (covering window)
  private tween: Tween | null = null;
  private activePromise: Promise<boolean> | null = null;
  private settleActive: ((drawn: boolean) => void) | null = null;
  private lastShadowAt = 0;

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
      const named = meshNode.morphTargetDictionary?.closed;
      if (typeof named === 'number') {
        this.morphIndex = named;
      } else if (meshNode.morphTargetInfluences?.length === 1) {
        // 兼容未导出 shape-key 名称的旧资产；新资产必须优先走 closed 字典。
        this.morphIndex = 0;
      }
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
    if (!immediate && this.isDrawn === drawn && this.tween && this.activePromise) {
      return this.activePromise;
    }
    if (this.isDrawn === drawn && !this.tween) {
      return Promise.resolve(this.isDrawn);
    }
    this.isDrawn = drawn;
    // 快速反向或 immediate 设置时先终止旧补间，旧 Promise 以最新目标收口。
    this.tween?.cancel();
    this.tween = null;
    this.settleActive?.(drawn);
    this.settleActive = null;
    this.activePromise = null;

    const from = this.progress;
    const to = drawn ? 1 : 0;

    if (immediate) {
      this.progress = to;
      this.applyProgress(to);
      return Promise.resolve(this.isDrawn);
    }

    this.audio.curtain(drawn);

    const promise = new Promise<boolean>((resolve) => {
      this.settleActive = resolve;
      const tween = this.manager.tweens.run({
        duration: 0.55,
        ease: easeOutCubic,
        onUpdate: (t) => {
          this.progress = from + (to - from) * t;
          this.applyProgress(this.progress);
        },
        onComplete: () => {
          if (this.tween !== tween) return;
          this.progress = to;
          this.applyProgress(to);
          this.tween = null;
          this.activePromise = null;
          this.settleActive = null;
          resolve(this.isDrawn);
        },
      });
      this.tween = tween;
    });
    this.activePromise = promise;
    return promise;
  }

  private applyProgress(k: number): void {
    if (
      this.curtainMesh?.morphTargetInfluences &&
      this.morphIndex >= 0 &&
      this.morphIndex < this.curtainMesh.morphTargetInfluences.length
    ) {
      this.curtainMesh.morphTargetInfluences[this.morphIndex] = k;
    }

    if (this.curtainTie) {
      // 黄铜抱钩在拉开收拢在左侧时显现，拉上时隐藏
      this.curtainTie.visible = k < 0.15;
    }

    if (this.pottedPlant) {
      // 帘沿走到盆栽位置后再隐藏，避免一开始拉动就凭空消失。
      this.pottedPlant.visible = k < 0.3;
    }

    this.lighting.setCurtainDrawn(k);
    // shadowMap 为按需更新；形变期间节流重建，端点强制收口。
    const now = performance.now();
    if (k === 0 || k === 1 || now - this.lastShadowAt >= 100) {
      this.lastShadowAt = now;
      this.manager.updateShadows();
    } else {
      this.manager.invalidate();
    }
  }
}
