import { ALL_FORMATS, BlobSource, Input, type InputAudioTrack, type InputVideoTrack } from 'mediabunny';
import { VideoCapabilityError } from './errors';
import type { VideoAssetMeta } from './types';

export interface OpenedVideo {
  input: Input;
  videoTrack: InputVideoTrack;
  audioTrack: InputAudioTrack | null;
  meta: VideoAssetMeta;
}

/** Opens a local file through mediabunny and reports the fields the UI/engine needs. */
export async function openVideo(file: Blob): Promise<OpenedVideo> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const videoTrack = await input.getPrimaryVideoTrack();
  if (!videoTrack) {
    input.dispose();
    throw new VideoCapabilityError('no-video-track', 'The selected file has no decodable video track');
  }
  const audioTrack = await input.getPrimaryAudioTrack();
  const [rotation, stats, decodable] = await Promise.all([
    videoTrack.getRotation(),
    videoTrack.computePacketStats(60),
    videoTrack.canDecode(),
  ]);
  const meta: VideoAssetMeta = {
    durationSec: await input.computeDuration(),
    width: videoTrack.displayWidth,
    height: videoTrack.displayHeight,
    fps: Math.round(stats.averagePacketRate) || 30,
    rotationDeg: rotation,
    videoCodec: videoTrack.codec ?? 'unknown',
    audioCodec: audioTrack ? audioTrack.codec : null,
    canDecode: decodable,
  };
  return { input, videoTrack, audioTrack, meta };
}

export async function inspectVideo(file: Blob): Promise<VideoAssetMeta> {
  const opened = await openVideo(file);
  try {
    return opened.meta;
  } finally {
    opened.input.dispose();
  }
}
