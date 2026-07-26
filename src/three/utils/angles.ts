/**
 * 时钟角度数学：角度解包 / 环形距离 / 分钟换算。
 * 约定：分针角以「12 点方向为 0，顺时针为正」，单位为度。
 * 1 分钟 = 6°；表盘一圈 = 60 分钟；时针联动比 1:12。
 */

export const DEG_PER_MINUTE = 6;
export const MINUTES_PER_TURN = 60;
/** 12 小时制一轮 = 720 分钟 */
export const MINUTES_PER_CYCLE = 720;

/** 归一化到 [0, 360) */
export function norm360(deg: number): number {
  const d = deg % 360;
  return d < 0 ? d + 360 : d;
}

/** 最短角差（deg），结果在 (-180, 180] */
export function shortestDeg(from: number, to: number): number {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

/** 环形距离：|a-b| 在模 cycle 意义下的最小值 */
export function circularDist(a: number, b: number, cycle: number): number {
  const d = Math.abs(((a - b) % cycle) + cycle) % cycle;
  return Math.min(d, cycle - d);
}

/** 分钟数（可为小数/任意实数）→ 分针角度 [0,360) */
export function minutesToMinuteAngle(totalMinutes: number): number {
  return norm360(totalMinutes * DEG_PER_MINUTE);
}

/** 分钟数 → 时针角度 [0,360)（时针 720 分钟走一圈，即 0.5°/分钟） */
export function minutesToHourAngle(totalMinutes: number): number {
  return norm360(totalMinutes * 0.5);
}

/** 时:分 → 12 小时制分钟数 [0, 720) */
export function hmToMinutes(hour: number, minute: number): number {
  return ((hour % 12) * 60 + minute) % MINUTES_PER_CYCLE;
}

/**
 * 角度解包：给定上一帧指针角与本帧指针角，返回连续增量（deg）。
 * 跨 0/360 不跳变——增量始终取最短路径。
 */
export function unwrapDelta(prevAngle: number, nextAngle: number): number {
  return shortestDeg(prevAngle, nextAngle);
}
