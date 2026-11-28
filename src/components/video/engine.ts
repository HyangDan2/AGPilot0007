import type { VideoCapabilities, VideoExportProgress, VideoExportSettings, VideoTrim } from '../../engine/contracts/video';
import type { AdjustmentSettings, FilmId } from '../../types/film';
import type { ToneCurves } from '../../types/curves';
import type { ColorMixerSettings } from '../../types/colorMixer';
import type { SharpeningSettings } from '../../types/sharpening';
import type { CameraSettings } from '../../types/camera';
import type { GeometryTransform } from '../../engine/contracts/geometry';
import type { OpticalTransform } from '../../engine/contracts/optical';
import type { LocalAdjustmentState } from '../../engine/contracts/localAdjustments';

/**
 * UI-facing video engine surface. Types come from Q01's frozen
 * `engine/contracts/video.ts`; Q03 owns the implementation (`engine/video/**`)
 * and this module only holds the binding so the workspace can be built and
 * tested before that engine lands. Until a binding registers, export stays
 * disabled with an explicit note — there is no local fallback.
 */
export type { VideoCapabilities, VideoExportProgress, VideoExportSettings, VideoTrim };
export type VideoContainer = VideoExportSettings['container'];
export type VideoCodec = VideoExportSettings['videoCodec'];
export type VideoAudioMode = VideoExportSettings['audioMode'];
export type VideoResolution = VideoExportSettings['resolution'];

/**
 * The contract handle resolves `void`; the workspace needs the finished file to
 * save it. Q03's binding must resolve the produced blob and filename here.
 */
export interface VideoExportHandle {
  promise: Promise<{ blob: Blob; filename: string }>;
  cancel(): void;
  onProgress(callback: (progress: VideoExportProgress) => void): () => void;
}

/** Grade payload for frame rendering; mirrors the shared RenderSettings groups. */
export interface VideoGradeSettings {
  filmId: FilmId;
  adjustments: AdjustmentSettings;
  curves: ToneCurves;
  camera: CameraSettings;
  colorMixer: ColorMixerSettings;
  sharpening: SharpeningSettings;
  geometry: GeometryTransform;
  optical?: OpticalTransform;
  localAdjustments: LocalAdjustmentState;
}

export interface VideoEngine {
  probe(): Promise<VideoCapabilities>;
  /** A promise lets a lazily loaded engine start without blocking the shell bundle. */
  exportVideo(request: { file: File; settings: VideoExportSettings; grade: VideoGradeSettings }): VideoExportHandle | Promise<VideoExportHandle>;
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
