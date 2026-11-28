import { startVideoExport, probeVideoCapabilities } from '../../engine/video';
import { getVideoEngine, registerVideoEngine, type VideoEngine } from './engine';
import type { VideoContainer } from './engine';

/** Same suffix as the photo exporter so a video keeps the Film Studio naming. */
export function videoExportFilename(name: string, container: VideoContainer): string {
  const base = name.replace(/\.[^.]+$/, '') || 'video';
  return `${base}_HD2Lab_FilmStudio.${container}`;
}

/**
 * Q03 controller binding: `startVideoExport` already satisfies the contract
 * handle; this adapter only lifts the produced blob/filename and leaves the
 * graded renderer to CP4-01b (the engine falls back to its 2D canvas adapter).
 */
const q03Engine: VideoEngine = {
  probe: probeVideoCapabilities,
  exportVideo({ file, settings }) {
    const task = startVideoExport(file, { settings });
    return {
      promise: task.promise.then((result) => ({ blob: result.blob, filename: videoExportFilename(file.name, settings.container) })),
      cancel: task.cancel,
      onProgress: task.onProgress,
    };
  },
};

export function bindQ03VideoEngine(): void {
  if (!getVideoEngine()) registerVideoEngine(q03Engine);
}
