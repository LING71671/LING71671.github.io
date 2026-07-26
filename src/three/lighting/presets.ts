import * as THREE from 'three';

/** 光照数值集合：所有可插值参数（颜色用 THREE.Color 以便 lerp） */
export interface LightingValues {
  hemiI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  sunI: number;
  sunColor: THREE.Color;
  lampI: number;
  lampColor: THREE.Color;
  bulbE: number;
  screenE: number;
  exposure: number;
  /** 入口时钟补光（停摆的房间里唯一可读的东西） */
  clockFillI: number;
  /** 窗外天空混合（0 夜 – 1 昼） */
  skyBlend: number;
}

export function cloneValues(v: LightingValues): LightingValues {
  return {
    ...v,
    hemiSky: v.hemiSky.clone(),
    hemiGround: v.hemiGround.clone(),
    sunColor: v.sunColor.clone(),
    lampColor: v.lampColor.clone(),
  };
}

export function lerpValues(
  out: LightingValues,
  a: LightingValues,
  b: LightingValues,
  t: number,
): LightingValues {
  out.hemiI = a.hemiI + (b.hemiI - a.hemiI) * t;
  out.sunI = a.sunI + (b.sunI - a.sunI) * t;
  out.lampI = a.lampI + (b.lampI - a.lampI) * t;
  out.bulbE = a.bulbE + (b.bulbE - a.bulbE) * t;
  out.screenE = a.screenE + (b.screenE - a.screenE) * t;
  out.exposure = a.exposure + (b.exposure - a.exposure) * t;
  out.clockFillI = a.clockFillI + (b.clockFillI - a.clockFillI) * t;
  out.skyBlend = a.skyBlend + (b.skyBlend - a.skyBlend) * t;
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
  out.lampColor.lerpColors(a.lampColor, b.lampColor, t);
  return out;
}

/** 白天：自然光（窗），台灯关，色温偏冷自然，影子从左向右 */
export const DAY: LightingValues = {
  hemiI: 0.62,
  hemiSky: new THREE.Color(0xdbe8f0),
  hemiGround: new THREE.Color(0x8a6a42),
  sunI: 1.9,
  sunColor: new THREE.Color(0xfff1d8),
  lampI: 0,
  lampColor: new THREE.Color(0xffb46b),
  bulbE: 0,
  screenE: 0.55,
  exposure: 1.0,
  clockFillI: 0,
  skyBlend: 1,
};

/** 夜晚：台灯暖光（琥珀），影子从右向左柔和，显示器略暗护眼 */
export const NIGHT: LightingValues = {
  hemiI: 0.14,
  hemiSky: new THREE.Color(0x2a2438),
  hemiGround: new THREE.Color(0x1a130c),
  sunI: 0,
  sunColor: new THREE.Color(0xaebbd4),
  lampI: 2.6,
  lampColor: new THREE.Color(0xffb46b),
  bulbE: 1.7,
  screenE: 0.34,
  exposure: 0.85,
  clockFillI: 0,
  skyBlend: 0,
};

/** 入口：昏暗、时间停住的房间，只有时钟被一点余光照亮 */
export const ENTRY: LightingValues = {
  hemiI: 0.07,
  hemiSky: new THREE.Color(0x232028),
  hemiGround: new THREE.Color(0x140f0a),
  sunI: 0,
  sunColor: new THREE.Color(0xaebbd4),
  lampI: 0,
  lampColor: new THREE.Color(0xffb46b),
  bulbE: 0,
  screenE: 0.04,
  exposure: 0.72,
  clockFillI: 1.1,
  skyBlend: 0.08,
};

/** 由本地时间得到昼夜混合值（0 夜 – 1 昼；5-8 时与 17-22 时为过渡带） */
export function dayBlendFromDate(date: Date): number {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 8 && h < 17) return 1;
  if (h >= 22 || h < 5) return 0;
  if (h >= 5 && h < 8) return (h - 5) / 3;
  return 1 - (h - 17) / 5; // 17-22
}
