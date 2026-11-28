import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useEditorStore } from '../../stores/editorStore';
import { triggerSafeDownload } from '../../engine/export/imageExporter';
import { getVideoEngine, type VideoAudioMode, type VideoCapabilities, type VideoContainer, type VideoCodec, type VideoExportHandle, type VideoExportProgress, type VideoExportSettings, type VideoResolution } from './engine';
import { bindQ03VideoEngine } from './q03Engine';
import { isMobileProfile, memoryGuard, probeVideoCapabilities, resolutionPixels } from './capabilities';
import { clampTrim, formatTime, frameStep, loopTime, trimFraction } from './timeline';

bindQ03VideoEngine();

type Phase = VideoExportProgress['phase'];
const PHASES: Phase[] = ['decode', 'render', 'encode', 'mux'];
const CODE_FOR_CONTAINER: Record<VideoContainer, VideoCodec> = { mp4: 'avc', webm: 'vp9' };

function classifyError(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') return 'Export cancelled.';
  const name = (error as { name?: string })?.name ?? '';
  const message = error instanceof Error ? error.message : String(error);
  if (name === 'MemoryBudgetError' || /memory|budget/i.test(message)) return `Not enough memory for this export. Lower the resolution or trim the clip. (${message})`;
  if (name === 'NotSupportedError' || /unsupported|codec/i.test(message)) return `This codec or container is not supported on this device. (${message})`;
  return `Export failed: ${message}`;
}

function CapabilityBadge({ label, supported }: { label: string; supported: boolean }) {
  return (
    <span
      data-testid="video-capability"
      data-capability={label}
      data-supported={supported ? 'true' : 'false'}
      className={`rounded-full border px-2 py-0.5 text-[10px] ${supported ? 'border-emerald-400/60 text-emerald-300' : 'border-red-400/50 text-red-300'}`}
    >
      {label.toUpperCase()} {supported ? 'ready' : 'unsupported'}
    </span>
  );
}

/**
 * CP4-04 video workspace: native <video> playback over a local object URL,
 * trim/frame-step UI, export settings gated by capability probes, and the
 * decode/render/encode/mux progress surface. Grading is one debounced frame at
 * the playhead; the full grade applies at export (documented CP4 limitation).
 */
export function VideoWorkspace() {
  const activeId = useWorkspaceStore((state) => state.activeVideoId);
  const entry = useWorkspaceStore((state) => state.entries.find((item) => item.id === state.activeVideoId));
  const closeVideo = useWorkspaceStore((state) => state.closeVideo);
  const setVideoMeta = useWorkspaceStore((state) => state.setVideoMeta);

  const videoRef = useRef<HTMLVideoElement>(null);
  const gradeCanvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<VideoExportHandle | null>(null);
  const cancelRequested = useRef(false);
  const touchedTrim = useRef(false);
  const fileRef = useRef<File | null>(null);

  const [url, setUrl] = useState<string | null>(null);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [trimIn, setTrimIn] = useState(0);
  const [trimOut, setTrimOut] = useState(0);
  const [fps, setFps] = useState(30);
  const [container, setContainer] = useState<VideoContainer>('mp4');
  const [codec, setCodec] = useState<VideoCodec>('avc');
  const [audioMode, setAudioMode] = useState<VideoAudioMode>('passthrough');
  const [resolution, setResolution] = useState<VideoResolution>('source');
  const [bitrateMbps, setBitrateMbps] = useState(8);
  const [capabilities, setCapabilities] = useState<VideoCapabilities | null>(null);
  const [progress, setProgress] = useState<VideoExportProgress | null>(null);
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gradeState, setGradeState] = useState<'idle' | 'rendered' | 'unavailable'>('idle');
  const mobile = useMemo(() => isMobileProfile(), []);

  const entryId = entry?.id;
  const getFile = entry?.getFile;
  useEffect(() => {
    if (!entryId || !getFile) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setUrl(null);
    setDuration(0);
    setCurrentTime(0);
    setPlaying(false);
    setTrimIn(0);
    setTrimOut(0);
    setProgress(null);
    setDone(false);
    setError(null);
    setGradeState('idle');
    touchedTrim.current = false;
    void getFile().then((file) => {
      if (cancelled) return;
      fileRef.current = file;
      objectUrl = URL.createObjectURL(file);
      setUrl(objectUrl);
    }).catch((loadError) => {
      if (!cancelled) setError(`Could not read the video file: ${String(loadError)}`);
    });
    return () => {
      cancelled = true;
      fileRef.current = null;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [entryId, getFile]);

  useEffect(() => {
    let cancelled = false;
    const engine = getVideoEngine();
    const probe = engine ? engine.probe() : probeVideoCapabilities();
    void probe.then((next) => {
      if (cancelled) return;
      setCapabilities(next);
      setContainer((current) => (next.containers[current] ? current : next.containers.mp4 ? 'mp4' : 'webm'));
    }).catch(() => {
      if (!cancelled) setCapabilities({ canDecode: false, encoders: { avc: false, vp9: false }, containers: { mp4: false, webm: false }, audioPassthrough: false });
    });
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  useEffect(() => () => {
    handleRef.current?.cancel();
    handleRef.current = null;
  }, []);

  useEffect(() => {
    setCodec(CODE_FOR_CONTAINER[container]);
  }, [container]);

  useEffect(() => {
    if (capabilities && audioMode === 'passthrough' && !capabilities.audioPassthrough) setAudioMode('none');
  }, [audioMode, capabilities]);

  const trim = clampTrim(trimIn, trimOut, duration, fps);

  const seekTo = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(time)) return;
    video.currentTime = Math.min(Math.max(0, time), Math.max(0, duration));
    setCurrentTime(video.currentTime);
  }, [duration]);

  const togglePlay = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      if (video.currentTime < trim.startSec || video.currentTime >= trim.endSec) video.currentTime = trim.startSec;
      void video.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    } else {
      video.pause();
      setPlaying(false);
    }
  }, [trim.endSec, trim.startSec]);

  const onTimeUpdate = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const looped = playing ? loopTime(video.currentTime, trim) : video.currentTime;
    if (looped !== video.currentTime) {
      video.currentTime = looped;
      return;
    }
    setCurrentTime(video.currentTime);
  }, [playing, trim]);

  const onLoadedMetadata = useCallback(() => {
    const video = videoRef.current;
    if (!video || !entry) return;
    const total = Number.isFinite(video.duration) ? video.duration : 0;
    setDuration(total);
    setVideoMeta(entry.id, { durationSec: total, width: video.videoWidth, height: video.videoHeight });
    if (!touchedTrim.current) {
      setTrimIn(0);
      setTrimOut(total);
    }
  }, [entry, setVideoMeta]);

  const adjustTrim = useCallback((which: 'in' | 'out', value: number) => {
    touchedTrim.current = true;
    const next = clampTrim(which === 'in' ? value : trimIn, which === 'out' ? value : trimOut, duration, fps);
    setTrimIn(next.startSec);
    setTrimOut(next.endSec);
  }, [duration, fps, trimIn, trimOut]);

  const stepTrim = useCallback((which: 'in' | 'out', direction: 1 | -1) => {
    adjustTrim(which, frameStep(which === 'in' ? trimIn : trimOut, fps, direction, duration));
  }, [adjustTrim, duration, fps, trimIn, trimOut]);

  const startExport = useCallback(async () => {
    const engine = getVideoEngine();
    const file = fileRef.current;
    if (!engine || !file || !entry) return;
    const out = resolutionPixels(resolution, entry.video?.width ?? 0, entry.video?.height ?? 0);
    const guard = memoryGuard(out.width, out.height, (navigator as { deviceMemory?: number }).deviceMemory ? (navigator as { deviceMemory?: number }).deviceMemory! * 1024 : 4096);
    if (!guard.ok) {
      setError(`Not enough memory for this export (${Math.round(guard.bytes / 1024 / 1024)} MB needed, ${Math.round(guard.budgetBytes / 1024 / 1024)} MB budget). Lower the resolution or trim the clip.`);
      setDone(false);
      return;
    }
    setError(null);
    setDone(false);
    setRunning(true);
    cancelRequested.current = false;
    setProgress({ phase: 'decode', framesDone: 0, framesTotal: 0 });
    const editor = useEditorStore.getState();
    const settings: VideoExportSettings = {
      container,
      videoCodec: codec,
      audioMode,
      resolution,
      bitrateMbps,
      fps,
      trim: { startSec: trim.startSec, endSec: trim.endSec },
    };
    try {
      const handle = await engine.exportVideo({
        file,
        settings,
        grade: {
          filmId: editor.activeFilmId,
          adjustments: editor.adjustments,
          curves: editor.curves,
          camera: editor.camera,
          colorMixer: editor.colorMixer,
          sharpening: editor.sharpening,
          geometry: editor.geometry,
          optical: editor.optical ?? undefined,
          localAdjustments: editor.localAdjustments,
        },
      });
      handleRef.current = handle;
      const unsubscribe = handle.onProgress(setProgress);
      if (cancelRequested.current) handle.cancel();
      handle.promise.then(({ blob, filename }) => {
        triggerSafeDownload(blob, filename);
        setDone(true);
      }).catch((exportError) => {
        setError(classifyError(exportError));
      }).finally(() => {
        unsubscribe();
        if (handleRef.current === handle) handleRef.current = null;
        setRunning(false);
      });
    } catch (exportError) {
      setError(classifyError(exportError));
      setRunning(false);
    }
  }, [audioMode, bitrateMbps, codec, container, entry, fps, resolution, trim.endSec, trim.startSec]);

  const cancelExport = useCallback(() => {
    cancelRequested.current = true;
    handleRef.current?.cancel();
  }, []);

  useEffect(() => {
    if (playing) return;
    const engine = getVideoEngine();
    const file = fileRef.current;
    if (!engine?.renderFrame || !file) {
      setGradeState('unavailable');
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      const editor = useEditorStore.getState();
      void engine.renderFrame!({
        file,
        timeSec: currentTime,
        grade: {
          filmId: editor.activeFilmId,
          adjustments: editor.adjustments,
          curves: editor.curves,
          camera: editor.camera,
          colorMixer: editor.colorMixer,
          sharpening: editor.sharpening,
          geometry: editor.geometry,
          optical: editor.optical ?? undefined,
          localAdjustments: editor.localAdjustments,
        },
      }).then((frame) => {
        if (cancelled || !frame) return;
        const canvas = gradeCanvasRef.current;
        if (!canvas) return;
        canvas.width = 'width' in frame ? frame.width : 0;
        canvas.height = 'height' in frame ? frame.height : 0;
        canvas.getContext('2d')?.drawImage(frame, 0, 0);
        setGradeState('rendered');
      }).catch(() => {
        if (!cancelled) setGradeState('unavailable');
      });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [currentTime, playing]);

  if (!activeId || !entry) return null;

  const engineReady = getVideoEngine() !== null;
  const codecSupported = codec === 'avc' ? (capabilities?.encoders.avc ?? false) : (capabilities?.encoders.vp9 ?? false);
  const containerSupported = capabilities?.containers[container] ?? false;
  const audioDisabled = audioMode === 'passthrough' && !(capabilities?.audioPassthrough ?? false);
  const sourceHeight = entry.video?.height ?? 0;
  const limitedResolution = mobile && sourceHeight > 1080 && resolution === 'source';
  const canExport = engineReady && (capabilities?.canDecode ?? false) && codecSupported && containerSupported && !audioDisabled && !running && duration > 0 && !limitedResolution;
  const phase = progress?.phase ?? null;

  return (
    <div data-testid="video-workspace" role="dialog" aria-modal="false" aria-label="Video workspace" className="fixed inset-0 z-40 flex flex-col bg-[var(--ui-bg-0d1119)]/98 p-4 text-[color:var(--ui-text-slate200)]">
      <div className="mb-3 flex items-center justify-between">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{entry.name}</h2>
          <p className="text-xs text-[color:var(--ui-text-slate400)]">
            {entry.video?.width ?? '—'} × {entry.video?.height ?? '—'} · {formatTime(duration)} · trim {formatTime(trim.startSec)}–{formatTime(trim.endSec)}
            {mobile ? ' · mobile limits on' : ''}
          </p>
        </div>
        <button type="button" aria-label="Close video workspace" onClick={() => { handleRef.current?.cancel(); closeVideo(); }}><X className="h-5 w-5" /></button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-h-0 flex-col gap-3">
          <div className="relative flex min-h-[220px] items-center justify-center overflow-hidden rounded-lg bg-black">
            {url ? (
              <video
                ref={videoRef}
                data-testid="video-player"
                src={url}
                className="max-h-[60vh] w-full object-contain"
                onLoadedMetadata={onLoadedMetadata}
                onTimeUpdate={onTimeUpdate}
                onEnded={() => setPlaying(false)}
                onPause={() => setPlaying(false)}
                onPlay={() => setPlaying(true)}
                playsInline
              />
            ) : (
              <p className="text-xs text-[color:var(--ui-text-slate400)]">Loading video…</p>
            )}
            <canvas ref={gradeCanvasRef} data-testid="video-graded-preview" data-state={gradeState} className={gradeState === 'rendered' ? 'absolute inset-0 m-auto max-h-[60vh] w-full object-contain' : 'hidden'} />
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            <button type="button" data-testid="video-play" aria-label={playing ? 'Pause video' : 'Play video'} onClick={togglePlay} disabled={!url} className="rounded border border-[color:var(--ui-border-slate600)] px-3 py-1 font-semibold hover:border-amber-400">{playing ? 'Pause' : 'Play'}</button>
            <button type="button" aria-label="Previous frame" onClick={() => seekTo(frameStep(currentTime, fps, -1, duration))} className="rounded border border-[color:var(--ui-border-slate600)] px-2 py-1">−1f</button>
            <button type="button" aria-label="Next frame" onClick={() => seekTo(frameStep(currentTime, fps, 1, duration))} className="rounded border border-[color:var(--ui-border-slate600)] px-2 py-1">+1f</button>
            <span data-testid="video-time" className="tabular-nums text-[color:var(--ui-text-slate300)]">{formatTime(currentTime)} / {formatTime(duration)}</span>
          </div>

          <input
            data-testid="video-scrub"
            aria-label="Scrub video"
            type="range"
            min={0}
            max={Math.max(0.001, duration)}
            step={0.01}
            value={Math.min(currentTime, Math.max(0.001, duration))}
            onChange={(event) => seekTo(Number(event.target.value))}
            className="w-full"
          />

          <div className="rounded border border-[color:var(--ui-border-slate700)] p-3 text-xs">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold">Trim</span>
              <span data-testid="video-trim-summary" className="tabular-nums text-[color:var(--ui-text-slate400)]">{trim.startSec.toFixed(2)}s – {trim.endSec.toFixed(2)}s · {(trim.endSec - trim.startSec).toFixed(2)}s · {Math.max(1, Math.round((trim.endSec - trim.startSec) * fps))} frames @ {fps}fps</span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" aria-label="Trim in previous frame" onClick={() => stepTrim('in', -1)} className="rounded border px-2 py-1">−1f</button>
              <input
                data-testid="video-trim-in"
                aria-label="Trim in"
                type="range"
                min={0}
                max={Math.max(0.001, duration)}
                step={1 / Math.max(1, fps)}
                value={trimFraction(trim.startSec, duration) * Math.max(0.001, duration)}
                onChange={(event) => adjustTrim('in', Number(event.target.value))}
                className="flex-1"
              />
              <button type="button" aria-label="Trim in next frame" onClick={() => stepTrim('in', 1)} className="rounded border px-2 py-1">+1f</button>
              <span className="w-16 text-right tabular-nums">{trim.startSec.toFixed(2)}s</span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" aria-label="Trim out previous frame" onClick={() => stepTrim('out', -1)} className="rounded border px-2 py-1">−1f</button>
              <input
                data-testid="video-trim-out"
                aria-label="Trim out"
                type="range"
                min={0}
                max={Math.max(0.001, duration)}
                step={1 / Math.max(1, fps)}
                value={trimFraction(trim.endSec, duration) * Math.max(0.001, duration)}
                onChange={(event) => adjustTrim('out', Number(event.target.value))}
                className="flex-1"
              />
              <button type="button" aria-label="Trim out next frame" onClick={() => stepTrim('out', 1)} className="rounded border px-2 py-1">+1f</button>
              <span className="w-16 text-right tabular-nums">{trim.endSec.toFixed(2)}s</span>
            </div>
          </div>
        </div>

        <aside className="flex flex-col gap-3 text-xs">
          <div>
            <p className="mb-1 font-semibold">Device support</p>
            <div data-testid="video-capabilities" className="flex flex-wrap gap-1">
              <CapabilityBadge label="mp4" supported={capabilities?.containers.mp4 ?? false} />
              <CapabilityBadge label="webm" supported={capabilities?.containers.webm ?? false} />
              <CapabilityBadge label="avc" supported={capabilities?.encoders.avc ?? false} />
              <CapabilityBadge label="vp9" supported={capabilities?.encoders.vp9 ?? false} />
              <CapabilityBadge label="audio" supported={capabilities?.audioPassthrough ?? false} />
            </div>
          </div>

          <label className="flex flex-col gap-1">Container
            <select data-testid="video-container" value={container} disabled={running} onChange={(event) => setContainer(event.target.value as VideoContainer)} className="bg-[var(--ui-bg-111722)] p-1">
              <option value="mp4" disabled={!(capabilities?.containers.mp4 ?? false)}>MP4</option>
              <option value="webm" disabled={!(capabilities?.containers.webm ?? false)}>WebM</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Codec
            <select data-testid="video-codec" value={codec} disabled={running} onChange={(event) => setCodec(event.target.value as VideoCodec)} className="bg-[var(--ui-bg-111722)] p-1">
              <option value="avc" disabled={!(capabilities?.encoders.avc ?? false)}>H.264 (AVC)</option>
              <option value="vp9" disabled={!(capabilities?.encoders.vp9 ?? false)}>VP9</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Audio
            <select data-testid="video-audio" value={audioMode} disabled={running} onChange={(event) => setAudioMode(event.target.value as VideoAudioMode)} className="bg-[var(--ui-bg-111722)] p-1">
              <option value="passthrough" disabled={!(capabilities?.audioPassthrough ?? false)}>Passthrough (no re-encode)</option>
              <option value="aac">AAC re-encode</option>
              <option value="none">Mute</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Resolution
            <select data-testid="video-resolution" value={resolution} disabled={running} onChange={(event) => setResolution(event.target.value as VideoResolution)} className="bg-[var(--ui-bg-111722)] p-1">
              <option value="source" disabled={mobile && sourceHeight > 1080}>Source{sourceHeight > 1080 ? ` (${entry.video?.width}×${sourceHeight})` : ''}</option>
              <option value="1080p">1080p</option>
              <option value="720p">720p</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">Bitrate (Mbps)
            <input data-testid="video-bitrate" type="number" min={1} max={80} value={bitrateMbps} disabled={running} onChange={(event) => setBitrateMbps(Math.min(80, Math.max(1, Number(event.target.value) || 1)))} className="bg-[var(--ui-bg-111722)] p-1" />
          </label>
          <label className="flex flex-col gap-1">Frame rate
            <select data-testid="video-fps" value={fps} disabled={running} onChange={(event) => setFps(Number(event.target.value))} className="bg-[var(--ui-bg-111722)] p-1">
              <option value={24}>24 fps</option>
              <option value={30}>30 fps</option>
              <option value={60}>60 fps</option>
            </select>
          </label>

          {limitedResolution && (
            <p role="alert" data-testid="video-mobile-limit" className="text-[color:var(--ui-text-amber-400)]">Mobile devices export at 1080p or lower. Choose a resolution to continue.</p>
          )}
          {mobile && (
            <p data-testid="video-mobile-guard" className="text-[color:var(--ui-text-slate400)]">Mobile memory guard: exports are checked against the device budget before starting.</p>
          )}
          {!capabilities && (
            <p data-testid="video-engine-loading" className="text-[color:var(--ui-text-slate400)]">Loading the video engine…</p>
          )}
          {!engineReady && (
            <p data-testid="video-engine-missing" className="text-[color:var(--ui-text-amber-400)]">Video engine not loaded yet. Timeline and trim work now; export enables once the video engine is connected.</p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" data-testid="video-export" onClick={startExport} disabled={!canExport} className="rounded bg-amber-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40">{done ? 'Export again' : 'Export video'}</button>
            {running && <button type="button" data-testid="video-cancel" onClick={cancelExport} className="rounded border border-red-400/60 px-2 py-1 text-red-300">Cancel</button>}
            {error && !running && <button type="button" data-testid="video-retry" onClick={startExport} disabled={!canExport} className="rounded border border-amber-400/60 px-2 py-1 text-amber-300">Retry</button>}
          </div>

          {(running || progress) && (
            <div data-testid="video-progress" data-phase={phase ?? ''} className="rounded border border-[color:var(--ui-border-slate700)] p-2">
              <div className="mb-1 flex flex-wrap gap-1">
                {PHASES.map((item) => (
                  <span key={item} data-testid={`video-phase-${item}`} data-active={item === phase ? 'true' : 'false'} className={item === phase ? 'text-amber-300' : 'text-[color:var(--ui-text-slate500)]'}>{item}</span>
                ))}
              </div>
              <p className="tabular-nums text-[color:var(--ui-text-slate300)]">{progress?.framesTotal ? `${progress.framesDone}/${progress.framesTotal} frames` : 'Preparing…'}</p>
            </div>
          )}

          {error && <p role="alert" data-testid="video-error" className="text-red-300">{error}</p>}
          {done && !error && <p data-testid="video-done" className="text-emerald-300">Export saved to downloads.</p>}
          {gradeState === 'unavailable' && <p data-testid="video-grade-note" className="text-[color:var(--ui-text-slate500)]">Graded preview needs the CP4-01b frame renderer; the current export encodes the source frames ungraded.</p>}
        </aside>
      </div>
    </div>
  );
}
