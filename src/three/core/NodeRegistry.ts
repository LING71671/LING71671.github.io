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

    // 指针 pivot 检查：绕局部 Z 旋转 90° 后，网格端点应绕原点转动。
    // 这里做轻量近似：指针几何在局部 +Y 方向应有延伸，-Y 方向延伸应很小。
    for (const handName of [
      NODES.clockHandHour,
      NODES.clockHandMinute,
      NODES.clockHandSecond,
    ]) {
      const hand = this.nodes.get(handName);
      if (!hand) continue;
      const box = new THREE.Box3().setFromObject(hand);
      const local = box.clone();
      // 转到指针局部系近似判断（假设无旋转基线，导出时指向 12 点即局部 +Y）
      const posY = local.max.y - hand.getWorldPosition(new THREE.Vector3()).y;
      const negY = hand.getWorldPosition(new THREE.Vector3()).y - local.min.y;
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
