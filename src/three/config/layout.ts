/**
 * 场景布局：米制，1 unit = 1m。
 * 世界原点在桌面面板中心正下方的地面；桌面上表面 y = DESK_TOP_Y。
 * 窗户在 -X 侧后墙，观者从 +Z 看向 -Z。
 * 占位场景与相机位姿共用此配置；GLTF 就位后仅作为位姿锚点参考。
 */

export const DESK_TOP_Y = 0.75;

export const LAYOUT = {
  desk: { w: 1.6, d: 0.8, topY: DESK_TOP_Y, thickness: 0.045 },
  wallZ: -0.55,
  floorY: 0,

  window: { x: -0.62, y: 1.45, w: 0.78, h: 0.9, z: -0.54 },

  clock: { x: -0.38, z: 0.08, faceR: 0.075, standH: 0.1 },
  lamp: { x: -0.58, z: -0.18, poleH: 0.42 },
  monitor: { x: 0.12, z: -0.24, screenW: 0.54, screenH: 0.31, standH: 0.12 },
  calendar: { x: 0.58, z: -0.18, w: 0.14, h: 0.16 },
  notebook: { x: 0.02, z: 0.14, w: 0.38, d: 0.27 },
  coffee: { x: 0.34, z: 0.1, r: 0.045, h: 0.095 },
  sticky: { x: 0.56, z: 0.24, size: 0.07 },
  drawer: { x: 0.38, faceW: 0.42, faceH: 0.12, depth: 0.34, travel: 0.24 },
} as const;

/** 时钟表面中心（世界坐标） */
export const CLOCK_CENTER = {
  x: LAYOUT.clock.x,
  y: DESK_TOP_Y + LAYOUT.clock.standH + LAYOUT.clock.faceR,
  z: LAYOUT.clock.z,
} as const;
