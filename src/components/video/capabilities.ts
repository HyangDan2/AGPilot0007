import type { VideoCapabilities } from './engine';

export interface SupportProbe {
  decodeAvc: boolean;
  decodeVp9: boolean;
  encodeAvc: boolean;
  encodeVp9: boolean;
  playMp4: boolean;
  playWebm: boolean;
  audioPassthrough: boolean;
}

const AVC_CODEC = 'avc1.42001f';
const VP9_CODEC = 'vp09.00.10.08';
const AAC_CODEC = 'mp4a.40.2';

/** Pure mapping so the badge rules stay unit-testable without WebCodecs. */
export function classifySupport(probe: SupportProbe): VideoCapabilities {
  return {
    canDecode: probe.decodeAvc || probe.decodeVp9,
    encoders: { avc: probe.encodeAvc && probe.playMp4, vp9: probe.encodeVp9 && probe.playWebm },
    containers: { mp4: probe.playMp4, webm: probe.playWebm },
    audioPassthrough: probe.audioPassthrough,
  };
}

const VIDEO_CONFIG = { codedWidth: 1280, codedHeight: 720, bitrate: 4_000_000, framerate: 30 };

async function configSupported(kind: 'decode' | 'encode', codec: string): Promise<boolean> {
  const decoder = (globalThis as { VideoDecoder?: { isConfigSupported(config: object): Promise<{ supported?: boolean }> } }).VideoDecoder;
  const encoder = (globalThis as { VideoEncoder?: { isConfigSupported(config: object): Promise<{ supported?: boolean }> } }).VideoEncoder;
  const api = kind === 'decode' ? decoder : encoder;
  if (!api) return false;
  try {
    const result = await api.isConfigSupported({ codec, ...VIDEO_CONFIG });
    return result.supported === true;
  } catch {
    return false;
  }
}

async function canPlay(type: string): Promise<boolean> {
  if (typeof document === 'undefined') return false;
  const video = document.createElement('video');
  return video.canPlayType(type) !== '';
}

async function audioDecodable(): Promise<boolean> {
  const audio = (globalThis as { AudioDecoder?: { isConfigSupported(config: object): Promise<{ supported?: boolean }> } }).AudioDecoder;
  if (audio) {
    try {
      const result = await audio.isConfigSupported({ codec: AAC_CODEC, sampleRate: 48_000, numberOfChannels: 2, bitrate: 192_000 });
      if (result.supported) return true;
    } catch {
      // Fall through to the container probe.
    }
  }
  return canPlay('audio/mp4; codecs="mp4a.40.2"');
}

export async function probeVideoCapabilities(): Promise<VideoCapabilities> {
  const [decodeAvc, decodeVp9, encodeAvc, encodeVp9, playMp4, playWebm, audioPassthrough] = await Promise.all([
    configSupported('decode', AVC_CODEC),
    configSupported('decode', VP9_CODEC),
    configSupported('encode', AVC_CODEC),
    configSupported('encode', VP9_CODEC),
    canPlay('video/mp4; codecs="avc1.42E01E"'),
    canPlay('video/webm; codecs="vp9"'),
    audioDecodable(),
  ]);
  return classifySupport({ decodeAvc, decodeVp9, encodeAvc, encodeVp9, playMp4, playWebm, audioPassthrough });
}

export interface MemoryGuard {
  width: number;
  height: number;
  bytes: number;
  budgetBytes: number;
  ok: boolean;
}

/**
 * Conservative pre-flight: decoded frame plus render targets and an encoder
 * queue. deviceMemory is coarse (GB) and absent on Safari, so a 512 MB floor
 * keeps the guard honest without blocking capable desktops.
 */
export function memoryGuard(width: number, height: number, deviceMemoryMB: number): MemoryGuard {
  const bytes = Math.max(1, width) * Math.max(1, height) * 4 * 4;
  const budgetBytes = Math.max(512 * 1024 * 1024, deviceMemoryMB * 1024 * 1024 * 0.2);
  return { width, height, bytes, budgetBytes, ok: bytes <= budgetBytes };
}

export function resolutionPixels(
  resolution: 'source' | '1080p' | '720p',
  sourceWidth: number,
  sourceHeight: number,
): { width: number; height: number } {
  const base = { width: Math.max(1, sourceWidth), height: Math.max(1, sourceHeight) };
  if (resolution === 'source') return base;
  const targetHeight = resolution === '1080p' ? 1080 : 720;
  if (base.height <= targetHeight) return base;
  const scale = targetHeight / base.height;
  return { width: Math.round(base.width * scale), height: targetHeight };
}

export function isMobileProfile(): boolean {
  if (typeof window === 'undefined') return false;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const memory = (navigator as { deviceMemory?: number }).deviceMemory;
  return coarse || (typeof memory === 'number' && memory <= 4);
}
