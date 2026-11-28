import { getEncodableVideoCodecs } from 'mediabunny';
import { VideoCapabilityError } from './errors';
import { avcCodecString, defaultBitrate, vp9CodecString } from './profiles';
import type { VideoCapabilities, VideoCodec, VideoContainer } from './types';

const PROBE_WIDTH = 1920;
const PROBE_HEIGHT = 1080;
const PROBE_FPS = 30;

async function supportsEncode(codec: string, width: number, height: number, bitrate: number, fps: number): Promise<boolean> {
  if (typeof VideoEncoder === 'undefined') return false;
  try {
    const result = await VideoEncoder.isConfigSupported({ codec, width, height, bitrate, framerate: fps });
    return result.supported === true;
  } catch {
    return false;
  }
}

/** Engine availability for the real UI: encoders, containers and passthrough muxing. */
export async function probeVideoCapabilities(): Promise<VideoCapabilities> {
  const hasEncoder = typeof VideoEncoder !== 'undefined';
  const canDecode = typeof VideoDecoder !== 'undefined';
  let encodable: string[] = [];
  if (hasEncoder) {
    try {
      encodable = await getEncodableVideoCodecs();
    } catch {
      encodable = [];
    }
  }
  const avc = hasEncoder
    && encodable.includes('avc')
    && await supportsEncode(avcCodecString(PROBE_WIDTH, PROBE_HEIGHT, PROBE_FPS, 8_000_000), PROBE_WIDTH, PROBE_HEIGHT, 8_000_000, PROBE_FPS);
  const vp9 = hasEncoder
    && encodable.includes('vp9')
    && await supportsEncode(vp9CodecString(PROBE_WIDTH, PROBE_HEIGHT, PROBE_FPS), PROBE_WIDTH, PROBE_HEIGHT, 3_000_000, PROBE_FPS);
  return {
    canDecode,
    encoders: { avc, vp9 },
    containers: { mp4: avc, webm: vp9 },
    // Passthrough copies packets through the muxer; it needs a working encoder
    // path for the video track but no audio codec support.
    audioPassthrough: hasEncoder,
  };
}

export function assertContainerCodecPair(container: VideoContainer, codec: VideoCodec): void {
  if (container === 'mp4' && codec !== 'avc') {
    throw new VideoCapabilityError('unsupported-container', 'MP4 export requires the AVC encoder');
  }
  if (container === 'webm' && codec !== 'vp9') {
    throw new VideoCapabilityError('unsupported-container', 'WebM export requires the VP9 encoder');
  }
}

/** Validates the concrete encoder config for this export and returns the codec string. */
export async function selectEncoder(
  container: VideoContainer,
  codec: VideoCodec,
  width: number,
  height: number,
  fps: number,
  bitrateMbps: number,
): Promise<{ codecString: string; bitrate: number }> {
  assertContainerCodecPair(container, codec);
  const bitrate = Math.max(1_000_000, Math.round(bitrateMbps * 1_000_000)) || defaultBitrate(width, height, fps, codec);
  const codecString = codec === 'avc'
    ? avcCodecString(width, height, fps, bitrate)
    : vp9CodecString(width, height, fps);
  if (!(await supportsEncode(codecString, width, height, bitrate, fps))) {
    throw new VideoCapabilityError('unsupported-codec', `${codecString} encoding is not supported at ${width}x${height}@${fps}`);
  }
  return { codecString, bitrate };
}
