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

export const FOCUS_POSES: Partial<Record<HotspotId, FocusPoseDef>> = {
  notebook: {
    anchor: NODES.notebookRoot,
    offset: new THREE.Vector3(0, 0.42, 0.34),
    targetOffset: new THREE.Vector3(0, 0.02, -0.02),
    fov: 38,
  },
  monitor: {
    anchor: NODES.monitorRoot,
    offset: new THREE.Vector3(0, 0.3, 0.62),
    targetOffset: new THREE.Vector3(0, 0.27, 0),
    fov: 36,
  },
  calendar: {
    anchor: NODES.calendarRoot,
    offset: new THREE.Vector3(-0.1, 0.22, 0.4),
    targetOffset: new THREE.Vector3(0, 0.08, 0),
    fov: 34,
  },
  coffee: {
    anchor: NODES.coffeeRoot,
    offset: new THREE.Vector3(0.04, 0.34, 0.3),
    targetOffset: new THREE.Vector3(0, 0.04, 0),
    fov: 36,
  },
  drawer: {
    anchor: NODES.drawerRoot,
    offset: new THREE.Vector3(0, 0.34, 0.62),
    targetOffset: new THREE.Vector3(0, -0.02, 0.1),
    fov: 40,
  },
  sticky: {
    anchor: NODES.stickyRoot,
    offset: new THREE.Vector3(0, 0.4, 0.2),
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
