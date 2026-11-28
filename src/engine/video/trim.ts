import type { VideoTrim } from './types';

export interface ResolvedTrim {
  startSec: number;
  endSec: number;
  framesTotal: number;
  frameDurationSec: number;
}

/**
 * Clamp to the source duration and snap both edges to the frame grid (nearest
 * frame, so the requested window is exact within half a frame). Guarantees at
 * least one frame.
 */
export function resolveTrim(trim: VideoTrim | undefined, durationSec: number, fps: number): ResolvedTrim {
  const safeFps = Number.isFinite(fps) && fps > 0 ? fps : 30;
  const frameDurationSec = 1 / safeFps;
  const duration = Number.isFinite(durationSec) && durationSec > 0 ? durationSec : frameDurationSec;
  const snap = (value: number) => Math.min(Math.max(0, value), duration);
  const requestedStart = trim ? trim.startSec : 0;
  const requestedEnd = trim ? trim.endSec : duration;
  const startFrame = Math.max(0, Math.round(snap(Math.min(requestedStart, requestedEnd)) * safeFps));
  const endFrame = Math.max(startFrame + 1, Math.round(snap(Math.max(requestedStart, requestedEnd)) * safeFps));
  const startSec = Math.min(startFrame * frameDurationSec, Math.max(0, duration - frameDurationSec));
  const endSec = Math.min(Math.max(endFrame * frameDurationSec, startSec + frameDurationSec), duration);
  return {
    startSec,
    endSec,
    framesTotal: Math.max(1, Math.round((endSec - startSec) * safeFps)),
    frameDurationSec,
  };
}

/** True when the end lands within one frame of the requested time. */
export function trimIsExact(trim: VideoTrim, resolved: ResolvedTrim, fps: number): boolean {
  const tolerance = 1 / (Number.isFinite(fps) && fps > 0 ? fps : 30);
  return Math.abs(resolved.startSec - trim.startSec) <= tolerance
    && Math.abs(resolved.endSec - trim.endSec) <= tolerance;
}
