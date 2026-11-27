import type { PreviewRequestFlags, RenderPipelineBackend, RenderPipelineFrame } from '../pipeline/renderPipeline';
import type { RenderRequest } from '../pipeline/renderSettings';
import type { WebGL2FilmRenderer } from './webglRenderer';

const DEFAULT_EXTRAS: PreviewRequestFlags = {
  compareMode: 'none',
  splitPos: 1,
  seed: 42,
  sharpeningMask: false,
  sharpeningDraft: false,
  mixerReference: false,
  mixerVisualize: null,
};

export function buildRenderRequest(frame: RenderPipelineFrame): RenderRequest {
  const extras = frame.extras ?? DEFAULT_EXTRAS;
  return {
    ...frame.settings,
    compareMode: extras.compareMode,
    splitPos: extras.splitPos,
    seed: extras.seed ?? 42,
    sourceWidth: extras.sourceWidth,
    sourceHeight: extras.sourceHeight,
    sharpeningMask: extras.sharpeningMask,
    sharpeningDraft: extras.sharpeningDraft,
    mixerReference: extras.mixerReference,
    mixerVisualize: extras.mixerVisualize ?? null,
  };
}

/**
 * Adapter between the plan executor and the existing WebGL2 renderer. The
 * renderer keeps ownership of GL resources; the pipeline only supplies the
 * frame and its preview-only request flags.
 */
export function createWebGLPipelineBackend(renderer: WebGL2FilmRenderer): RenderPipelineBackend {
  return {
    render(frame) {
      renderer.render(buildRenderRequest(frame));
    },
  };
}
