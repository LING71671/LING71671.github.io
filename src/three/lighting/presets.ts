import * as THREE from 'three';
import { SCENE_TIME_MINUTES } from '../../lib/scene-time-anchors';

export type TimePhase = 'night' | 'dawn' | 'day' | 'dusk';

/**
 * 一帧完整的摄影光照状态。所有字段都可插值，避免现实时间跨阶段时出现硬切。
 * 颜色与太阳位姿也属于时间，而不是附加在 DAY/NIGHT 两端的装饰参数。
 */
export interface LightingValues {
  hemiI: number;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  /** 从窗外射入、负责长阴影的太阳直射光 */
  sunI: number;
  sunColor: THREE.Color;
  sunPosition: THREE.Vector3;
  sunTarget: THREE.Vector3;
  /** 窗口面积光，只负责柔和的天空填充，不投影 */
  windowI: number;
  windowColor: THREE.Color;
  /** 摄影用窗格 cookie 光，只塑造墙面与桌面的明暗结构，不承担环境填充。 */
  patternI: number;
  patternColor: THREE.Color;
  lampI: number;
  lampColor: THREE.Color;
  bulbE: number;
  screenE: number;
  exposure: number;
  clockFillI: number;
  envI: number;
  sceneColor: THREE.Color;
  fogColor: THREE.Color;
  fogDensity: number;
  skyTop: THREE.Color;
  skyMid: THREE.Color;
  skyBottom: THREE.Color;
  skyGlow: THREE.Color;
  skyGlowI: number;
  stars: number;
  /** 窗外实景贴图的乘色；图片本身保持同一机位 */
  windowTint: THREE.Color;
}

export interface TimeLightingSample {
  minute: number;
  phase: TimePhase;
  fromPhase: TimePhase;
  toPhase: TimePhase;
  mix: number;
  values: LightingValues;
}

interface LightingAnchor {
  minute: number;
  phase: TimePhase;
  values: LightingValues;
}

const color = (hex: number) => new THREE.Color(hex);
const vector = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

export function cloneValues(v: LightingValues): LightingValues {
  return {
    ...v,
    hemiSky: v.hemiSky.clone(),
    hemiGround: v.hemiGround.clone(),
    sunColor: v.sunColor.clone(),
    sunPosition: v.sunPosition.clone(),
    sunTarget: v.sunTarget.clone(),
    windowColor: v.windowColor.clone(),
    patternColor: v.patternColor.clone(),
    lampColor: v.lampColor.clone(),
    sceneColor: v.sceneColor.clone(),
    fogColor: v.fogColor.clone(),
    skyTop: v.skyTop.clone(),
    skyMid: v.skyMid.clone(),
    skyBottom: v.skyBottom.clone(),
    skyGlow: v.skyGlow.clone(),
    windowTint: v.windowTint.clone(),
  };
}

export function lerpValues(
  out: LightingValues,
  a: LightingValues,
  b: LightingValues,
  t: number,
): LightingValues {
  out.hemiI = THREE.MathUtils.lerp(a.hemiI, b.hemiI, t);
  out.sunI = THREE.MathUtils.lerp(a.sunI, b.sunI, t);
  out.windowI = THREE.MathUtils.lerp(a.windowI, b.windowI, t);
  out.patternI = THREE.MathUtils.lerp(a.patternI, b.patternI, t);
  out.lampI = THREE.MathUtils.lerp(a.lampI, b.lampI, t);
  out.bulbE = THREE.MathUtils.lerp(a.bulbE, b.bulbE, t);
  out.screenE = THREE.MathUtils.lerp(a.screenE, b.screenE, t);
  out.exposure = THREE.MathUtils.lerp(a.exposure, b.exposure, t);
  out.clockFillI = THREE.MathUtils.lerp(a.clockFillI, b.clockFillI, t);
  out.envI = THREE.MathUtils.lerp(a.envI, b.envI, t);
  out.fogDensity = THREE.MathUtils.lerp(a.fogDensity, b.fogDensity, t);
  out.skyGlowI = THREE.MathUtils.lerp(a.skyGlowI, b.skyGlowI, t);
  out.stars = THREE.MathUtils.lerp(a.stars, b.stars, t);
  out.hemiSky.lerpColors(a.hemiSky, b.hemiSky, t);
  out.hemiGround.lerpColors(a.hemiGround, b.hemiGround, t);
  out.sunColor.lerpColors(a.sunColor, b.sunColor, t);
  out.sunPosition.lerpVectors(a.sunPosition, b.sunPosition, t);
  out.sunTarget.lerpVectors(a.sunTarget, b.sunTarget, t);
  out.windowColor.lerpColors(a.windowColor, b.windowColor, t);
  out.patternColor.lerpColors(a.patternColor, b.patternColor, t);
  out.lampColor.lerpColors(a.lampColor, b.lampColor, t);
  out.sceneColor.lerpColors(a.sceneColor, b.sceneColor, t);
  out.fogColor.lerpColors(a.fogColor, b.fogColor, t);
  out.skyTop.lerpColors(a.skyTop, b.skyTop, t);
  out.skyMid.lerpColors(a.skyMid, b.skyMid, t);
  out.skyBottom.lerpColors(a.skyBottom, b.skyBottom, t);
  out.skyGlow.lerpColors(a.skyGlow, b.skyGlow, t);
  out.windowTint.lerpColors(a.windowTint, b.windowTint, t);
  return out;
}

function preset(overrides: Partial<LightingValues>): LightingValues {
  return {
    hemiI: 0.08,
    hemiSky: color(0xd8e2e8),
    hemiGround: color(0x6f5740),
    sunI: 1.8,
    sunColor: color(0xffeed5),
    sunPosition: vector(-1.8, 2.8, -3.1),
    sunTarget: vector(0.05, 0.58, 0.22),
    windowI: 0.3,
    windowColor: color(0xd9e8ee),
    patternI: 0,
    patternColor: color(0xffd6a3),
    lampI: 0,
    lampColor: color(0xffb46b),
    bulbE: 0,
    screenE: 0.42,
    exposure: 0.76,
    clockFillI: 0,
    envI: 0.09,
    sceneColor: color(0x25221f),
    fogColor: color(0x6c6258),
    fogDensity: 0.018,
    skyTop: color(0x84b5d0),
    skyMid: color(0xc7d8de),
    skyBottom: color(0xf0ddbe),
    skyGlow: color(0xffe7b6),
    skyGlowI: 0.3,
    stars: 0,
    windowTint: color(0xffffff),
    ...overrides,
  };
}

/** 深夜：保留蓝黑环境层次，钨丝灯只照亮桌面的一小片。 */
export const NIGHT = preset({
  hemiI: 0.07,
  hemiSky: color(0x183a64),
  hemiGround: color(0x08090d),
  sunI: 0,
  sunColor: color(0x7990b4),
  sunPosition: vector(0, 0.5, -3.5),
  windowI: 0.38,
  windowColor: color(0x285a93),
  patternI: 0,
  lampI: 4.4,
  lampColor: color(0xff9e53),
  bulbE: 1.8,
  screenE: 0.2,
  exposure: 0.73,
  envI: 0.07,
  sceneColor: color(0x02050b),
  fogColor: color(0x081326),
  fogDensity: 0.024,
  skyTop: color(0x030713),
  skyMid: color(0x0a1729),
  skyBottom: color(0x17263a),
  skyGlow: color(0x55739a),
  skyGlowI: 0.08,
  stars: 0.9,
  windowTint: color(0x3d587d),
});

const PRE_DAWN = preset({
  hemiI: 0.055,
  hemiSky: color(0x294a72),
  hemiGround: color(0x0b0d14),
  sunI: 0,
  sunPosition: vector(-3.5, 0.35, -3.8),
  windowI: 0.32,
  windowColor: color(0x426d9b),
  patternI: 0.18,
  patternColor: color(0x789bc7),
  lampI: 2.8,
  bulbE: 1.25,
  screenE: 0.22,
  exposure: 0.7,
  envI: 0.055,
  sceneColor: color(0x050b16),
  fogColor: color(0x29384b),
  fogDensity: 0.022,
  skyTop: color(0x14243e),
  skyMid: color(0x41566f),
  skyBottom: color(0xb07c62),
  skyGlow: color(0xf2a565),
  skyGlowI: 0.25,
  stars: 0.35,
  windowTint: color(0x7890a9),
});

const DAWN = preset({
  hemiI: 0.06,
  hemiSky: color(0x315982),
  hemiGround: color(0x11121a),
  sunI: 0.58,
  sunColor: color(0xffad69),
  sunPosition: vector(-3.2, 0.72, -3.9),
  windowI: 0.34,
  windowColor: color(0x527ba5),
  patternI: 0.55,
  patternColor: color(0x8aa5c7),
  lampI: 0.75,
  bulbE: 0.4,
  screenE: 0.25,
  exposure: 0.71,
  envI: 0.065,
  sceneColor: color(0x07101e),
  fogColor: color(0x8c776d),
  fogDensity: 0.021,
  skyTop: color(0x416b91),
  skyMid: color(0xa1858a),
  skyBottom: color(0xf4a46a),
  skyGlow: color(0xffbf73),
  skyGlowI: 0.72,
  stars: 0.03,
  windowTint: color(0xd5b3a4),
});

/** 07:20 的主视觉锚点：冷蓝房间中只留一线低角度暖光。 */
const DAWN_0720 = preset({
  hemiI: 0.08,
  hemiSky: color(0x355d87),
  hemiGround: color(0x15151b),
  sunI: 0.82,
  sunColor: color(0xffa463),
  sunPosition: vector(-3.35, 0.82, -3.9),
  windowI: 0.38,
  windowColor: color(0x5a80a8),
  patternI: 2.05,
  patternColor: color(0x91abc9),
  lampI: 0.12,
  bulbE: 0.06,
  screenE: 0.27,
  exposure: 0.75,
  envI: 0.09,
  sceneColor: color(0x081321),
  fogColor: color(0x1f354f),
  skyTop: color(0x31577e),
  skyMid: color(0x807887),
  skyBottom: color(0xf2a26b),
  skyGlow: color(0xffb36d),
  skyGlowI: 0.68,
  windowTint: color(0x9da9b7),
});

/** 上午：冷暖平衡，窗框投下清晰但不生硬的长影。 */
export const DAY = preset({
  hemiI: 0.085,
  sunI: 2.3,
  sunColor: color(0xffdfb8),
  sunPosition: vector(-2.4, 1.85, -3.5),
  windowI: 0.34,
  windowColor: color(0xd8e7eb),
  patternI: 4.4,
  patternColor: color(0xffd2a0),
  exposure: 0.78,
  envI: 0.1,
  sceneColor: color(0x373431),
  fogColor: color(0x8b8177),
  skyTop: color(0x78acd0),
  skyMid: color(0xc5d8df),
  skyBottom: color(0xf0dfc4),
  skyGlow: color(0xffe2a9),
  skyGlowI: 0.42,
});

const NOON = preset({
  hemiI: 0.075,
  hemiSky: color(0xe2e7e7),
  hemiGround: color(0x756657),
  sunI: 2.65,
  sunColor: color(0xfff2dc),
  sunPosition: vector(-0.35, 4.4, -3.0),
  windowI: 0.28,
  windowColor: color(0xe3edf0),
  patternI: 6.4,
  patternColor: color(0xffd2a0),
  exposure: 0.78,
  envI: 0.095,
  sceneColor: color(0x403b36),
  fogColor: color(0xaaa097),
  fogDensity: 0.016,
  skyTop: color(0x73add3),
  skyMid: color(0xc7e0e8),
  skyBottom: color(0xf3e9d5),
  skyGlow: color(0xfff0cc),
  skyGlowI: 0.34,
});

const LATE_AFTERNOON = preset({
  hemiI: 0.07,
  hemiSky: color(0xc6c7bd),
  hemiGround: color(0x6b4932),
  sunI: 2.1,
  sunColor: color(0xffc17c),
  sunPosition: vector(2.45, 1.42, -3.7),
  windowI: 0.3,
  windowColor: color(0xd9c8b3),
  patternI: 4.5,
  patternColor: color(0xffbd7b),
  exposure: 0.75,
  envI: 0.09,
  sceneColor: color(0x3c2d24),
  fogColor: color(0x9b7761),
  fogDensity: 0.02,
  skyTop: color(0x6f879d),
  skyMid: color(0xc58e76),
  skyBottom: color(0xf2a964),
  skyGlow: color(0xffb45f),
  skyGlowI: 0.68,
  windowTint: color(0xffd2ac),
});

const SUNSET = preset({
  hemiI: 0.055,
  hemiSky: color(0x654c50),
  hemiGround: color(0x1b0e09),
  sunI: 1.7,
  sunColor: color(0xff8d4c),
  sunPosition: vector(3.35, 0.58, -4.0),
  windowI: 0.22,
  windowColor: color(0xb86f4c),
  patternI: 5.1,
  patternColor: color(0xff8d4c),
  lampI: 0.16,
  bulbE: 0.08,
  screenE: 0.27,
  exposure: 0.71,
  envI: 0.07,
  sceneColor: color(0x100907),
  fogColor: color(0x764d3d),
  fogDensity: 0.023,
  skyTop: color(0x3e4969),
  skyMid: color(0xb45c4e),
  skyBottom: color(0xf07b42),
  skyGlow: color(0xff9a4f),
  skyGlowI: 0.9,
  windowTint: color(0xe59a73),
});

const BLUE_HOUR = preset({
  hemiI: 0.06,
  hemiSky: color(0x284a75),
  hemiGround: color(0x0a0a10),
  sunI: 0,
  sunPosition: vector(3.7, 0.2, -4.1),
  windowI: 0.3,
  windowColor: color(0x426b9c),
  patternI: 0.22,
  patternColor: color(0x6d88b2),
  lampI: 3.4,
  bulbE: 1.35,
  screenE: 0.22,
  exposure: 0.7,
  envI: 0.06,
  sceneColor: color(0x040914),
  fogColor: color(0x1b2940),
  fogDensity: 0.024,
  skyTop: color(0x101a31),
  skyMid: color(0x263a59),
  skyBottom: color(0x74515b),
  skyGlow: color(0xb46959),
  skyGlowI: 0.24,
  stars: 0.18,
  windowTint: color(0x647895),
});

const ANCHORS: LightingAnchor[] = [
  { minute: SCENE_TIME_MINUTES.midnight, phase: 'night', values: NIGHT },
  { minute: SCENE_TIME_MINUTES.predawn, phase: 'dawn', values: PRE_DAWN },
  { minute: SCENE_TIME_MINUTES.dawn, phase: 'dawn', values: DAWN },
  { minute: SCENE_TIME_MINUTES.sunrise, phase: 'dawn', values: DAWN_0720 },
  { minute: SCENE_TIME_MINUTES.morning, phase: 'day', values: DAY },
  { minute: SCENE_TIME_MINUTES.noon, phase: 'day', values: NOON },
  { minute: SCENE_TIME_MINUTES.afternoon, phase: 'dusk', values: LATE_AFTERNOON },
  { minute: SCENE_TIME_MINUTES.sunset, phase: 'dusk', values: SUNSET },
  { minute: SCENE_TIME_MINUTES.bluehour, phase: 'dusk', values: BLUE_HOUR },
  { minute: SCENE_TIME_MINUTES.night, phase: 'night', values: NIGHT },
  { minute: SCENE_TIME_MINUTES.end, phase: 'night', values: NIGHT },
];

export function minuteOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}

export function phaseFromMinute(minute: number): TimePhase {
  const m = ((minute % 1440) + 1440) % 1440;
  if (m >= SCENE_TIME_MINUTES.predawn && m < SCENE_TIME_MINUTES.morning) return 'dawn';
  if (m >= SCENE_TIME_MINUTES.morning && m < SCENE_TIME_MINUTES.afternoon) return 'day';
  if (m >= SCENE_TIME_MINUTES.afternoon && m < SCENE_TIME_MINUTES.night) return 'dusk';
  return 'night';
}

const smoothstep = (t: number) => t * t * (3 - 2 * t);

/** 由设备本地现实时间采样连续光照；分钟和秒都参与，任何阶段都不会硬切。 */
export function lightingFromDate(date: Date): TimeLightingSample {
  const minute = minuteOfDay(date);
  let from = ANCHORS[0]!;
  let to = ANCHORS[1]!;
  for (let i = 0; i < ANCHORS.length - 1; i += 1) {
    const a = ANCHORS[i]!;
    const b = ANCHORS[i + 1]!;
    if (minute >= a.minute && minute < b.minute) {
      from = a;
      to = b;
      break;
    }
  }
  const linear = (minute - from.minute) / Math.max(1, to.minute - from.minute);
  const mix = smoothstep(THREE.MathUtils.clamp(linear, 0, 1));
  const values = cloneValues(from.values);
  lerpValues(values, from.values, to.values, mix);
  return {
    minute,
    phase: phaseFromMinute(minute),
    fromPhase: from.phase,
    toPhase: to.phase,
    mix,
    values,
  };
}

/** 入口仍有“时间停住”的仪式，但保留当下的冷暖关系，不再退回统一黑场。 */
export function entryValues(scene: LightingValues): LightingValues {
  const entry = cloneValues(scene);
  entry.hemiI = Math.max(0.09, scene.hemiI * 0.46);
  entry.sunI *= 0.22;
  entry.windowI *= 0.34;
  entry.lampI *= 0.42;
  entry.bulbE *= 0.3;
  entry.screenE = Math.min(scene.screenE, 0.08);
  entry.exposure *= 0.83;
  entry.clockFillI = 0.92;
  entry.envI *= 0.42;
  entry.fogDensity *= 1.08;
  return entry;
}

/** 兼容旧调用：0 夜、1 昼；新系统内部不再用它驱动摄影光照。 */
export function dayBlendFromDate(date: Date): number {
  const sample = lightingFromDate(date);
  const v = sample.values;
  return THREE.MathUtils.clamp((v.sunI + v.windowI * 0.35) / 3.1, 0, 1);
}
