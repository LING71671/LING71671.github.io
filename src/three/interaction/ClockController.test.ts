import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AudioManager } from '../audio/AudioManager';
import { NODES } from '../config/naming';
import type { EventBus } from '../core/EventBus';
import type { NodeRegistry } from '../core/NodeRegistry';
import type { SceneManager } from '../core/SceneManager';
import { TweenRunner } from '../utils/tween';
import { ClockController } from './ClockController';

function fixture() {
  const hands = new Map<string, THREE.Object3D>([
    [NODES.clockHandHour, new THREE.Object3D()],
    [NODES.clockHandMinute, new THREE.Object3D()],
    [NODES.clockHandSecond, new THREE.Object3D()],
  ]);
  const tweens = new TweenRunner();
  const manager = {
    tweens,
    invalidate: vi.fn(),
    addUpdater: vi.fn(() => vi.fn()),
  } as unknown as SceneManager;
  const registry = {
    get: (name: string) => hands.get(name) ?? null,
  } as unknown as NodeRegistry;
  const bus = { emit: vi.fn() } as unknown as EventBus;
  const audio = {
    detent: vi.fn(), tick: vi.fn(), chime: vi.fn(),
  } as unknown as AudioManager;
  return { clock: new ClockController(manager, registry, bus, audio), hands, tweens };
}

afterEach(() => vi.useRealTimers());

describe('ClockController loader handoff', () => {
  it('uses the deterministic 6:50 pose with the second hand at twelve', () => {
    const { clock, hands } = fixture();
    clock.setToLoaderHandoff();

    expect(hands.get(NODES.clockHandMinute)!.rotation.z).toBeCloseTo(
      -THREE.MathUtils.degToRad(300),
    );
    expect(hands.get(NODES.clockHandHour)!.rotation.z).toBeCloseTo(
      -THREE.MathUtils.degToRad(205),
    );
    expect(hands.get(NODES.clockHandSecond)!.rotation.z).toBeCloseTo(0);
  });

  it('tweens from the canonical pose and lands on the current local time', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1, 9, 15, 30));
    const { clock, hands, tweens } = fixture();
    clock.setToLoaderHandoff();

    const released = clock.releaseLoaderHandoff(1);
    tweens.update(0.5);
    expect(hands.get(NODES.clockHandMinute)!.rotation.z).not.toBeCloseTo(
      -THREE.MathUtils.degToRad(300),
    );
    tweens.update(0.5);
    await released;

    expect(hands.get(NODES.clockHandMinute)!.rotation.z).toBeCloseTo(
      -THREE.MathUtils.degToRad(90),
    );
    expect(hands.get(NODES.clockHandHour)!.rotation.z).toBeCloseTo(
      -THREE.MathUtils.degToRad(277.5),
    );
    expect(hands.get(NODES.clockHandSecond)!.rotation.z).toBeCloseTo(-Math.PI);
  });
});
