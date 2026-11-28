/**
 * Video editor contracts (CP4). Types only: the engine, decode/encode/mux and
 * controller live under Q03's `src/engine/video/**`; the UI lives under Q04's
 * `src/components/video/**`.
 */
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

export interface VideoTrim {
  startSec: number;
  endSec: number;
}

export interface VideoExportSettings {
  container: 'mp4' | 'webm';
  videoCodec: 'avc' | 'vp9';
  audioMode: 'passthrough' | 'aac' | 'none';
  resolution: 'source' | '1080p' | '720p';
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
 * Completed video export (seam ruling 2026-11-28, WO §7): the promise must
 * carry the finished file so the UI can save it. Q03's richer task result
 * satisfies this shape structurally; extra fields stay Q03-owned.
 */
export interface VideoExportResult {
  blob: Blob;
  mimeType: string;
  bytes: number;
  width: number;
  height: number;
  durationSec: number;
}

/** Cancel rejects the promise with an `AbortError`, matching exportControl. */
export interface VideoExportHandle {
  promise: Promise<VideoExportResult>;
  cancel(): void;
  onProgress(callback: (progress: VideoExportProgress) => void): () => void;
}
