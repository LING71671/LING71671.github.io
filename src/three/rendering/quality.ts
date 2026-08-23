import type { QualityTier } from '../../scripts/desk/storage';

export type AntialiasMode = 'native' | 'fxaa' | 'smaa';

export interface AmbientOcclusionProfile {
  /** GTAO buffer scale relative to the composer's effective resolution. */
  resolutionScale: number;
  /** Hard ceiling keeps ultrawide/HiDPI screens from allocating oversized AO buffers. */
  maxDimension: number;
  samples: number;
  denoiseSamples: number;
  blendIntensity: number;
}

export interface RenderQualityProfile {
  dprCap: number;
  postProcessing: boolean;
  /**
   * Off-screen buffers are allowed to render below the canvas backing size.
   * The final pass upscales to the untouched WebGL canvas, so camera/layout
   * semantics stay in CSS pixels while transient GPU memory remains bounded.
   */
  postProcessingBudget: {
    maxDimension: number;
    maxPixels: number;
  } | null;
  antialias: AntialiasMode;
  ao: AmbientOcclusionProfile | null;
}

export interface PostProcessingSize {
  width: number;
  height: number;
}

const HALF_FLOAT_COLOR_BUFFER_EXTENSIONS = [
  'EXT_color_buffer_float',
  'EXT_color_buffer_half_float',
] as const;

/**
 * GTAO and SMAA in three.js allocate HalfFloat render targets internally.
 * WebGL2 alone does not guarantee that those textures are color-renderable.
 */
export function supportsHalfFloatColorBuffer(
  isWebGL2: boolean,
  hasExtension: (name: string) => boolean,
): boolean {
  return (
    isWebGL2 &&
    HALF_FLOAT_COLOR_BUFFER_EXTENSIONS.some((name) => hasExtension(name))
  );
}

/**
 * Resolve the composer's physical size independently of the renderer canvas.
 * Both a longest-edge and an area ceiling are required: either one alone is
 * insufficient for ultrawide or near-square HiDPI displays.
 */
export function boundedPostProcessingSize(
  profile: RenderQualityProfile,
  logicalWidth: number,
  logicalHeight: number,
  requestedPixelRatio: number,
): PostProcessingSize {
  const width = Math.max(1, Number.isFinite(logicalWidth) ? logicalWidth : 1);
  const height = Math.max(1, Number.isFinite(logicalHeight) ? logicalHeight : 1);
  const ratio = Math.max(
    0.01,
    Number.isFinite(requestedPixelRatio) ? requestedPixelRatio : 1,
  );
  const requestedWidth = width * ratio;
  const requestedHeight = height * ratio;
  const budget = profile.postProcessingBudget;
  if (!budget) {
    return {
      width: Math.max(1, Math.round(requestedWidth)),
      height: Math.max(1, Math.round(requestedHeight)),
    };
  }

  const dimensionScale =
    budget.maxDimension / Math.max(requestedWidth, requestedHeight);
  const pixelScale = Math.sqrt(
    budget.maxPixels / (requestedWidth * requestedHeight),
  );
  const scale = Math.min(1, dimensionScale, pixelScale);

  return {
    width: Math.max(1, Math.floor(requestedWidth * scale)),
    height: Math.max(1, Math.floor(requestedHeight * scale)),
  };
}

const PROFILES: Record<QualityTier, RenderQualityProfile> = {
  low: {
    dprCap: 1,
    postProcessing: false,
    postProcessingBudget: null,
    antialias: 'native',
    ao: null,
  },
  mid: {
    dprCap: 1.5,
    postProcessing: true,
    postProcessingBudget: {
      maxDimension: 1920,
      maxPixels: 1920 * 1080,
    },
    antialias: 'fxaa',
    ao: {
      resolutionScale: 0.5,
      maxDimension: 960,
      samples: 8,
      denoiseSamples: 8,
      blendIntensity: 0.46,
    },
  },
  high: {
    dprCap: 2,
    postProcessing: true,
    postProcessingBudget: {
      maxDimension: 2560,
      maxPixels: 2560 * 1440,
    },
    antialias: 'smaa',
    ao: {
      resolutionScale: 0.65,
      maxDimension: 1440,
      samples: 16,
      denoiseSamples: 12,
      blendIntensity: 0.62,
    },
  },
};

export function renderQualityProfile(tier: QualityTier): RenderQualityProfile {
  return PROFILES[tier];
}
