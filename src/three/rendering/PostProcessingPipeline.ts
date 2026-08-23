import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { VignetteShader } from 'three/addons/shaders/VignetteShader.js';
import type { QualityTier } from '../../scripts/desk/storage';
import {
  boundedPostProcessingSize,
  renderQualityProfile,
  supportsHalfFloatColorBuffer,
  type AmbientOcclusionProfile,
} from './quality';

/**
 * GTAO is intentionally rendered below the final color resolution. Its denoiser
 * reconstructs the soft contact term well, while the hard dimension ceiling
 * prevents large HiDPI canvases from multiplying three full-size AO targets.
 */
class ScaledGTAOPass extends GTAOPass {
  constructor(
    scene: THREE.Scene,
    camera: THREE.Camera,
    private readonly profile: AmbientOcclusionProfile,
  ) {
    super(scene, camera, 1, 1);
    // The authored room intentionally contains two-sided cloth and wall planes.
    this.normalMaterial.side = THREE.DoubleSide;
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime: number,
    maskActive: boolean,
  ): void {
    // Interaction proxies use material.visible=false (rather than object.visible)
    // so raycasting can still hit them. Scene override materials would otherwise
    // turn those invisible meshes into phantom AO occluders. Thin transparent
    // overlays and glass are excluded for the same reason.
    const excluded: THREE.Object3D[] = [];
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh) || !object.visible) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      const contributes = materials.some(
        (material) =>
          material.visible &&
          (!material.transparent || material.opacity >= 0.5) &&
          material.depthWrite,
      );
      if (!contributes) {
        object.visible = false;
        excluded.push(object);
      }
    });

    try {
      super.render(renderer, writeBuffer, readBuffer, deltaTime, maskActive);
    } finally {
      for (const object of excluded) object.visible = true;
    }
  }

  override setSize(width: number, height: number): void {
    let aoWidth = Math.max(1, Math.round(width * this.profile.resolutionScale));
    let aoHeight = Math.max(1, Math.round(height * this.profile.resolutionScale));
    const largest = Math.max(aoWidth, aoHeight);
    if (largest > this.profile.maxDimension) {
      const scale = this.profile.maxDimension / largest;
      aoWidth = Math.max(1, Math.round(aoWidth * scale));
      aoHeight = Math.max(1, Math.round(aoHeight * scale));
    }
    super.setSize(aoWidth, aoHeight);
  }

  override dispose(): void {
    // GTAOPass r185 omits these two materials from its own dispose().
    this.gtaoMaterial.dispose();
    this.blendMaterial.dispose();
    super.dispose();
  }
}

/**
 * Optional screen-space finishing pipeline. Low quality deliberately keeps the
 * direct renderer path, preserving native MSAA and avoiding HDR render-target
 * allocations on constrained devices.
 */
export class PostProcessingPipeline {
  private composer: EffectComposer | null = null;
  private passes: Pass[] = [];
  private tier: QualityTier = 'low';
  private width = 1;
  private height = 1;
  private pixelRatio = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private readonly camera: THREE.Camera,
  ) {}

  setQuality(tier: QualityTier): void {
    if (tier === this.tier && (tier === 'low' || this.composer)) return;
    this.tier = tier;
    this.rebuild();
  }

  setPixelRatio(pixelRatio: number): void {
    this.pixelRatio = pixelRatio;
    this.syncComposerSize();
  }

  setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.syncComposerSize();
  }

  render(deltaTime: number): void {
    if (this.composer) {
      this.composer.render(deltaTime);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }

  dispose(): void {
    this.disposeComposer();
  }

  private rebuild(): void {
    this.disposeComposer();
    const profile = renderQualityProfile(this.tier);
    if (!profile.postProcessing) return;
    const halfFloatRenderable = supportsHalfFloatColorBuffer(
      this.renderer.capabilities.isWebGL2,
      (name) => this.renderer.extensions.has(name),
    );
    // GTAOPass and SMAAPass own HalfFloat targets that cannot be replaced from
    // here. If the color attachment is unsupported, native MSAA direct render
    // is the only path guaranteed not to produce an incomplete framebuffer.
    if (!halfFloatRenderable) return;

    // Linear HDR intermediates preserve highlight information until OutputPass
    // applies the renderer's AgX curve and sRGB transfer at the end of the chain.
    const target = new THREE.WebGLRenderTarget(1, 1, {
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = `desk-post-${this.tier}`;

    const composer = new EffectComposer(this.renderer, target);
    // EffectComposer inherits renderer.getPixelRatio() in its constructor.
    // All sizes below are already resolved physical pixels, so normalize the
    // composer before adding full-resolution passes to prevent a second DPR
    // multiplication from defeating the memory ceiling.
    composer.setPixelRatio(1);
    const renderPass = new RenderPass(this.scene, this.camera);
    composer.addPass(renderPass);
    this.passes.push(renderPass);

    if (profile.ao) {
      const aoPass = new ScaledGTAOPass(this.scene, this.camera, profile.ao);
      aoPass.blendIntensity = profile.ao.blendIntensity;
      aoPass.updateGtaoMaterial({
        radius: 0.16,
        distanceExponent: 1.35,
        thickness: 0.22,
        distanceFallOff: 1,
        scale: 0.9,
        samples: profile.ao.samples,
      });
      aoPass.updatePdMaterial({
        lumaPhi: 8,
        depthPhi: 2,
        normalPhi: 3,
        radius: this.tier === 'high' ? 7 : 5,
        rings: 2,
        samples: profile.ao.denoiseSamples,
      });
      composer.addPass(aoPass);
      this.passes.push(aoPass);
    }

    // OutputPass must precede screen-space AA because FXAA/SMAA consume sRGB.
    const outputPass = new OutputPass();
    composer.addPass(outputPass);
    this.passes.push(outputPass);

    // A restrained optical falloff anchors the desk without softening UI or
    // adding a permanently animated effect. It runs in display space after
    // tone mapping and before edge AA.
    const vignettePass = new ShaderPass(VignetteShader);
    vignettePass.uniforms.offset!.value = 0.72;
    vignettePass.uniforms.darkness!.value = 1;
    composer.addPass(vignettePass);
    this.passes.push(vignettePass);

    const aaPass = profile.antialias === 'smaa' ? new SMAAPass() : new FXAAPass();
    composer.addPass(aaPass);
    this.passes.push(aaPass);

    this.composer = composer;
    this.syncComposerSize();
  }

  private syncComposerSize(): void {
    if (!this.composer) return;
    const size = boundedPostProcessingSize(
      renderQualityProfile(this.tier),
      this.width,
      this.height,
      this.pixelRatio,
    );
    // Feed physical dimensions while leaving the composer's default DPR at 1.
    // The WebGL canvas DPR and PerspectiveCamera aspect remain untouched; the
    // final pass simply upscales this bounded result to the canvas viewport.
    this.composer.setSize(size.width, size.height);
  }

  private disposeComposer(): void {
    for (const pass of this.passes) pass.dispose();
    this.passes = [];
    this.composer?.dispose();
    this.composer = null;
  }
}
