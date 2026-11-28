import { describe, expect, it } from 'vitest';
import {
  avcCodecString,
  containerForCodec,
  defaultBitrate,
  fitResolution,
  h264Level,
  vp9CodecString,
} from '../src/engine/video/profiles';
import { resolveTrim, trimIsExact } from '../src/engine/video/trim';
import { audioFamily, planAudio } from '../src/engine/video/audio';
import { assertVideoBudget, estimateVideoExportBytes, videoMemoryBudgetMB } from '../src/engine/video/budget';
import { MemoryBudgetError, VideoCapabilityError, abortError } from '../src/engine/video/errors';

describe('AVC profile/level selection', () => {
  it('matches the WO profiles for 360p/720p/1080p and grows only with level math', () => {
    expect(avcCodecString(640, 360, 30, 1_500_000)).toBe('avc1.64001e');
    expect(avcCodecString(1280, 720, 30, 4_000_000)).toBe('avc1.64001f');
    expect(avcCodecString(1920, 1080, 30, 8_000_000)).toBe('avc1.640028');
    expect(avcCodecString(1920, 1080, 60, 12_000_000)).toBe('avc1.64002a');
    expect(avcCodecString(3840, 2160, 30, 30_000_000)).toBe('avc1.640033');
  });

  it('reports the concrete level object', () => {
    expect(h264Level(1280, 720, 30, 4_000_000).name).toBe('3.1');
    expect(h264Level(4096, 4096, 120, 900_000_000).name).toBe('6.2');
  });
});

describe('VP9 and resolution fitting', () => {
  it('derives a VP9 level from luma sample rate', () => {
    expect(vp9CodecString(1280, 720, 30)).toBe('vp09.00.31.08');
    expect(vp9CodecString(1920, 1080, 30)).toBe('vp09.00.40.08');
    expect(vp9CodecString(1920, 1080, 60)).toBe('vp09.00.41.08');
    expect(vp9CodecString(3840, 2160, 60)).toBe('vp09.00.51.08');
  });

  it('fits long edge without upscaling and keeps even dimensions', () => {
    expect(fitResolution('1080p', 3840, 2160)).toEqual({ width: 1920, height: 1080 });
    expect(fitResolution('720p', 1920, 1080)).toEqual({ width: 1280, height: 720 });
    expect(fitResolution('720p', 720, 1280)).toEqual({ width: 720, height: 1280 });
    expect(fitResolution('1080p', 480, 320)).toEqual({ width: 480, height: 320 });
    expect(fitResolution('source', 1281, 719)).toEqual({ width: 1282, height: 720 });
  });

  it('pairs containers with codecs and clamps bitrate', () => {
    expect(containerForCodec('avc')).toBe('mp4');
    expect(containerForCodec('vp9')).toBe('webm');
    expect(defaultBitrate(320, 240, 30, 'avc')).toBe(1_000_000);
    expect(defaultBitrate(3840, 2160, 30, 'avc')).toBe(24_883_200);
    expect(defaultBitrate(7680, 4320, 120, 'avc')).toBe(40_000_000);
  });
});

describe('Trim math', () => {
  it('snaps both edges to the frame grid and keeps at least one frame', () => {
    const resolved = resolveTrim({ startSec: 1.02, endSec: 5.03 }, 10, 30);
    expect(resolved.startSec).toBeCloseTo(31 / 30, 6);
    expect(resolved.endSec).toBeCloseTo(151 / 30, 6);
    expect(resolved.framesTotal).toBe(120);
    expect(trimIsExact({ startSec: 1.02, endSec: 5.03 }, resolved, 30)).toBe(true);

    const collapsed = resolveTrim({ startSec: 2, endSec: 2 }, 10, 30);
    expect(collapsed.endSec - collapsed.startSec).toBeCloseTo(1 / 30, 6);
    expect(collapsed.framesTotal).toBe(1);
  });

  it('clamps to the source duration and swaps inverted ranges', () => {
    const resolved = resolveTrim({ startSec: 8, endSec: 99 }, 10, 24);
    expect(resolved.endSec).toBe(10);
    expect(resolved.startSec).toBeLessThan(resolved.endSec);

    const swapped = resolveTrim({ startSec: 6, endSec: 2 }, 10, 24);
    expect(swapped.startSec).toBeCloseTo(2, 5);
    expect(swapped.endSec).toBeCloseTo(6, 5);

    const whole = resolveTrim(undefined, 6, 30);
    expect(whole.startSec).toBe(0);
    expect(whole.endSec).toBe(6);
    expect(whole.framesTotal).toBe(180);
    expect(trimIsExact({ startSec: 0.01, endSec: 5.99 }, whole, 30)).toBe(true);
  });
});

describe('Audio planning', () => {
  const base = { hasAudioEncoder: true, hasAudioDecoder: true };

  it('normalizes codec spellings', () => {
    expect(audioFamily('mp4a.40.2')).toBe('aac');
    expect(audioFamily('OPUS')).toBe('opus');
    expect(audioFamily('mp3')).toBe('mp3');
    expect(audioFamily(null)).toBeNull();
  });

  it('passes packets through only for muxable container/codec pairs', () => {
    expect(planAudio({ ...base, container: 'mp4', requested: 'passthrough', sourceCodec: 'mp4a.40.2' })).toEqual({ mode: 'passthrough' });
    expect(planAudio({ ...base, container: 'webm', requested: 'passthrough', sourceCodec: 'opus' })).toEqual({ mode: 'passthrough' });
  });

  it('re-encodes to AAC only inside MP4 with both codecs available', () => {
    const plan = planAudio({ ...base, container: 'mp4', requested: 'passthrough', sourceCodec: 'opus' });
    expect(plan.mode).toBe('aac');
    expect(plan.warning).toContain('re-encoding to AAC');
    expect(planAudio({ ...base, container: 'mp4', requested: 'passthrough', sourceCodec: 'opus', hasAudioEncoder: false }).mode).toBe('none');
    expect(planAudio({ ...base, container: 'webm', requested: 'aac', sourceCodec: 'opus' }).mode).toBe('none');
  });

  it('degrades to a warning-only silent track when AAC is impossible', () => {
    const plan = planAudio({ container: 'mp4', requested: 'aac', sourceCodec: 'opus', hasAudioEncoder: false, hasAudioDecoder: false });
    expect(plan.mode).toBe('none');
    expect(plan.warning).toBeTruthy();
    expect(planAudio({ ...base, container: 'mp4', requested: 'passthrough', sourceCodec: null })).toEqual({ mode: 'none' });
    expect(planAudio({ ...base, container: 'mp4', requested: 'none', sourceCodec: 'aac' })).toEqual({ mode: 'none' });
  });
});

describe('Memory budget pre-check', () => {
  it('estimates encoded output plus three frame surfaces', () => {
    const estimate = estimateVideoExportBytes({ bitrate: 8_000_000, durationSec: 10, audioBitrate: 128_000, frameWidth: 1920, frameHeight: 1080 });
    expect(estimate.encoded).toBe(Math.ceil(((8_000_000 + 128_000) / 8) * 10 * 1.25));
    expect(estimate.frameBytes).toBe(1920 * 1080 * 4 * 3);
    expect(estimate.total).toBe(estimate.encoded + estimate.frameBytes);
  });

  it('throws MemoryBudgetError with detail when over budget', () => {
    expect(() => assertVideoBudget(10 * 1048576, 64)).not.toThrow();
    try {
      assertVideoBudget(512 * 1048576, 64);
      throw new Error('expected MemoryBudgetError');
    } catch (error) {
      expect(error).toBeInstanceOf(MemoryBudgetError);
      expect((error as MemoryBudgetError).code).toBe('MemoryBudgetExceeded');
      expect((error as MemoryBudgetError).detail).toMatchObject({ estimateMB: 512, budgetMB: 64 });
    }
  });

  it('honors an explicit budget and falls back to 256 MB heads-up default', () => {
    expect(videoMemoryBudgetMB(128).budgetMB).toBe(128);
    const fallback = videoMemoryBudgetMB();
    expect(fallback.budgetMB).toBeGreaterThanOrEqual(64);
    expect(fallback.budgetMB).toBeLessThanOrEqual(512);
  });
});

describe('Error surface', () => {
  it('produces AbortError and capability errors with codes', () => {
    expect(abortError().name).toBe('AbortError');
    const error = new VideoCapabilityError('unsupported-codec', 'nope');
    expect(error.code).toBe('unsupported-codec');
    expect(error).toBeInstanceOf(Error);
  });
});
