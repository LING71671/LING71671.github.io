import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { SceneManager } from '../core/SceneManager';
import {
  CAMERA_PORTRAIT_FOV_CAP,
  CAMERA_REFERENCE_ASPECT,
  CameraRig,
  portraitCompositionWeight,
  responsiveCameraFit,
} from './CameraRig';
import { ENTRY_POSE, FOCUS_POSES, HOME_POSE } from './poses';
import { DESK_TOP_Y, LAYOUT } from '../config/layout';

const PORTRAIT_ASPECT = 390 / 844;

function horizontalHalfSpan(
  fov: number,
  aspect: number,
  distanceScale = 1,
): number {
  return (
    Math.tan(THREE.MathUtils.degToRad(fov) / 2) * aspect * distanceScale
  );
}

describe('responsiveCameraFit', () => {
  it('leaves the authored 16:9 and wider composition unchanged', () => {
    expect(responsiveCameraFit(HOME_POSE.fov, CAMERA_REFERENCE_ASPECT)).toEqual({
      fov: HOME_POSE.fov,
      distanceScale: 1,
    });
    expect(responsiveCameraFit(HOME_POSE.fov, 21 / 9)).toEqual({
      fov: HOME_POSE.fov,
      distanceScale: 1,
    });
  });

  it('uses lens expansion alone while the portrait FOV remains comfortable', () => {
    const fit = responsiveCameraFit(HOME_POSE.fov, 4 / 3);

    expect(fit.fov).toBeLessThan(CAMERA_PORTRAIT_FOV_CAP);
    expect(fit.distanceScale).toBe(1);
    expect(horizontalHalfSpan(fit.fov, 4 / 3)).toBeCloseTo(
      horizontalHalfSpan(HOME_POSE.fov, CAMERA_REFERENCE_ASPECT),
    );
  });

  it('caps the lens and dollies ENTRY, HOME, and focus poses at 390x844', () => {
    const authoredFovs = [
      ENTRY_POSE.fov,
      HOME_POSE.fov,
      ...Object.values(FOCUS_POSES).map((pose) => pose.fov),
    ];

    for (const authoredFov of authoredFovs) {
      const fit = responsiveCameraFit(authoredFov, PORTRAIT_ASPECT);
      expect(fit.fov).toBe(CAMERA_PORTRAIT_FOV_CAP);
      expect(fit.distanceScale).toBeGreaterThan(1);
      expect(
        horizontalHalfSpan(fit.fov, PORTRAIT_ASPECT, fit.distanceScale),
      ).toBeCloseTo(
        horizontalHalfSpan(authoredFov, CAMERA_REFERENCE_ASPECT),
      );
    }
  });

  it('uses the HOME portrait crop without changing ENTRY or focus framing', () => {
    const baseline = responsiveCameraFit(HOME_POSE.fov, PORTRAIT_ASPECT);
    const homeFit = responsiveCameraFit(
      HOME_POSE.fov,
      PORTRAIT_ASPECT,
      HOME_POSE.portrait?.horizontalSpanScale,
    );

    expect(portraitCompositionWeight(PORTRAIT_ASPECT)).toBe(1);
    expect(homeFit.fov).toBe(CAMERA_PORTRAIT_FOV_CAP);
    expect(homeFit.distanceScale).toBeLessThan(baseline.distanceScale);
    expect(
      horizontalHalfSpan(homeFit.fov, PORTRAIT_ASPECT, homeFit.distanceScale),
    ).toBeCloseTo(
      horizontalHalfSpan(HOME_POSE.fov, CAMERA_REFERENCE_ASPECT) *
        HOME_POSE.portrait!.horizontalSpanScale,
    );

    const entryFit = responsiveCameraFit(ENTRY_POSE.fov, PORTRAIT_ASPECT);
    expect(
      horizontalHalfSpan(entryFit.fov, PORTRAIT_ASPECT, entryFit.distanceScale),
    ).toBeCloseTo(
      horizontalHalfSpan(ENTRY_POSE.fov, CAMERA_REFERENCE_ASPECT),
    );
  });

  it('blends portrait art direction instead of jumping at orientation changes', () => {
    expect(portraitCompositionWeight(1)).toBe(0);
    expect(portraitCompositionWeight(7 / 8)).toBeGreaterThan(0);
    expect(portraitCompositionWeight(7 / 8)).toBeLessThan(1);
    expect(portraitCompositionWeight(3 / 4)).toBe(1);
  });
});

describe('CameraRig viewport recomposition', () => {
  it('keeps ENTRY on the original portrait-preserving path', () => {
    const camera = new THREE.PerspectiveCamera(
      ENTRY_POSE.fov,
      PORTRAIT_ASPECT,
      0.02,
      20,
    );
    const manager = {
      camera,
      invalidate: vi.fn(),
    } as unknown as SceneManager;
    const rig = new CameraRig(manager);
    const fit = responsiveCameraFit(ENTRY_POSE.fov, PORTRAIT_ASPECT);

    rig.snapTo(ENTRY_POSE);

    expect(camera.position.distanceTo(ENTRY_POSE.target)).toBeCloseTo(
      ENTRY_POSE.position.distanceTo(ENTRY_POSE.target) * fit.distanceScale,
    );
    const direction = new THREE.Vector3();
    camera.getWorldDirection(direction);
    expect(
      direction.distanceTo(
        ENTRY_POSE.target.clone().sub(camera.position).normalize(),
      ),
    ).toBeLessThan(1e-6);
  });

  it('dollies from the target on portrait and restores the authored pose at 16:9', () => {
    const camera = new THREE.PerspectiveCamera(
      HOME_POSE.fov,
      PORTRAIT_ASPECT,
      0.02,
      20,
    );
    const manager = {
      camera,
      invalidate: vi.fn(),
    } as unknown as SceneManager;
    const rig = new CameraRig(manager);
    const authoredDistance = HOME_POSE.position.distanceTo(HOME_POSE.target);
    const portraitFit = responsiveCameraFit(
      HOME_POSE.fov,
      PORTRAIT_ASPECT,
      HOME_POSE.portrait?.horizontalSpanScale,
    );

    rig.snapTo(HOME_POSE);
    expect(camera.fov).toBe(CAMERA_PORTRAIT_FOV_CAP);
    expect(camera.position.distanceTo(HOME_POSE.target)).toBeCloseTo(
      authoredDistance * portraitFit.distanceScale,
    );
    const portraitDirection = new THREE.Vector3();
    camera.getWorldDirection(portraitDirection);
    const expectedPortraitDirection = HOME_POSE.target
      .clone()
      .add(HOME_POSE.portrait!.lookOffset)
      .sub(camera.position)
      .normalize();
    expect(portraitDirection.distanceTo(expectedPortraitDirection)).toBeLessThan(
      1e-6,
    );

    camera.updateMatrixWorld();
    const deskFrontLeft = new THREE.Vector3(
      -LAYOUT.desk.w / 2,
      DESK_TOP_Y,
      LAYOUT.desk.d / 2 - 0.08,
    ).project(camera);
    const deskFrontRight = new THREE.Vector3(
      LAYOUT.desk.w / 2,
      DESK_TOP_Y,
      LAYOUT.desk.d / 2 - 0.08,
    ).project(camera);
    const deskWidthFraction = Math.abs(deskFrontRight.x - deskFrontLeft.x) / 2;
    expect(deskWidthFraction).toBeGreaterThanOrEqual(0.95);
    expect(deskWidthFraction).toBeLessThanOrEqual(1.05);

    camera.aspect = CAMERA_REFERENCE_ASPECT;
    rig.resize();
    expect(camera.fov).toBe(HOME_POSE.fov);
    expect(camera.position.distanceTo(HOME_POSE.target)).toBeCloseTo(
      authoredDistance,
    );
  });

  it('tweens portrait crop and look offset with the pose', async () => {
    const camera = new THREE.PerspectiveCamera(
      ENTRY_POSE.fov,
      PORTRAIT_ASPECT,
      0.02,
      20,
    );
    const samples: Array<{
      position: THREE.Vector3;
      span: number;
      look: THREE.Vector3;
    }> = [];
    let rig: CameraRig;
    const manager = {
      camera,
      invalidate: vi.fn(),
      tweens: {
        run: (opts: {
          onUpdate: (t: number) => void;
          onComplete?: () => void;
        }) => {
          for (const t of [0, 0.5, 1]) {
            opts.onUpdate(t);
            const state = rig as unknown as {
              basePortraitSpanScale: number;
              basePortraitLookOffset: THREE.Vector3;
            };
            samples.push({
              position: camera.position.clone(),
              span: state.basePortraitSpanScale,
              look: state.basePortraitLookOffset.clone(),
            });
          }
          opts.onComplete?.();
          return { cancel: vi.fn(), update: vi.fn() };
        },
      },
    } as unknown as SceneManager;
    rig = new CameraRig(manager);
    rig.snapTo(ENTRY_POSE);
    const before = camera.position.clone();

    await rig.flyTo(HOME_POSE, 1);

    expect(samples[0].position.distanceTo(before)).toBeLessThan(1e-8);
    expect(samples[0].span).toBe(1);
    expect(samples[1].span).toBeCloseTo(
      (1 + HOME_POSE.portrait!.horizontalSpanScale) / 2,
    );
    expect(samples[1].look.y).toBeCloseTo(
      HOME_POSE.portrait!.lookOffset.y / 2,
    );
    expect(samples[2].span).toBe(HOME_POSE.portrait!.horizontalSpanScale);
    expect(samples[2].look.distanceTo(HOME_POSE.portrait!.lookOffset)).toBe(0);
  });
});
