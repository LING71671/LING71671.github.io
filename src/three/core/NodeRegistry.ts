import * as THREE from 'three';
import { NODES, REQUIRED_NODES, type NodeName } from '../config/naming';

/**
 * 按命名契约解析场景节点。占位场景与 GLTF 一视同仁：
 * 业务代码只从这里拿节点，换模零代码改动。
 * validateContract() 同时是 Blender 导出物的验收工具。
 */
export class NodeRegistry {
  private nodes = new Map<string, THREE.Object3D>();

  resolve(root: THREE.Object3D): void {
    this.nodes.clear();
    root.traverse((obj) => {
      if (obj.name && !this.nodes.has(obj.name)) {
        this.nodes.set(obj.name, obj);
      }
    });
  }

  get(name: NodeName): THREE.Object3D | null {
    return this.nodes.get(name) ?? null;
  }

  /** 必需节点，缺失直接抛错（契约破裂应尽早暴露） */
  require(name: NodeName): THREE.Object3D {
    const node = this.nodes.get(name);
    if (!node) {
      throw new Error(`[NodeRegistry] 场景缺少契约节点 "${name}"，请检查模型命名`);
    }
    return node;
  }

  /**
   * 契约校验：返回问题列表（空数组 = 通过）。
   * Blender 导出后跑一遍即可验收命名与轴向。
   */
  validateContract(): string[] {
    const problems: string[] = [];
    for (const name of REQUIRED_NODES) {
      if (!this.nodes.has(name)) {
        problems.push(`缺少必需节点: ${name}`);
      }
    }

    // 指针 pivot 检查：几何在指针契约节点的局部 +Y 方向应有延伸，
    // -Y 方向只允许短尾部。必须在局部坐标里检查；进入场景后 ClockController
    // 会立即把指针旋到当前时间，用世界 AABB 判断会随时间产生误报。
    for (const handName of [
      NODES.clockHandHour,
      NODES.clockHandMinute,
      NODES.clockHandSecond,
    ]) {
      const hand = this.nodes.get(handName);
      if (!hand) continue;
      hand.updateWorldMatrix(true, true);
      const handWorldInverse = hand.matrixWorld.clone().invert();
      const local = new THREE.Box3().makeEmpty();
      const relativeMatrix = new THREE.Matrix4();

      hand.traverse((obj) => {
        if (!(obj instanceof THREE.Mesh)) return;
        const geometry = obj.geometry;
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        if (!geometry.boundingBox) return;

        relativeMatrix.multiplyMatrices(handWorldInverse, obj.matrixWorld);
        local.union(geometry.boundingBox.clone().applyMatrix4(relativeMatrix));
      });

      if (local.isEmpty()) {
        problems.push(`${handName}: 指针节点下没有可校验的网格`);
        continue;
      }

      const posY = local.max.y;
      const negY = -local.min.y;
      if (posY <= 0) {
        problems.push(`${handName}: 指针应从原点向局部 +Y（12 点方向）延伸`);
      } else if (negY > posY * 0.5) {
        problems.push(
          `${handName}: 原点疑似不在旋转轴心（-Y 方向延伸 ${negY.toFixed(3)}m 过长）`,
        );
      }
    }

    const drawer = this.nodes.get(NODES.drawerSlide);
    if (drawer && drawer.scale.x * drawer.scale.y * drawer.scale.z < 0) {
      problems.push(`${NODES.drawerSlide}: 存在负缩放，请在 Blender 中 Apply Scale`);
    }

    return problems;
  }
}
