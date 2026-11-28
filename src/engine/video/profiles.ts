import type { VideoCodec, VideoContainer, VideoResolution } from './types';

interface H264Level { name: string; hex: string; maxFs: number; maxMbps: number; maxBr: number }

const H264_LEVELS: readonly H264Level[] = [
  { name: '3.0', hex: '1e', maxFs: 1620, maxMbps: 40500, maxBr: 10_000_000 },
  { name: '3.1', hex: '1f', maxFs: 3600, maxMbps: 108000, maxBr: 14_000_000 },
  { name: '3.2', hex: '20', maxFs: 5120, maxMbps: 216000, maxBr: 20_000_000 },
  { name: '4.0', hex: '28', maxFs: 8192, maxMbps: 245760, maxBr: 20_000_000 },
  { name: '4.1', hex: '29', maxFs: 8192, maxMbps: 245760, maxBr: 50_000_000 },
  { name: '4.2', hex: '2a', maxFs: 8704, maxMbps: 522240, maxBr: 50_000_000 },
  { name: '5.0', hex: '32', maxFs: 22080, maxMbps: 589824, maxBr: 135_000_000 },
  { name: '5.1', hex: '33', maxFs: 36864, maxMbps: 983040, maxBr: 240_000_000 },
  { name: '5.2', hex: '34', maxFs: 36864, maxMbps: 2073600, maxBr: 240_000_000 },
  { name: '6.0', hex: '3c', maxFs: 139264, maxMbps: 4177920, maxBr: 240_000_000 },
  { name: '6.1', hex: '3d', maxFs: 139264, maxMbps: 8355840, maxBr: 480_000_000 },
  { name: '6.2', hex: '3e', maxFs: 139264, maxMbps: 16711680, maxBr: 800_000_000 },
];

export function h264Level(width: number, height: number, fps: number, bitrate: number): H264Level {
  const fs = Math.ceil(width / 16) * Math.ceil(height / 16);
  const mbps = fs * fps;
  return H264_LEVELS.find((l) => l.maxFs >= fs && l.maxMbps >= mbps && l.maxBr >= bitrate)
    ?? H264_LEVELS[H264_LEVELS.length - 1];
}

/** High profile (0x64) string, e.g. 1080p30 → avc1.640028. */
export function avcCodecString(width: number, height: number, fps: number, bitrate: number): string {
  return `avc1.6400${h264Level(width, height, fps, bitrate).hex}`;
}

/** VP9 level table: max luma sample rate per level (VP9 Bitstream Spec, Annex A). */
const VP9_LEVELS: readonly { hex: string; maxLumaRate: number }[] = [
  { hex: '10', maxLumaRate: 829_440 },
  { hex: '11', maxLumaRate: 2_764_800 },
  { hex: '20', maxLumaRate: 4_608_000 },
  { hex: '21', maxLumaRate: 9_216_000 },
  { hex: '30', maxLumaRate: 20_736_000 },
  { hex: '31', maxLumaRate: 36_864_000 },
  { hex: '40', maxLumaRate: 83_886_080 },
  { hex: '41', maxLumaRate: 160_432_128 },
  { hex: '50', maxLumaRate: 311_951_360 },
  { hex: '51', maxLumaRate: 622_592_000 },
  { hex: '52', maxLumaRate: 1_245_184_000 },
  { hex: '60', maxLumaRate: 2_359_296_000 },
  { hex: '61', maxLumaRate: 4_718_592_000 },
  { hex: '62', maxLumaRate: 9_437_184_000 },
];

export function vp9CodecString(width: number, height: number, fps: number): string {
  const lumaRate = width * height * fps;
  const level = VP9_LEVELS.find((l) => l.maxLumaRate >= lumaRate) ?? VP9_LEVELS[VP9_LEVELS.length - 1];
  return `vp09.00.${level.hex}.08`;
}

export function codecStringFor(codec: VideoCodec, width: number, height: number, fps: number, bitrate: number): string {
  return codec === 'avc' ? avcCodecString(width, height, fps, bitrate) : vp9CodecString(width, height, fps);
}

export function defaultBitrate(width: number, height: number, fps: number, codec: VideoCodec): number {
  const bpp = codec === 'avc' ? 0.1 : 0.07;
  return Math.max(1_000_000, Math.min(40_000_000, Math.round(width * height * fps * bpp)));
}

/** Even-aligned output size; 1080p/720p fit the long edge, never upscale. */
export function fitResolution(mode: VideoResolution, width: number, height: number): { width: number; height: number } {
  const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);
  if (mode === 'source') return { width: even(width), height: even(height) };
  const target = mode === '1080p' ? 1920 : 1280;
  const scale = Math.min(1, target / Math.max(width, height));
  return { width: even(width * scale), height: even(height * scale) };
}

export function containerForCodec(codec: VideoCodec): VideoContainer {
  return codec === 'avc' ? 'mp4' : 'webm';
}
