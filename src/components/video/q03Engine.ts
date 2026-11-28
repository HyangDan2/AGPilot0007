import { getVideoEngine, registerVideoEngine, type VideoEngine } from './engine';
import type { VideoContainer } from './engine';

type EngineVideoModule = typeof import('../../engine/video');
type FrameRendererModule = typeof import('../../engine/renderer/frameRenderer');

let engineVideo: Promise<EngineVideoModule> | null = null;
let frameRenderer: Promise<FrameRendererModule> | null = null;

/**
 * The shell (App → Workspace) must not pull mediabunny into the eager chunk, so
 * engine/video is only referenced through this dynamic import. Probe and export
 * are already async paths; the first open pays a one-time chunk load.
 */
function loadEngineVideo(): Promise<EngineVideoModule> {
  engineVideo ??= import('../../engine/video');
  return engineVideo;
}

/** The graded renderer rides the same lazy boundary (WebGL pipeline, no shell cost). */
function loadFrameRenderer(): Promise<FrameRendererModule> {
  frameRenderer ??= import('../../engine/renderer/frameRenderer');
  return frameRenderer;
}

/** Same suffix as the photo exporter so a video keeps the Film Studio naming. */
export function videoExportFilename(name: string, container: VideoContainer): string {
  const base = name.replace(/\.[^.]+$/, '') || 'video';
  return `${base}_HD2Lab_FilmStudio.${container}`;
}

/**
 * Q03 controller binding: `startVideoExport` already satisfies the contract
 * handle; this adapter lifts the produced blob/filename and injects Q01's
 * per-frame graded renderer so the export matches the photo pipeline.
 */
const q03Engine: VideoEngine = {
  async probe() {
    const engine = await loadEngineVideo();
    return engine.probeVideoCapabilities();
  },
  async exportVideo({ file, settings, grade }) {
    const [engine, { createVideoFrameRenderer }] = await Promise.all([loadEngineVideo(), loadFrameRenderer()]);
    const canvas = document.createElement('canvas');
    const renderer = createVideoFrameRenderer(canvas, grade);
    let task;
    try {
      task = engine.startVideoExport(file, { settings, renderer, canvas });
    } catch (error) {
      renderer.dispose();
      throw error;
    }
    return {
      promise: task.promise
        .then((result) => ({ blob: result.blob, filename: videoExportFilename(file.name, settings.container) }))
        .finally(() => renderer.dispose()),
      cancel: task.cancel,
      onProgress: task.onProgress,
    };
  },
};

export function bindQ03VideoEngine(): void {
  if (!getVideoEngine()) registerVideoEngine(q03Engine);
}
