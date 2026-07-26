import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NODES } from '../config/naming';
import { LAYOUT } from '../config/layout';
import { createScreenTexture } from '../placeholder/PlaceholderDesk';

/**
 * GLTF 资产加载：clock.glb 先行（入口时钟），desk.glb 随后台并载。
 * 加载失败返回 null，由调用方回落占位场景 —— 模型缺失时站点依然完整可用。
 * 支持 meshopt 压缩产物（scripts/optimize-gltf.mjs 的输出）。
 */
export class AssetLoader {
  private loader = new GLTFLoader();

  constructor() {
    this.loader.setMeshoptDecoder(MeshoptDecoder);
  }

  async load(url: string): Promise<THREE.Group | null> {
    try {
      const gltf = await this.loader.loadAsync(url);
      return gltf.scene;
    } catch {
      return null;
    }
  }

  /**
   * 导入后处理：阴影标记、运行时控制材质的确定性修正、
   * 补齐可选的分针命中代理。占位与 GLTF 共享同一命名契约。
   */
  static prepare(root: THREE.Object3D): void {
    root.traverse((obj) => {
      if (!(obj instanceof THREE.Mesh)) return;
      const name = obj.name;
      const isGlass = name === NODES.windowGlass;
      const isScreen = name === NODES.monitorScreen;
      obj.castShadow = !isGlass && !isScreen;
      obj.receiveShadow = true;

      const material = obj.material as THREE.MeshStandardMaterial;
      if (!material) return;

      // 运行时按 emissiveIntensity 调控的材质：显式设定 emissive 颜色，
      // 不依赖导出器对 emission strength 的编码方式
      if (name === NODES.lampBulb) {
        material.emissive.setHex(0xffb46b);
        material.emissiveIntensity = 0;
      } else if (isScreen) {
        const texture = createScreenTexture();
        // glTF UV 约定 V 原点在上，手工赋图必须关掉 three 默认的 flipY
        texture.flipY = false;
        texture.needsUpdate = true;
        material.map = texture;
        material.emissive.setHex(0xffffff);
        material.emissiveMap = texture;
        material.emissiveIntensity = 0.5;
        material.needsUpdate = true;
      } else if (name === 'clock_ticks') {
        material.emissive.setHex(0xc9a45c);
        material.emissiveIntensity = 0;
      } else if (isGlass) {
        material.transparent = true;
        material.opacity = Math.min(material.opacity, 0.14);
        material.depthWrite = false;
      }
    });
  }

  /**
   * 指针 pivot 加固：把每根指针网格包进一个位于表盘轴心的 Group，
   * 契约名移交给 Group，运行时旋转作用于 Group。
   * 这样即使压缩管线（meshopt 量化）或建模失误改动了网格节点的 TRS，
   * 指针依然绕正确轴心旋转。
   */
  static ensureHandPivots(root: THREE.Object3D): void {
    const face = root.getObjectByName(NODES.clockFace);
    if (!face || !face.parent) return;

    const hands: Array<[string, number]> = [
      [NODES.clockHandHour, 0.008],
      [NODES.clockHandMinute, 0.011],
      [NODES.clockHandSecond, 0.014],
    ];
    for (const [name, zOffset] of hands) {
      const hand = root.getObjectByName(name);
      if (!hand || !(hand instanceof THREE.Mesh)) continue;

      const pivot = new THREE.Group();
      hand.name = `${name}_mesh`;
      pivot.name = name;
      face.parent.add(pivot);
      pivot.position.copy(face.position);
      pivot.quaternion.copy(face.quaternion);
      pivot.translateZ(zOffset);
      pivot.attach(hand);
    }
  }

  /** GLTF 未携带分针命中代理时补齐（覆盖全表盘的透明圆盘） */
  static ensureClockHitProxy(root: THREE.Object3D): void {
    if (root.getObjectByName(NODES.hitClockMinute)) return;
    const face = root.getObjectByName(NODES.clockFace);
    if (!face || !face.parent) return;
    const hit = new THREE.Mesh(
      new THREE.CircleGeometry(LAYOUT.clock.faceR + 0.02, 24),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    hit.name = NODES.hitClockMinute;
    hit.position.copy(face.position);
    hit.quaternion.copy(face.quaternion);
    face.parent.add(hit);
    hit.translateZ(0.02);
  }
}
