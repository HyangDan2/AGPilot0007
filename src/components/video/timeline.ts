export interface TimeRange {
  startSec: number;
  endSec: number;
}

export function formatTime(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const whole = Math.floor(safe);
  const frames = Math.floor((safe - whole) * 100);
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}.${String(frames).padStart(2, '0')}`;
}

export function frameStep(time: number, fps: number, direction: 1 | -1, duration: number): number {
  const step = 1 / Math.max(1, fps);
  return Math.min(Math.max(0, duration), Math.max(0, time + direction * step));
}

/** Keeps at least one frame between in/out so an empty trim can never reach the engine. */
export function clampTrim(startSec: number, endSec: number, duration: number, fps: number): TimeRange {
  const minGap = 1 / Math.max(1, fps);
  const limit = Math.max(0, duration);
  const start = Math.min(Math.max(0, Number.isFinite(startSec) ? startSec : 0), Math.max(0, limit - minGap));
  const end = Math.min(limit, Math.max(start + minGap, Number.isFinite(endSec) ? endSec : limit));
  return { startSec: start, endSec: end };
}

/** Playback inside the trim window: past the out point loops back to the in point. */
export function loopTime(time: number, range: TimeRange): number {
  if (time < range.startSec) return range.startSec;
  if (time >= range.endSec) return range.startSec + ((time - range.startSec) % Math.max(0.001, range.endSec - range.startSec));
  return time;
}

export function trimFraction(value: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.min(1, Math.max(0, value / duration));
}
