import { describe, expect, it } from 'vitest';
import {
  circularDist,
  hmToMinutes,
  minutesToHourAngle,
  minutesToMinuteAngle,
  norm360,
  shortestDeg,
  unwrapDelta,
  MINUTES_PER_CYCLE,
} from './angles';

describe('norm360', () => {
  it('归一化到 [0,360)', () => {
    expect(norm360(0)).toBe(0);
    expect(norm360(360)).toBe(0);
    expect(norm360(-90)).toBe(270);
    expect(norm360(725)).toBe(5);
  });
});

describe('shortestDeg / unwrapDelta（跨 0/360 不跳变）', () => {
  it('顺时针跨 12 点：359° → 1° 应为 +2', () => {
    expect(shortestDeg(359, 1)).toBe(2);
  });

  it('逆时针跨 12 点：1° → 359° 应为 -2', () => {
    expect(shortestDeg(1, 359)).toBe(-2);
  });

  it('半圈边界 (-180,180]', () => {
    expect(shortestDeg(0, 180)).toBe(180);
    expect(shortestDeg(0, 181)).toBe(-179);
  });

  it('unwrapDelta 与 shortestDeg 一致', () => {
    expect(unwrapDelta(350, 10)).toBe(20);
  });
});

describe('circularDist', () => {
  it('模 720 的环形距离', () => {
    expect(circularDist(440, 440, MINUTES_PER_CYCLE)).toBe(0);
    expect(circularDist(439, 440, MINUTES_PER_CYCLE)).toBe(1);
    expect(circularDist(441, 440, MINUTES_PER_CYCLE)).toBe(1);
    // 跨 12 小时轮回：719 与 0 相距 1
    expect(circularDist(719, 0, MINUTES_PER_CYCLE)).toBe(1);
    // 反向最短：440 与 1160(=440+720) 等价
    expect(circularDist(1160, 440, MINUTES_PER_CYCLE)).toBe(0);
    expect(circularDist(-280, 440, MINUTES_PER_CYCLE)).toBe(0);
  });
});

describe('时间 ↔ 角度换算', () => {
  it('7:20 = 440 分钟', () => {
    expect(hmToMinutes(7, 20)).toBe(440);
    // 19:20（晚上）与 7:20 在 12 小时表盘上等价
    expect(hmToMinutes(19, 20)).toBe(440);
  });

  it('分针角：50 分 = 300°', () => {
    expect(minutesToMinuteAngle(hmToMinutes(6, 50))).toBe(300);
  });

  it('分针一圈 60 分钟', () => {
    expect(minutesToMinuteAngle(0)).toBe(0);
    expect(minutesToMinuteAngle(15)).toBe(90);
    expect(minutesToMinuteAngle(60)).toBe(0);
  });

  it('时针 1:12 联动：720 分钟一圈', () => {
    expect(minutesToHourAngle(0)).toBe(0);
    expect(minutesToHourAngle(hmToMinutes(3, 0))).toBe(90);
    expect(minutesToHourAngle(hmToMinutes(6, 0))).toBe(180);
    expect(minutesToHourAngle(hmToMinutes(7, 20))).toBe(220);
    // 连续量（多圈）同样正确
    expect(minutesToHourAngle(720 + 180)).toBe(90);
  });

  it('6:50 的时针在 6 与 7 之间', () => {
    const angle = minutesToHourAngle(hmToMinutes(6, 50));
    expect(angle).toBeGreaterThan(180);
    expect(angle).toBeLessThan(210);
  });
});
