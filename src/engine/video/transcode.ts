import {
  ALL_FORMATS,
  AudioSampleSink,
  AudioSampleSource,
  BlobSource,
  CanvasSource,
  EncodedAudioPacketSource,
  EncodedPacketSink,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  StreamTarget,
  VideoSampleSink,
  WebMOutputFormat,
  type AudioCodec,
} from 'mediabunny';
import { openVideo } from './asset';
import { planAudio } from './audio';
import { assertVideoBudget, estimateVideoExportBytes, videoMemoryBudgetMB } from './budget';
import { selectEncoder } from './capabilities';
import { abortError, VideoCapabilityError } from './errors';
import { createCanvasFrameRenderer, type CanvasFrameRenderer } from './frameRenderer';
import { fitResolution } from './profiles';
import { resolveTrim } from './trim';
import { createVideoFrameRenderer } from '../renderer/frameRenderer';
import { DEFAULT_ADJUSTMENTS } from '../../types/film';
import type { RenderSettings } from '../pipeline/renderSettings';
import type {
  VideoAudioReport,
  VideoExportOptions,
  VideoExportProgress,
  VideoExportResult,
  VideoExportTask,
  VideoFrameRenderer,
  VideoRendererPath,
} from './types';

const AUDIO_HASH_LIMIT_BYTES = 8 * 1024 * 1024;
const AAC_BITRATE = 128_000;
const DEFAULT_GRADING: RenderSettings = { adjustments: DEFAULT_ADJUSTMENTS };

async function sha256Hex(parts: Uint8Array[]): Promise<string> {
  const total = parts.reduce((n, p) => n + p.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    merged.set(part, offset);
    offset += part.byteLength;
  }
  const digest = await crypto.subtle.digest('SHA-256', merged);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

interface ChunkSink {
  write(chunk: { data: Uint8Array; position: number }): Promise<void>;
  bytesWritten: number;
  chunks: number;
}

function collectSink(): ChunkSink & { build(): Uint8Array } {
  const chunks: { data: Uint8Array; position: number }[] = [];
  let bytes = 0;
  return {
    get bytesWritten() {
      return bytes;
    },
    chunks: 0,
    async write(chunk) {
      chunks.push({ data: chunk.data.slice(), position: chunk.position });
      bytes += chunk.data.byteLength;
      this.chunks++;
    },
    build() {
      const end = chunks.reduce((max, c) => Math.max(max, c.position + c.data.byteLength), 0);
      const out = new Uint8Array(end);
      for (const c of chunks) out.set(c.data, c.position);
      return out;
    },
  };
}

function externalSink(target: WritableStream<{ data: Uint8Array; position: number }>): ChunkSink & { close(): Promise<void> } {
  const writer = target.getWriter();
  let bytes = 0;
  return {
    get bytesWritten() {
      return bytes;
    },
    chunks: 0,
    async write(chunk) {
      await writer.write({ data: chunk.data, position: chunk.position });
      bytes += chunk.data.byteLength;
      this.chunks++;
    },
    async close() {
      await writer.close();
    },
  };
}

async function runExport(
  file: Blob,
  options: VideoExportOptions,
  signal: AbortSignal,
  emit: (progress: VideoExportProgress) => void,
): Promise<VideoExportResult> {
  const checkAbort = () => {
    if (signal.aborted) throw abortError();
  };
  const opened = await openVideo(file);
  const { input, videoTrack, audioTrack, meta } = opened;
  let output: Output | null = null;
  let videoSource: CanvasSource | null = null;
  let audioSource: EncodedAudioPacketSource | AudioSampleSource | null = null;
  let ownedRenderer: VideoFrameRenderer | null = null;
  let orientationCanvas: HTMLCanvasElement | null = null;
  const external = options.target ? externalSink(options.target) : null;
  try {
    checkAbort();
    if (!meta.canDecode) {
      throw new VideoCapabilityError('decode-unavailable', `This browser cannot decode ${meta.videoCodec}`);
    }
    const { settings } = options;
    const out = fitResolution(settings.resolution, meta.width, meta.height);
    const encoder = await selectEncoder(settings.container, settings.videoCodec, out.width, out.height, settings.fps, settings.bitrateMbps);
    const trim = resolveTrim(settings.trim, meta.durationSec, settings.fps);
    const audioPlan = planAudio({
      container: settings.container,
      requested: settings.audioMode,
      sourceCodec: meta.audioCodec,
      hasAudioEncoder: typeof AudioEncoder !== 'undefined',
      hasAudioDecoder: typeof AudioDecoder !== 'undefined',
    });

    const budget = videoMemoryBudgetMB(options.budgetMB);
    const estimate = estimateVideoExportBytes({
      bitrate: encoder.bitrate,
      durationSec: trim.endSec - trim.startSec,
      audioBitrate: audioPlan.mode === 'none' ? 0 : AAC_BITRATE,
      frameWidth: out.width,
      frameHeight: out.height,
    });
    assertVideoBudget(estimate.total, budget.budgetMB);

    const sink: ChunkSink = external ?? collectSink();
    const target = new StreamTarget(
      new WritableStream({ write: (chunk) => sink.write(chunk) }),
      { chunked: true, chunkSize: 1 << 20 },
    );
    output = new Output({ format: settings.container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat(), target });
    let render: VideoFrameRenderer;
    let rendererPath: VideoRendererPath;
    let gradingWarning: string | undefined;
    let gradedCanvas: HTMLCanvasElement | null = null;
    if (options.renderer) {
      render = options.renderer;
      rendererPath = 'injected';
    } else {
      const canvasTarget = options.canvas ?? document.createElement('canvas');
      try {
        render = createVideoFrameRenderer(canvasTarget, options.grading ?? DEFAULT_GRADING);
        gradedCanvas = canvasTarget;
        rendererPath = 'graded';
      } catch (error) {
        const adapter: CanvasFrameRenderer = createCanvasFrameRenderer(out.width, out.height);
        render = adapter;
        rendererPath = 'fallback';
        gradingWarning = `Graded frame renderer unavailable (${error instanceof Error ? error.message : String(error)}); exported frames are ungraded.`;
      }
      ownedRenderer = render;
    }
    const canvas = gradedCanvas ?? options.canvas ?? render.canvas;
    if (!canvas) throw new Error('Video frame renderer must expose a canvas (or pass VideoExportOptions.canvas)');
    render.resize(out.width, out.height);
    videoSource = new CanvasSource(canvas, {
      codec: settings.videoCodec,
      quality: new Quality('high'),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(videoSource, { frameRate: settings.fps });

    if (audioPlan.mode === 'passthrough') {
      audioSource = new EncodedAudioPacketSource((audioTrack!.codec) as AudioCodec);
      output.addAudioTrack(audioSource);
    } else if (audioPlan.mode === 'aac') {
      audioSource = new AudioSampleSource({ codec: 'aac', bitrate: AAC_BITRATE });
      output.addAudioTrack(audioSource);
    }
    await output.start();
    checkAbort();

    const audioReport: VideoAudioReport = { mode: audioPlan.mode, packets: 0 };
    if (audioPlan.warning) audioReport.warning = audioPlan.warning;
    if (audioTrack && audioSource && audioPlan.mode === 'passthrough') {
      const audioSink = new EncodedPacketSink(audioTrack);
      const decoderConfig = await audioTrack.getDecoderConfig();
      const hashParts: Uint8Array[] = [];
      let hashBytes = 0;
      for await (const packet of audioSink.packets()) {
        if (packet.timestamp < trim.startSec) continue;
        if (packet.timestamp >= trim.endSec) break;
        checkAbort();
        const shifted = packet.clone({ timestamp: Math.max(0, packet.timestamp - trim.startSec) });
        await (audioSource as EncodedAudioPacketSource).add(shifted, audioReport.packets === 0 && decoderConfig ? { decoderConfig: decoderConfig as any } : undefined);
        audioReport.packets++;
        if (hashBytes < AUDIO_HASH_LIMIT_BYTES) {
          hashParts.push(packet.data.slice());
          hashBytes += packet.data.byteLength;
        }
      }
      audioReport.sourceHash = await sha256Hex(hashParts);
    } else if (audioTrack && audioSource && audioPlan.mode === 'aac') {
      const audioSink = new AudioSampleSink(audioTrack);
      for await (const sample of audioSink.samples(trim.startSec, trim.endSec)) {
        try {
          checkAbort();
          sample.setTimestamp(Math.max(0, sample.timestamp - trim.startSec));
          await (audioSource as AudioSampleSource).add(sample);
          audioReport.packets++;
        } finally {
          sample.close();
        }
      }
    }

    const videoSink = new VideoSampleSink(videoTrack);
    let frames = 0;
    for await (const sample of videoSink.samples(trim.startSec, trim.endSec)) {
      try {
        checkAbort();
        let source: CanvasImageSource;
        if (sample.rotation !== 0 || sample.flip) {
          if (!orientationCanvas) {
            orientationCanvas = document.createElement('canvas');
            orientationCanvas.width = out.width;
            orientationCanvas.height = out.height;
          }
          const ctx = orientationCanvas.getContext('2d', { alpha: false })!;
          sample.draw(ctx, 0, 0, out.width, out.height);
          source = orientationCanvas;
        } else {
          source = sample.toCanvasImageSource();
        }
        await render.renderFrame(source);
        emit({ phase: 'render', framesDone: frames, framesTotal: trim.framesTotal });
        await videoSource.add(Math.max(0, sample.timestamp - trim.startSec), sample.duration);
        frames++;
        if (frames % 30 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
      } finally {
        sample.close();
      }
    }
    checkAbort();
    if (frames === 0) throw new VideoCapabilityError('decode-unavailable', 'No frames could be decoded from the selected range');
    emit({ phase: 'mux', framesDone: frames, framesTotal: trim.framesTotal });
    await output.finalize();
    const mimeType = await output.getMimeType();

    let blob: Blob;
    if (external) {
      blob = new Blob([], { type: mimeType });
    } else {
      const assembled = (sink as ReturnType<typeof collectSink>).build();
      blob = new Blob([assembled.buffer as ArrayBuffer], { type: mimeType });
    }
    if (!external && audioPlan.mode === 'passthrough') {
      audioReport.outputHash = await hashOutputAudio(blob);
    }
    return {
      blob,
      container: settings.container,
      mimeType,
      bytes: external ? sink.bytesWritten : blob.size,
      frames,
      width: out.width,
      height: out.height,
      durationSec: Number((frames / settings.fps).toFixed(3)),
      audio: audioReport,
      rendererPath,
      ...(gradingWarning ? { gradingWarning } : {}),
    };
  } catch (error) {
    try {
      if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel();
    } catch {
      // cancel() failures must not mask the original error
    }
    throw signal.aborted ? abortError() : error;
  } finally {
    try {
      videoSource?.close();
    } catch {
      // source already closed by a failed finalize
    }
    try {
      audioSource?.close();
    } catch {
      // source already closed by a failed finalize
    }
    if (ownedRenderer) ownedRenderer.dispose();
    if (orientationCanvas) {
      orientationCanvas.width = 0;
      orientationCanvas.height = 0;
    }
    if (external) await external.close().catch(() => undefined);
    input.dispose();
  }
}

async function hashOutputAudio(blob: Blob): Promise<string | undefined> {
  const input = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  try {
    const audioTrack = await input.getPrimaryAudioTrack();
    if (!audioTrack) return undefined;
    const parts: Uint8Array[] = [];
    let bytes = 0;
    for await (const packet of new EncodedPacketSink(audioTrack).packets()) {
      if (bytes >= AUDIO_HASH_LIMIT_BYTES) break;
      parts.push(packet.data.slice());
      bytes += packet.data.byteLength;
    }
    return await sha256Hex(parts);
  } catch {
    return undefined;
  } finally {
    input.dispose();
  }
}

/**
 * Starts a cancellable export. Resolution/trim/audio decisions happen inside the
 * promise; capability and budget failures reject before any output bytes are written.
 */
export function startVideoExport(file: Blob, options: VideoExportOptions): VideoExportTask {
  const listeners = new Set<(progress: VideoExportProgress) => void>();
  const controller = new AbortController();
  const forwardAbort = () => controller.abort();
  if (options.signal) {
    if (options.signal.aborted) controller.abort();
    else options.signal.addEventListener('abort', forwardAbort, { once: true });
  }
  const emit = (progress: VideoExportProgress) => {
    for (const listener of listeners) {
      try {
        listener(progress);
      } catch {
        // a throwing progress listener must not break the export
      }
    }
  };
  const promise = runExport(file, options, controller.signal, emit)
    .finally(() => options.signal?.removeEventListener('abort', forwardAbort));
  return {
    promise,
    cancel: () => controller.abort(),
    onProgress(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
  };
}
