import { describe, expect, it } from 'vitest';
import {
  entryValues,
  lightingFromDate,
  minuteOfDay,
  phaseFromMinute,
} from './presets';

const at = (hour: number, minute = 0, second = 0) =>
  new Date(2026, 0, 1, hour, minute, second);

describe('现实时间光照时间线', () => {
  it('按设备本地时间计算分钟，并保留秒级连续量', () => {
    expect(minuteOfDay(at(7, 20, 30))).toBeCloseTo(440.5);
  });

  it('四个时段边界明确，午夜正确环回', () => {
    expect(phaseFromMinute(299.99)).toBe('night');
    expect(phaseFromMinute(300)).toBe('dawn');
    expect(phaseFromMinute(480)).toBe('day');
    expect(phaseFromMinute(1020)).toBe('dusk');
    expect(phaseFromMinute(1320)).toBe('night');
    expect(phaseFromMinute(1440)).toBe('night');
    expect(phaseFromMinute(-1)).toBe('night');
  });

  it('关键摄影锚点落到预期太阳高度与强度', () => {
    const dawn = lightingFromDate(at(6, 30));
    const noon = lightingFromDate(at(12, 30));
    const sunset = lightingFromDate(at(18, 30));
    const night = lightingFromDate(at(23, 10));

    expect(dawn.phase).toBe('dawn');
    expect(dawn.values.sunI).toBeCloseTo(0.58);
    expect(dawn.values.sunPosition.y).toBeCloseTo(0.72);
    expect(noon.values.sunI).toBeCloseTo(2.65);
    expect(noon.values.sunPosition.y).toBeCloseTo(4.4);
    expect(sunset.values.sunColor.r).toBeGreaterThan(sunset.values.sunColor.b);
    expect(night.values.sunI).toBe(0);
    expect(night.values.lampI).toBeGreaterThan(2);
  });

  it('07:20 保持蓝调低填充，并用独立窗格投影建立结构', () => {
    const dawn = lightingFromDate(at(7, 20)).values;
    expect(dawn.hemiI).toBeLessThan(0.1);
    expect(dawn.envI).toBeLessThan(0.1);
    expect(dawn.patternI).toBeGreaterThan(1);
    expect(dawn.lampI).toBeLessThan(0.2);
  });

  it('边界附近连续，不产生整档跳变', () => {
    const before = lightingFromDate(at(7, 59, 59)).values;
    const after = lightingFromDate(at(8, 0, 1)).values;
    expect(Math.abs(before.sunI - after.sunI)).toBeLessThan(0.01);
    const colorDelta = Math.hypot(
      before.sunColor.r - after.sunColor.r,
      before.sunColor.g - after.sunColor.g,
      before.sunColor.b - after.sunColor.b,
    );
    expect(colorDelta).toBeLessThan(0.01);
  });

  it('入口暗态保留现实时间色温，同时压低环境并突出时钟', () => {
    const scene = lightingFromDate(at(18, 20)).values;
    const entry = entryValues(scene);
    expect(entry.sunColor.getHex()).toBe(scene.sunColor.getHex());
    expect(entry.skyTop.getHex()).toBe(scene.skyTop.getHex());
    expect(entry.sunI).toBeLessThan(scene.sunI);
    expect(entry.windowI).toBeLessThan(scene.windowI);
    expect(entry.clockFillI).toBeGreaterThan(0.8);
  });
});
