import * as THREE from 'three';
import { CLOCK_CENTER, DESK_TOP_Y } from '../config/layout';
import type { HotspotId } from '../../lib/hotspots';
import { NODES, type NodeName } from '../config/naming';

export interface CameraPose {
  position: THREE.Vector3;
  target: THREE.Vector3;
  fov: number;
}

/** 入口时钟特写 */
export const ENTRY_POSE: CameraPose = {
  position: new THREE.Vector3(CLOCK_CENTER.x + 0.06, CLOCK_CENTER.y + 0.05, CLOCK_CENTER.z + 0.42),
  target: new THREE.Vector3(CLOCK_CENTER.x, CLOCK_CENTER.y, CLOCK_CENTER.z),
  fov: 34,
};

/** 主视角（书桌全景） */
export const HOME_POSE: CameraPose = {
  position: new THREE.Vector3(0.12, 1.32, 1.28),
  target: new THREE.Vector3(0, DESK_TOP_Y + 0.08, -0.15),
  fov: 42,
};

/**
 * 热点聚焦位姿：相对锚点节点定义（世界轴偏移），
 * 运行时由锚点实际位置计算 —— 换模后自动适配。
 */
export interface FocusPoseDef {
  anchor: NodeName;
  /** 相机位置 = 锚点世界坐标 + offset */
  offset: THREE.Vector3;
  /** 注视点 = 锚点世界坐标 + targetOffset */
  targetOffset: THREE.Vector3;
  fov: number;
}

/**
 * 注意：运行时锚点是 anchor 节点的「包围盒中心」（HotspotSystem.anchorWorld），
 * 不是物体根部。offset/targetOffset 均相对包围盒中心标定。
 */
export const FOCUS_POSES: Partial<Record<HotspotId, FocusPoseDef>> = {
  notebook: {
    // 就地阅读位姿：近乎正俯视，书页双跨充满画面（微前倾保留一点纸的立体感）。
    // 锚点是 notebook_root 包围盒中心（被文具拉偏），offset 内含 +x/-y 修正对准双页中心。
    anchor: NODES.notebookRoot,
    offset: new THREE.Vector3(0.0745, 0.435, 0.1),
    targetOffset: new THREE.Vector3(0.0745, -0.0148, 0),
    fov: 36,
  },
  monitor: {
    anchor: NODES.monitorRoot,
    offset: new THREE.Vector3(0, 0.05, 0.58),
    targetOffset: new THREE.Vector3(0, 0.03, 0),
    fov: 36,
  },
  calendar: {
    anchor: NODES.calendarRoot,
    offset: new THREE.Vector3(-0.06, 0.1, 0.34),
    targetOffset: new THREE.Vector3(0, 0.01, 0),
    fov: 34,
  },
  coffee: {
    anchor: NODES.coffeeRoot,
    offset: new THREE.Vector3(0.03, 0.26, 0.24),
    targetOffset: new THREE.Vector3(0, -0.02, 0),
    fov: 36,
  },
  drawer: {
    anchor: NODES.drawerRoot,
    offset: new THREE.Vector3(0, 0.52, 0.46),
    targetOffset: new THREE.Vector3(0, -0.04, 0.16),
    fov: 40,
  },
  sticky: {
    anchor: NODES.stickyRoot,
    offset: new THREE.Vector3(0, 0.34, 0.15),
    targetOffset: new THREE.Vector3(0, 0, 0),
    fov: 36,
  },
};

/** 环视与视差限幅 */
export const ORBIT_LIMITS = {
  yawDeg: 15,
  pitchDeg: 8,
} as const;

export const PARALLAX = {
  posAmp: 0.024,
  targetAmp: 0.012,
} as const;

/** 由锚点世界坐标解析聚焦位姿 */
export function resolveFocusPose(
  def: FocusPoseDef,
  anchorWorld: THREE.Vector3,
): CameraPose {
  return {
    position: anchorWorld.clone().add(def.offset),
    target: anchorWorld.clone().add(def.targetOffset),
    fov: def.fov,
  };
}
