import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { NODES } from '../config/naming';
import { LAYOUT } from '../config/layout';
import { createScreenTexture } from '../placeholder/PlaceholderDesk';
import {
  mountCalendarFace,
  type CalendarFaceHandle,
} from '../content/CalendarFace';

/**
 * GLTF 单项加载器。调用方把 clock.glb + desk.glb 视作原子资产组，
 * 任一失败都回落完整占位场景，禁止把半套模型提交到可见 scene。
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
    } catch (error) {
      if (import.meta.env.DEV) {
        console.warn(`[desk] GLTF 加载失败：${url}`, error);
      }
      return null;
    }
  }

  /**
   * 导入后处理：阴影标记、运行时控制材质的确定性修正、
   * 补齐可选的分针命中代理。占位与 GLTF 共享同一命名契约。
   */
  static prepare(
    root: THREE.Object3D,
    invalidate: () => void = () => {},
  ): CalendarFaceHandle | null {
    let calendarFace: CalendarFaceHandle | null = null;
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
      } else if (name === NODES.windowView) {
        // 窗外实景：改成不受光照的基础材质。作为自发光材质时
        // 基色光照 + 自发光会叠成过曝，白天窗口糊成一片白。
        const basic = new THREE.MeshBasicMaterial({
          map: material.map ?? material.emissiveMap,
          toneMapped: true,
        });
        obj.material = basic;
        obj.castShadow = false;
        obj.receiveShadow = false;
        material.dispose();
      } else if (name === NODES.calendarFace) {
        // 台历正面：GitHub 提交记录热力格（运行时绘制）
        calendarFace = mountCalendarFace(obj, invalidate);
      } else if (name === 'clock_ticks') {
        material.emissive.setHex(0xc9a45c);
        material.emissiveIntensity = 0;
      } else if (isGlass) {
        // 四顶点玻璃用 PBR 高光时，两个三角面会因透明排序 / 屏幕空间
        // 反射形成明显对角拼缝。窗景已经承担主要视觉，玻璃只保留一层
        // 均匀的冷色薄膜，完全避开逐三角光照。
        const glass = new THREE.MeshBasicMaterial({
          color: 0x9fb4c3,
          transparent: true,
          opacity: 0.035,
          depthWrite: false,
          side: THREE.FrontSide,
          toneMapped: false,
        });
        glass.forceSinglePass = true;
        obj.material = glass;
        material.dispose();
        obj.receiveShadow = false;
      }
    });
    return calendarFace;
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
