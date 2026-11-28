// Provisional copies of the CP4-01a contract shapes (WO-P1-CP4 §2.3).
// Switch to `import type {...} from '../contracts/video'` once Q01 lands it.
export type VideoContainer = 'mp4' | 'webm';
export type VideoCodec = 'avc' | 'vp9';
export type VideoAudioMode = 'passthrough' | 'aac' | 'none';
export type VideoResolution = 'source' | '1080p' | '720p';

export interface VideoTrim {
  startSec: number;
  endSec: number;
}

export interface VideoAssetMeta {
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  rotationDeg: number;
  videoCodec: string;
  audioCodec: string | null;
  canDecode: boolean;
}

export interface VideoExportSettings {
  container: VideoContainer;
  videoCodec: VideoCodec;
  audioMode: VideoAudioMode;
  resolution: VideoResolution;
  bitrateMbps: number;
  fps: number;
  trim: VideoTrim;
}

export interface VideoCapabilities {
  canDecode: boolean;
  encoders: { avc: boolean; vp9: boolean };
  containers: { mp4: boolean; webm: boolean };
  audioPassthrough: boolean;
}

export interface VideoExportProgress {
  phase: 'decode' | 'render' | 'encode' | 'mux';
  framesDone: number;
  framesTotal: number;
}

/**
 * Preview/export grading adapter. CP4-01b's createVideoFrameRenderer satisfies this
 * shape; `canvas` is the surface CanvasSource captures after each renderFrame call.
 */
export interface VideoFrameRenderer {
  readonly canvas: HTMLCanvasElement;
  renderFrame(frame: CanvasImageSource): Promise<void> | void;
  resize(width: number, height: number): void;
  dispose(): void;
}

export interface VideoAudioReport {
  mode: VideoAudioMode;
  packets: number;
  sourceHash?: string;
  outputHash?: string;
  warning?: string;
}

export interface VideoExportResult {
  blob: Blob;
  container: VideoContainer;
  mimeType: string;
  bytes: number;
  frames: number;
  width: number;
  height: number;
  durationSec: number;
  audio: VideoAudioReport;
}

export interface VideoExportOptions {
  settings: VideoExportSettings;
  /** Defaults to the plain 2D-canvas adapter; Q01's frame renderer may be injected. */
  renderer?: VideoFrameRenderer;
  signal?: AbortSignal;
  budgetMB?: number;
  /** Optional external streaming sink (e.g. File System Access writable). */
  target?: WritableStream<{ data: Uint8Array; position: number }>;
}

export interface VideoExportHandle {
  promise: Promise<VideoExportResult>;
  cancel(): void;
  onProgress(cb: (progress: VideoExportProgress) => void): () => void;
}
