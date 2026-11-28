import type { VideoAudioMode, VideoContainer } from './types';

export interface AudioPlanInput {
  container: VideoContainer;
  requested: VideoAudioMode;
  sourceCodec: string | null;
  hasAudioEncoder: boolean;
  hasAudioDecoder: boolean;
}

export interface AudioPlan {
  mode: VideoAudioMode;
  warning?: string;
}

const CONTAINER_AUDIO: Record<VideoContainer, readonly string[]> = {
  mp4: ['aac', 'mp3'],
  webm: ['opus', 'vorbis'],
};

/** Normalizes mediabunny/WebCodecs codec spellings (mp4a.40.2 → aac). */
export function audioFamily(codec: string | null): string | null {
  if (!codec) return null;
  const lower = codec.toLowerCase();
  if (lower.startsWith('mp4a') || lower === 'aac') return 'aac';
  if (lower.startsWith('mp3')) return 'mp3';
  if (lower.startsWith('opus')) return 'opus';
  if (lower.startsWith('vorbis')) return 'vorbis';
  return lower;
}

/**
 * Passthrough copies encoded packets, so it needs only a muxer-compatible
 * codec. 'aac' re-encodes and therefore needs both AudioDecoder and
 * AudioEncoder; otherwise the export degrades to 'none' with a warning.
 */
export function planAudio(input: AudioPlanInput): AudioPlan {
  if (!input.sourceCodec) return { mode: 'none' };
  if (input.requested === 'none') return { mode: 'none' };
  const family = audioFamily(input.sourceCodec);
  const muxable = family !== null && CONTAINER_AUDIO[input.container].includes(family);

  if (input.requested === 'passthrough') {
    if (muxable) return { mode: 'passthrough' };
    // AAC is only a valid fallback inside MP4; under WebM the stream is dropped.
    if (input.container === 'mp4' && input.hasAudioDecoder && input.hasAudioEncoder) {
      return { mode: 'aac', warning: `${input.sourceCodec} is not muxable into ${input.container}; re-encoding to AAC` };
    }
    return { mode: 'none', warning: `${input.sourceCodec} cannot be muxed into ${input.container}; audio removed` };
  }

  if (input.container !== 'mp4') {
    return { mode: 'none', warning: `AAC audio is not supported in ${input.container}; audio removed` };
  }
  if (!input.hasAudioEncoder || !input.hasAudioDecoder) {
    return { mode: 'none', warning: 'AAC encoding is unavailable in this browser; audio removed' };
  }
  return { mode: 'aac' };
}
