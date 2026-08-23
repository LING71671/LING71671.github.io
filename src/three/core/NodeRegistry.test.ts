import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { NODES, REQUIRED_NODES } from '../config/naming';
import { NodeRegistry } from './NodeRegistry';

function contractScene(hourOffset = 0.38): THREE.Group {
  const root = new THREE.Group();
  const handNames = new Set<string>([
    NODES.clockHandHour,
    NODES.clockHandMinute,
    NODES.clockHandSecond,
  ]);

  for (const name of REQUIRED_NODES) {
    if (handNames.has(name)) continue;
    const node = new THREE.Group();
    node.name = name;
    root.add(node);
  }

  for (const name of handNames) {
    const pivot = new THREE.Group();
    pivot.name = name;
    // 模拟 ClockController 已把指针旋到当前时间。
    pivot.rotation.z = name === NODES.clockHandHour ? Math.PI : -Math.PI / 3;

    const geometry = new THREE.BoxGeometry(0.05, 1, 0.02);
    geometry.translate(0, name === NODES.clockHandHour ? hourOffset : 0.38, 0);
    pivot.add(new THREE.Mesh(geometry));
    root.add(pivot);
  }

  return root;
}

describe('NodeRegistry.validateContract', () => {
  it('checks clock-hand pivots in local space after runtime rotation', () => {
    const registry = new NodeRegistry();
    registry.resolve(contractScene());

    expect(registry.validateContract()).toEqual([]);
  });

  it('still rejects a hand whose geometry is centered away from its pivot', () => {
    const registry = new NodeRegistry();
    registry.resolve(contractScene(0));

    expect(registry.validateContract()).toContain(
      `${NODES.clockHandHour}: 原点疑似不在旋转轴心（-Y 方向延伸 0.500m 过长）`,
    );
  });
});
