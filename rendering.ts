import type { WebGPURenderer } from 'three/webgpu';
import {
  ProjectRendering,
  type ProjectRenderSettings,
  type RenderPipelineFactory,
  type RenderSession,
} from 'wanaka-studio-engine/render-session';
import { visualProfile, type ProjectVisualProfile } from './visual.js';

/** Literal switches. Visual Style grading/ink may still use the standard graph when disabled. */
export const renderSettings: ProjectRenderSettings = {
  enabled: false,
  ambientOcclusion: true,
  ssgi: false,
  vxgi: false,
  orderIndependentTransparency: false,
  ssr: false,
  bloom: false,
  bloomStrength: 0.1,
  bloomThreshold: 0.2,
  depthOfField: false,
  depthOfFieldBokehScale: 1.25,
  motionBlur: false,
  motionBlurAmount: 1,
  godRays: false,
  godRaysDensity: 0.7,
  lensFlare: false,
  lensFlareAmount: 1,
  afterimage: false,
  afterimageDamp: 0.96,
  contactShadows: false,
  contactShadowsIntensity: 1,
  // If the scene exceeds shadowDistance, increase it here instead of editing the key light.
  // The Engine owns CSM for the bound key light; do not write sun.shadow.* in game/scenes/main.ts.
  // See the key-light comment in game/scenes/main.ts.
  directionalShadow: { shadowDistance: 96, cascades: 2, splitLambda: 0.5, texelAlignment: true, fade: true },
  shadowMap: 'pcf-soft',
};

const projectRendering = new ProjectRendering(renderSettings, {
  post: visualProfile.post,
  shadowMode: visualProfile.lighting.shadowMode,
  shading: visualProfile.shading,
  palette: visualProfile.palette,
});

export function configureProjectRenderer(renderer: WebGPURenderer): void {
  projectRendering.configureRenderer(renderer);
}

export function setDepthOfFieldAmount(amount: number): void {
  projectRendering.setDepthOfFieldAmount(amount);
}

export function setBloomStrength(strength: number): void {
  projectRendering.setBloomStrength(strength);
}

/** Updates the live linear highlight extraction threshold without rebuilding. */
export function setBloomThreshold(threshold: number): void {
  projectRendering.setBloomThreshold(threshold);
}

export function setMotionBlurAmount(amount: number): void {
  projectRendering.setMotionBlurAmount(amount);
}

export function setGodRaysDensity(density: number): void {
  projectRendering.setGodRaysDensity(density);
}

export function setLensFlareAmount(amount: number): void {
  projectRendering.setLensFlareAmount(amount);
}

export function setAfterimageDamp(damp: number): void {
  projectRendering.setAfterimageDamp(damp);
}

export function setContactShadowsIntensity(intensity: number): void {
  projectRendering.setContactShadowsIntensity(intensity);
}

export let createProjectRenderPipeline: RenderPipelineFactory | undefined =
  projectRendering.createPipeline;

export function applyProjectRenderSettings(
  rendering: RenderSession,
  settings: unknown
): void {
  projectRendering.applySettings(rendering, settings);
  createProjectRenderPipeline = projectRendering.createPipeline;
}
export function applyProjectVisualPost(
  rendering: RenderSession,
  post: ProjectVisualProfile['post'],
  shadowMode: ProjectVisualProfile['lighting']['shadowMode'],
  targetScene?: import('three/webgpu').Scene | null,
  shading?: ProjectVisualProfile['shading'],
  palette?: ProjectVisualProfile['palette']
): void {
  const { bloom: compatibilityBloom, ...stylePost } = post;
  projectRendering.applyVisualSettings(rendering, {
    post: stylePost,
    compatibility: { bloom: compatibilityBloom, shadowMode },
    ...(targetScene !== undefined ? { targetScene } : {}),
    ...(shading !== undefined ? { shading } : {}),
    ...(palette !== undefined ? { palette } : {}),
  });
  createProjectRenderPipeline = projectRendering.createPipeline;
}
export function releaseProjectVisualPost(rendering: RenderSession): void {
  projectRendering.releaseVisualRenderer(rendering.nativeRenderer);
}
