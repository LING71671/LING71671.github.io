import { describe, expect, it } from 'vitest';
import {
  boundedPostProcessingSize,
  renderQualityProfile,
  supportsHalfFloatColorBuffer,
} from './quality';

describe('renderQualityProfile', () => {
  it('keeps the low tier on the native, allocation-light renderer path', () => {
    expect(renderQualityProfile('low')).toMatchObject({
      dprCap: 1,
      postProcessing: false,
      postProcessingBudget: null,
      antialias: 'native',
      ao: null,
    });
  });

  it('raises AO and antialiasing quality monotonically', () => {
    const mid = renderQualityProfile('mid');
    const high = renderQualityProfile('high');

    expect(mid.ao).not.toBeNull();
    expect(high.ao).not.toBeNull();
    expect(high.ao!.samples).toBeGreaterThan(mid.ao!.samples);
    expect(high.ao!.maxDimension).toBeGreaterThan(mid.ao!.maxDimension);
    expect(high.postProcessingBudget!.maxPixels).toBeGreaterThan(
      mid.postProcessingBudget!.maxPixels,
    );
    expect(mid.antialias).toBe('fxaa');
    expect(high.antialias).toBe('smaa');
  });

  it('requires a renderable half-float color attachment, not WebGL2 alone', () => {
    expect(supportsHalfFloatColorBuffer(false, () => true)).toBe(false);
    expect(supportsHalfFloatColorBuffer(true, () => false)).toBe(false);
    expect(
      supportsHalfFloatColorBuffer(
        true,
        (name) => name === 'EXT_color_buffer_float',
      ),
    ).toBe(true);
    expect(
      supportsHalfFloatColorBuffer(
        true,
        (name) => name === 'EXT_color_buffer_half_float',
      ),
    ).toBe(true);
  });

  it('keeps ordinary viewports at requested backing resolution', () => {
    const size = boundedPostProcessingSize(
      renderQualityProfile('high'),
      1280,
      720,
      1.5,
    );
    expect(size).toEqual({ width: 1920, height: 1080 });
  });

  it('caps both area and longest edge without changing viewport aspect', () => {
    const profile = renderQualityProfile('high');
    const fourKRetina = boundedPostProcessingSize(profile, 3840, 2160, 2);
    const ultrawide = boundedPostProcessingSize(profile, 5120, 1080, 2);

    for (const size of [fourKRetina, ultrawide]) {
      expect(Math.max(size.width, size.height)).toBeLessThanOrEqual(
        profile.postProcessingBudget!.maxDimension,
      );
      expect(size.width * size.height).toBeLessThanOrEqual(
        profile.postProcessingBudget!.maxPixels,
      );
    }
    expect(fourKRetina.width / fourKRetina.height).toBeCloseTo(16 / 9, 2);
    expect(ultrawide.width / ultrawide.height).toBeCloseTo(5120 / 1080, 2);
  });
});
