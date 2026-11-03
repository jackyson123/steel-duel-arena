import type { SceneCatalog as EngineSceneCatalog, SceneContextForCatalog } from 'wanaka-studio-engine/scene';

export const scenes = {
  main: () => import('./scenes/main.js'),
} satisfies EngineSceneCatalog;

export type SceneId = keyof typeof scenes;
export type SceneCatalog = typeof scenes;
export type ProjectSceneContext = SceneContextForCatalog<typeof scenes>;
