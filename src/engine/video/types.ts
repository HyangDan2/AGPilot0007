import type {
  VideoAssetMeta,
  VideoCapabilities,
  VideoExportHandle,
  VideoExportProgress,
  VideoExportSettings,
  VideoTrim,
} from '../contracts/video';

export type { VideoAssetMeta, VideoCapabilities, VideoExportHandle, VideoExportProgress, VideoExportSettings, VideoTrim };

export type VideoContainer = VideoExportSettings['container'];
export type VideoCodec = VideoExportSettings['videoCodec'];
export type VideoAudioMode = VideoExportSettings['audioMode'];
export type VideoResolution = VideoExportSettings['resolution'];

/**
 * Engine-side grading adapter. Structurally satisfied by CP4-01b's
 * createVideoFrameRenderer; `canvas` (or VideoExportOptions.canvas) is the
 * surface CanvasSource captures after each renderFrame call.
 */
export interface VideoFrameRenderer {
  readonly canvas?: HTMLCanvasElement;
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
  /** Canvas backing an injected renderer (required when renderer.canvas is absent). */
  canvas?: HTMLCanvasElement;
  signal?: AbortSignal;
  budgetMB?: number;
  /** Optional external streaming sink (e.g. File System Access writable). */
  target?: WritableStream<{ data: Uint8Array; position: number }>;
}

/** Contract handle plus the concrete export result (assignable to VideoExportHandle). */
export interface VideoExportTask {
  promise: Promise<VideoExportResult>;
  cancel(): void;
  onProgress(callback: (progress: VideoExportProgress) => void): () => void;
}
