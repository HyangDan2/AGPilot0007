/**
 * UI-facing video engine surface. Q03 owns the implementation
 * (`src/engine/video/**`); this module only holds the binding so the workspace
 * can be built and tested before that engine lands. Until a binding registers,
 * export stays disabled with an explicit note — there is no local fallback.
 */
export type VideoContainer = 'mp4' | 'webm';
export type VideoCodec = 'avc' | 'vp9';
export type VideoAudioMode = 'passthrough' | 'aac' | 'none';
export type VideoResolution = 'source' | '1080p' | '720p';

export interface VideoTrim {
  startSec: number;
  endSec: number;
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

export interface VideoExportHandle {
  promise: Promise<{ blob: Blob; filename: string }>;
  cancel(): void;
  onProgress(callback: (progress: VideoExportProgress) => void): () => void;
}

/** Grade payload for frame rendering; shape follows the shared RenderSettings groups. */
export interface VideoGradeSettings {
  filmId: string;
  adjustments: unknown;
  curves: unknown;
  camera: unknown;
  colorMixer: unknown;
  sharpening: unknown;
  geometry: unknown;
  optical?: unknown;
  localAdjustments: unknown;
}

export interface VideoEngine {
  probe(): Promise<VideoCapabilities>;
  exportVideo(request: { file: File; settings: VideoExportSettings; grade: VideoGradeSettings }): VideoExportHandle;
  /** Single graded frame at the playhead; the documented CP4 preview limitation. */
  renderFrame?(request: { file: File; timeSec: number; grade: VideoGradeSettings }): Promise<ImageBitmap | HTMLCanvasElement | null>;
}

let engine: VideoEngine | null = null;

export function registerVideoEngine(next: VideoEngine | null): void {
  engine = next;
}

export function getVideoEngine(): VideoEngine | null {
  return engine;
}
