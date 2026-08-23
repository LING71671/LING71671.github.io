import * as THREE from 'three';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PostProcessingPipeline } from './PostProcessingPipeline';
import { renderQualityProfile } from './quality';

class StubImage {
  src = '';
  onload: (() => void) | null = null;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('PostProcessingPipeline backing-store budget', () => {
  it('normalizes composer DPR and bounds composer plus SMAA targets', () => {
    vi.stubGlobal('Image', StubImage);
    const renderer = {
      capabilities: { isWebGL2: true },
      extensions: { has: () => true },
      getPixelRatio: () => 2,
    } as unknown as THREE.WebGLRenderer;
    const pipeline = new PostProcessingPipeline(
      renderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    );

    pipeline.setQuality('high');
    pipeline.setPixelRatio(2);
    pipeline.setSize(3840, 2160);

    const internals = pipeline as unknown as {
      composer: {
        _pixelRatio: number;
        renderTarget1: THREE.WebGLRenderTarget;
        renderTarget2: THREE.WebGLRenderTarget;
      };
      passes: Array<{
        _edgesRT?: THREE.WebGLRenderTarget;
        _weightsRT?: THREE.WebGLRenderTarget;
      }>;
    };
    const budget = renderQualityProfile('high').postProcessingBudget!;
    const composerTargets = [
      internals.composer.renderTarget1,
      internals.composer.renderTarget2,
    ];
    const smaa = internals.passes.find((pass) => pass._edgesRT && pass._weightsRT);

    expect(internals.composer._pixelRatio).toBe(1);
    expect(smaa).toBeDefined();
    for (const target of [
      ...composerTargets,
      smaa!._edgesRT!,
      smaa!._weightsRT!,
    ]) {
      expect(Math.max(target.width, target.height)).toBeLessThanOrEqual(
        budget.maxDimension,
      );
      expect(target.width * target.height).toBeLessThanOrEqual(budget.maxPixels);
    }

    pipeline.dispose();
  });

  it('does not allocate a composer without a half-float color attachment', () => {
    const renderer = {
      capabilities: { isWebGL2: true },
      extensions: { has: () => false },
      getPixelRatio: () => 2,
    } as unknown as THREE.WebGLRenderer;
    const pipeline = new PostProcessingPipeline(
      renderer,
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
    );

    pipeline.setQuality('high');

    expect(
      (pipeline as unknown as { composer: unknown | null }).composer,
    ).toBeNull();
    pipeline.dispose();
  });
});
