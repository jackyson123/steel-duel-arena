import { defineGame } from 'wanaka-studio-engine/game';
import {
  applyProjectRenderSettings,
  applyProjectVisualPost,
  configureProjectRenderer,
  createProjectRenderPipeline,
  renderSettings as projectRenderSettings,
} from './rendering.js';
import { scenes } from './scenes.js';
import { UI_LOOK } from './ui/look.js';
import { visualProfile } from './visual.js';

void UI_LOOK;

export default defineGame({
  scenes,
  visualProfile,
  rendering: {
    configureProjectRenderer,
    projectRenderSettings,
    // Keep this accessor live: rendering settings can replace the pipeline
    // after the game composition root has been evaluated.
    get createProjectRenderPipeline() {
      return createProjectRenderPipeline;
    },
    applyProjectRenderSettings,
    applyProjectVisualPost,
  },
  play: () => import('./play.js'),
  quality: 'high',
  // Engine behavior level this project was written against. Keep it pinned;
  // raise it deliberately after re-testing the game.
  compat: { level: '2026-11' },
});
