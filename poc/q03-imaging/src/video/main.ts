import {
  Input,
  ALL_FORMATS,
  BlobSource,
  VideoSampleSink,
  EncodedPacketSink,
  Output,
  Mp4OutputFormat,
  WebMOutputFormat,
  BufferTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  Quality,
  getEncodableVideoCodecs,
  getEncodableAudioCodecs,
} from 'mediabunny';

const logEl = () => document.getElementById('log') as HTMLDivElement;
function log(msg: string) {
  const el = logEl();
  if (el) el.textContent += `${msg}\n`;
}

const heap = () => (performance as any).memory?.usedJSHeapSize ?? null;

function toDataURL(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function downscaleToJPEG(source: CanvasImageSource, srcW: number, srcH: number, maxW = 1024, quality = 0.85) {
  const scale = Math.min(1, maxW / srcW);
  const w = Math.max(1, Math.round(srcW * scale));
  const h = Math.max(1, Math.round(srcH * scale));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')!.drawImage(source, 0, 0, w, h);
  const blob: Blob = await new Promise((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', quality));
  const url = await toDataURL(blob);
  canvas.width = 1; canvas.height = 1;
  return { url, width: w, height: h, sourceWidth: srcW, sourceHeight: srcH };
}

// ---------------------------------------------------------------- WebGL2 LUT pass

const LUT_SIZE = 33;

function buildWarmFilmLut(size: number): Uint8Array {
  const data = new Uint8Array(size * size * size * 4);
  let i = 0;
  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const lin = (v: number) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
        const enc = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
        // Gentle filmic S-curve + warm shift, applied in linear light
        const curve = (x: number) => {
          const y = x + 0.08 * Math.sin(Math.PI * Math.min(1, Math.max(0, x))) * (0.5 - Math.abs(x - 0.5));
          return Math.min(1, Math.max(0, y));
        };
        const R = enc(curve(lin(r / (size - 1))) * 1.025) * 255;
        const G = enc(curve(lin(g / (size - 1))) * 0.998) * 255;
        const B = enc(curve(lin(b / (size - 1))) * 0.965) * 255;
        data[i++] = Math.round(R);
        data[i++] = Math.round(G);
        data[i++] = Math.round(B);
        data[i++] = 255;
      }
    }
  }
  return data;
}

class GlLutPipeline {
  canvas: HTMLCanvasElement;
  gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private tex: WebGLTexture;
  private lutTex: WebGLTexture;
  private uImage: WebGLUniformLocation | null;
  private uLut: WebGLUniformLocation | null;
  private uSize: WebGLUniformLocation | null;

  constructor(width: number, height: number, private strength = 0.85) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = width;
    this.canvas.height = height;
    const gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false });
    if (!gl) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    const vs = `#version 300 es
in vec2 a_pos; out vec2 v_uv;
void main(){ v_uv = a_pos * 0.5 + 0.5; gl_Position = vec4(a_pos, 0.0, 1.0); }`;
    const fs = `#version 300 es
precision highp float; precision highp sampler3D;
in vec2 v_uv; out vec4 fragColor;
uniform sampler2D u_image; uniform sampler3D u_lut; uniform float u_size; uniform float u_strength;
void main(){
  vec3 c = texture(u_image, vec2(v_uv.x, 1.0 - v_uv.y)).rgb;
  vec3 coord = (clamp(c, 0.0, 1.0) * (u_size - 1.0) + 0.5) / u_size;
  vec3 graded = texture(u_lut, coord).rgb;
  fragColor = vec4(mix(c, graded, u_strength), 1.0);
}`;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader compile failed');
      return sh;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link failed');
    this.program = prog;
    gl.useProgram(prog);

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

    this.tex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.lutTex = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTex);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage3D(gl.TEXTURE_3D, 0, gl.RGBA8, LUT_SIZE, LUT_SIZE, LUT_SIZE, 0, gl.RGBA, gl.UNSIGNED_BYTE, buildWarmFilmLut(LUT_SIZE));
    gl.activeTexture(gl.TEXTURE0);

    this.uImage = gl.getUniformLocation(prog, 'u_image');
    this.uLut = gl.getUniformLocation(prog, 'u_lut');
    this.uSize = gl.getUniformLocation(prog, 'u_size');
    gl.uniform1i(this.uImage, 0);
    gl.uniform1i(this.uLut, 1);
    gl.uniform1f(this.uSize, LUT_SIZE);
    gl.uniform1f(gl.getUniformLocation(prog, 'u_strength'), strength);
    gl.viewport(0, 0, width, height);
  }

  render(source: TexImageSource) {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  destroy() {
    const gl = this.gl;
    gl.deleteTexture(this.tex);
    gl.deleteTexture(this.lutTex);
    gl.deleteProgram(this.program);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    this.canvas.width = 1;
    this.canvas.height = 1;
  }
}

// ---------------------------------------------------------------- capability detection

const VIDEO_PROBES: VideoDecoderConfig[] = [
  { codec: 'avc1.42E01E', codedWidth: 1280, codedHeight: 720, bitrate: 2_000_000, framerate: 30 },
  { codec: 'avc1.640028', codedWidth: 1920, codedHeight: 1080, bitrate: 8_000_000, framerate: 30 },
  { codec: 'hvc1.1.6.L93.B0', codedWidth: 1280, codedHeight: 720, bitrate: 4_000_000, framerate: 30 },
  { codec: 'vp09.00.10.08', codedWidth: 1280, codedHeight: 720, bitrate: 2_000_000, framerate: 30 },
  { codec: 'vp8', codedWidth: 1280, codedHeight: 720, bitrate: 2_000_000, framerate: 30 },
  { codec: 'av01.0.04M.08', codedWidth: 1280, codedHeight: 720, bitrate: 2_000_000, framerate: 30 },
];

const AUDIO_PROBES: AudioDecoderConfig[] = [
  { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2 },
  { codec: 'opus', sampleRate: 48000, numberOfChannels: 2 },
  { codec: 'mp3', sampleRate: 48000, numberOfChannels: 2 },
  { codec: 'flac', sampleRate: 48000, numberOfChannels: 2 },
];

const ENCODE_PROBES: VideoEncoderConfig[] = [
  { codec: 'avc1.42001f', width: 1280, height: 720, bitrate: 3_000_000, framerate: 30 },
  { codec: 'vp09.00.10.08', width: 1280, height: 720, bitrate: 3_000_000, framerate: 30 },
  { codec: 'av01.0.04M.08', width: 1280, height: 720, bitrate: 3_000_000, framerate: 30 },
  { codec: 'hvc1.1.6.L93.B0', width: 1280, height: 720, bitrate: 3_000_000, framerate: 30 },
];

const AUDIO_ENCODE_PROBES: AudioEncoderConfig[] = [
  { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
  { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 128000 },
];

async function probeSupport<T extends VideoDecoderConfig | AudioDecoderConfig | VideoEncoderConfig | AudioEncoderConfig>(kind: 'video-decode' | 'audio-decode' | 'video-encode' | 'audio-encode', config: T) {
  try {
    let res: any;
    if (kind === 'video-decode') res = await (VideoDecoder as any).isConfigSupported(config);
    else if (kind === 'audio-decode') res = await (AudioDecoder as any).isConfigSupported(config);
    else if (kind === 'video-encode') res = await (VideoEncoder as any).isConfigSupported(config);
    else res = await (AudioEncoder as any).isConfigSupported(config);
    return { codec: (config as any).codec, supported: res?.supported ?? false, config: res?.config ? { codec: res.config.codec, hardwareAcceleration: res.config.hardwareAcceleration ?? null } : null };
  } catch (e: any) {
    return { codec: (config as any).codec, supported: false, error: `${e?.name}: ${String(e?.message ?? e)}` };
  }
}

async function capabilities() {
  const has = (k: string) => k in globalThis;
  const out: Record<string, any> = {
    apis: {
      VideoDecoder: has('VideoDecoder'),
      VideoEncoder: has('VideoEncoder'),
      AudioDecoder: has('AudioDecoder'),
      AudioEncoder: has('AudioEncoder'),
      VideoFrame: has('VideoFrame'),
      AudioData: has('AudioData'),
      ImageDecoder: has('ImageDecoder'),
    },
    userAgent: navigator.userAgent,
    platform: (navigator as any).userAgentData?.platform ?? null,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGB: (navigator as any).deviceMemory ?? null,
    crossOriginIsolated: (globalThis as any).crossOriginIsolated ?? false,
    heapLimitMB: (performance as any).memory?.jsHeapSizeLimit ? Math.round((performance as any).memory.jsHeapSizeLimit / 1048576) : null,
    mediaCapabilitiesDecoding: null as any,
    probes: {
      videoDecode: [] as any[],
      audioDecode: [] as any[],
      videoEncode: [] as any[],
      audioEncode: [] as any[],
    },
    mediabunny: {
      encodableVideo: [] as any[],
      encodableAudio: [] as any[],
      error: null as any,
    },
    webgl2: false,
    webgl2MaxTexture: null as any,
    webgl2Renderer: null as any,
  };
  for (const cfg of VIDEO_PROBES) out.probes.videoDecode.push(await probeSupport('video-decode', cfg));
  for (const cfg of AUDIO_PROBES) out.probes.audioDecode.push(await probeSupport('audio-decode', cfg));
  for (const cfg of ENCODE_PROBES) out.probes.videoEncode.push(await probeSupport('video-encode', cfg));
  for (const cfg of AUDIO_ENCODE_PROBES) out.probes.audioEncode.push(await probeSupport('audio-encode', cfg));
  try {
    out.mediabunny.encodableVideo = await getEncodableVideoCodecs();
    out.mediabunny.encodableAudio = await getEncodableAudioCodecs();
  } catch (e: any) {
    out.mediabunny.error = `${e?.name}: ${String(e?.message ?? e)}`;
  }
  try {
    const mc = (navigator as any).mediaCapabilities;
    if (mc) {
      const res = await mc.decodingInfo({
        type: 'file',
        video: { contentType: 'video/mp4; codecs="avc1.64001f"', width: 1280, height: 720, bitrate: 4_000_000, framerate: 30 },
      });
      out.mediaCapabilitiesDecoding = { supported: res.supported, smooth: res.smooth, powerEfficient: res.powerEfficient };
    }
  } catch (e: any) {
    out.mediaCapabilitiesDecoding = { error: String(e?.message ?? e) };
  }
  const probeCanvas = document.createElement('canvas');
  const gl = probeCanvas.getContext('webgl2');
  if (gl) {
    out.webgl2 = true;
    out.webgl2MaxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    out.webgl2Renderer = ext ? gl.getParameter((ext as any).UNMASKED_RENDERER_WEBGL) : null;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return out;
}

// ---------------------------------------------------------------- analysis

async function openInput(path: string) {
  const resp = await fetch(`/testdata/${path}`);
  if (!resp.ok) throw new Error(`fetch ${resp.status} for ${path}`);
  const blob = await resp.blob();
  return { input: new Input({ source: new BlobSource(blob), formats: ALL_FORMATS }), blob };
}

async function analyze(path: string) {
  const { input, blob } = await openInput(path);
  const out: Record<string, any> = { path, fileBytes: blob.size };
  try {
    const format = await input.getFormat();
    out.format = { name: format.name, mimeType: format.mimeType };
    out.duration = await input.computeDuration();
    const videoTrack = await input.getPrimaryVideoTrack();
    if (videoTrack) {
      const decoderConfig = await videoTrack.getDecoderConfig();
      const stats = await videoTrack.computePacketStats();
      out.video = {
        codec: videoTrack.codec,
        codecString: await videoTrack.getCodecParameterString(),
        canDecode: await videoTrack.canDecode(),
        codedWidth: videoTrack.codedWidth,
        codedHeight: videoTrack.codedHeight,
        displayWidth: videoTrack.displayWidth,
        displayHeight: videoTrack.displayHeight,
        rotation: await videoTrack.getRotation(),
        duration: await videoTrack.computeDuration(),
        decoderConfig: decoderConfig ? { codec: decoderConfig.codec, codedWidth: decoderConfig.codedWidth, codedHeight: decoderConfig.codedHeight } : null,
        packetStats: { packetCount: stats.packetCount, averagePacketRate: Number(stats.averagePacketRate?.toFixed(3)), averageBitrate: Math.round(stats.averageBitrate ?? 0) },
      };
    } else {
      out.video = null;
    }
    const audioTrack = await input.getPrimaryAudioTrack();
    if (audioTrack) {
      const decoderConfig = await audioTrack.getDecoderConfig();
      out.audio = {
        codec: audioTrack.codec,
        codecString: await audioTrack.getCodecParameterString(),
        canDecode: await audioTrack.canDecode(),
        sampleRate: audioTrack.sampleRate,
        numberOfChannels: audioTrack.numberOfChannels,
        duration: await audioTrack.computeDuration(),
        decoderConfig: decoderConfig ? { codec: decoderConfig.codec, sampleRate: (decoderConfig as any).sampleRate, numberOfChannels: (decoderConfig as any).numberOfChannels } : null,
      };
    } else {
      out.audio = null;
    }
    return out;
  } finally {
    (input as any).dispose?.();
    out.inputBytes = blob.size;
  }
}

// ---------------------------------------------------------------- benches / transcode

interface BenchResult {
  ok: boolean;
  error?: string;
  frames?: number;
  fps?: number;
  wallMs?: number;
  perFrameMs?: { median: number; p95: number; max: number };
  peakHeapDeltaMB?: number | null;
}

async function bench(path: string, mode: 'decode-draw' | 'decode-grade', maxSeconds = Infinity): Promise<BenchResult> {
  const { input } = await openInput(path);
  const out: BenchResult = { ok: false };
  let pipeline: GlLutPipeline | null = null;
  const frameTimes: number[] = [];
  let frames = 0;
  const before = heap();
  let peak = before;
  const timer = setInterval(() => {
    const h = heap();
    if (h !== null) peak = Math.max(peak ?? 0, h);
  }, 20);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('no video track');
    if (!(await track.canDecode())) throw new Error('video track cannot be decoded by this browser');
    const sink = new VideoSampleSink(track);
    let drawCanvas: HTMLCanvasElement | null = null;
    let drawCtx: CanvasRenderingContext2D | null = null;
    if (mode === 'decode-draw') {
      drawCanvas = document.createElement('canvas');
      drawCanvas.width = track.displayWidth;
      drawCanvas.height = track.displayHeight;
      drawCtx = drawCanvas.getContext('2d');
    } else {
      pipeline = new GlLutPipeline(track.displayWidth, track.displayHeight);
    }
    const wallStart = performance.now();
    for await (const sample of sink.samples(0, maxSeconds === Infinity ? undefined : maxSeconds)) {
      const t0 = performance.now();
      if (drawCanvas && drawCtx) sample.draw(drawCtx, 0, 0, drawCanvas.width, drawCanvas.height);
      else if (pipeline) {
        const src = sample.toCanvasImageSource();
        pipeline.render(src);
        pipeline.gl.finish();
      }
      sample.close();
      frameTimes.push(performance.now() - t0);
      frames++;
      const h = heap();
      if (h !== null) peak = Math.max(peak ?? 0, h);
    }
    const wall = performance.now() - wallStart;
    out.ok = true;
    out.frames = frames;
    out.wallMs = Number(wall.toFixed(1));
    out.fps = Number((frames / (wall / 1000)).toFixed(2));
    const sorted = [...frameTimes].sort((a, b) => a - b);
    out.perFrameMs = {
      median: Number(sorted[Math.floor(sorted.length / 2)].toFixed(2)),
      p95: Number(sorted[Math.floor(sorted.length * 0.95)]?.toFixed(2) ?? 0),
      max: Number(sorted[sorted.length - 1].toFixed(2)),
    };
    if (drawCanvas) { drawCanvas.width = 1; drawCanvas.height = 1; }
    return out;
  } catch (e: any) {
    out.error = `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`;
    return out;
  } finally {
    clearInterval(timer);
    pipeline?.destroy();
    const h = heap();
    if (h !== null) peak = Math.max(peak ?? 0, h);
    out.peakHeapDeltaMB = before !== null && peak !== null ? Number(((peak - before) / 1048576).toFixed(1)) : null;
    try { (input as any).dispose?.(); } catch {}
  }
}

async function pickCodec(container: 'mp4' | 'webm', width: number, height: number) {
  const encodable = await getEncodableVideoCodecs();
  const preferred = container === 'mp4' ? ['avc', 'av1', 'vp9'] : ['vp9', 'av1', 'vp8'];
  for (const codec of preferred) {
    if (!encodable.includes(codec)) continue;
    try {
      const res = await (VideoEncoder as any).isConfigSupported({
        codec: codec === 'avc' ? 'avc1.42001f' : codec === 'vp9' ? 'vp09.00.10.08' : codec === 'av1' ? 'av01.0.04M.08' : 'vp8',
        width, height, bitrate: 3_000_000, framerate: 30,
      });
      if (res?.supported) return codec;
    } catch {}
  }
  return null;
}

interface TranscodeResult {
  ok: boolean;
  error?: string;
  container?: string;
  videoCodec?: string | null;
  frames?: number;
  audioPacketsCopied?: number;
  timing?: { wallMs: number; perFrameMs: { median: number; p95: number; max: number }; encodeAwaitMs: { median: number; p95: number; max: number }; fps: number };
  peakHeapDeltaMB?: number | null;
  output?: { bytes: number; duration: number; mimeType: string; videoCodec: string | null; audioCodec: string | null; firstVideoTimestamp: number | null; firstAudioTimestamp: number | null; avStartOffsetMs: number | null; videoTrackDuration: number | null; audioTrackDuration: number | null; avEndDeltaMs: number | null; outputVideoPacketCount: number | null; outputAudioPacketCount: number | null };
  images?: Record<string, any>;
  outputBase64?: string;
  quality?: any;
}

async function transcode(path: string, opts: { strength?: number; maxSeconds?: number; snapshotAt?: number } = {}): Promise<TranscodeResult> {
  const { input } = await openInput(path);
  const res: TranscodeResult = { ok: false };
  let pipeline: GlLutPipeline | null = null;
  const frameTimes: number[] = [];
  const encodeTimes: number[] = [];
  const before = heap();
  let peak = before;
  const timer = setInterval(() => {
    const h = heap();
    if (h !== null) peak = Math.max(peak ?? 0, h);
  }, 20);
  let output: Output | null = null;
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('no video track');
    if (!(await videoTrack.canDecode())) throw new Error('video track cannot be decoded by this browser');
    const audioTrack = await input.getPrimaryAudioTrack();
    const container = path.endsWith('.webm') ? 'webm' : 'mp4';
    res.container = container;
    const codec = await pickCodec(container, videoTrack.codedWidth, videoTrack.codedHeight);
    if (!codec) throw new Error(`no encodable ${container} video codec`);
    res.videoCodec = codec;

    pipeline = new GlLutPipeline(videoTrack.displayWidth, videoTrack.displayHeight, opts.strength ?? 0.85);
    const format = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
    output = new Output({ format, target: new BufferTarget() });
    const videoSource = new CanvasSource(pipeline.canvas, { codec, quality: new Quality('high'), keyFrameInterval: 2 });
    const fpsStats = await videoTrack.computePacketStats(60);
    const frameRate = fpsStats?.averagePacketRate && Number.isFinite(fpsStats.averagePacketRate) ? Math.max(1, Math.round(fpsStats.averagePacketRate)) : 30;
    output.addVideoTrack(videoSource, { frameRate });
    let audioSource: EncodedAudioPacketSource | null = null;
    if (audioTrack && audioTrack.codec) {
      audioSource = new EncodedAudioPacketSource(audioTrack.codec);
      output.addAudioTrack(audioSource);
    }
    await output.start();

    // Audio: encoded-packet passthrough (no re-encode), preserving original timestamps for A/V sync.
    let audioPackets = 0;
    if (audioTrack && audioSource) {
      const audioSink = new EncodedPacketSink(audioTrack);
      const first = await audioSink.getFirstPacket();
      const decoderConfig = await audioTrack.getDecoderConfig();
      const audioStart = performance.now();
      for await (const packet of audioSink.packets(first ?? undefined)) {
        if (opts.maxSeconds && packet.timestamp > opts.maxSeconds) break;
        await audioSource.add(packet, audioPackets === 0 && decoderConfig ? { decoderConfig: decoderConfig as any } : undefined);
        audioPackets++;
      }
      res.audioPacketsCopied = audioPackets;
      (res as any).audioCopyMs = Number((performance.now() - audioStart).toFixed(1));
    }

    const sink = new VideoSampleSink(videoTrack);
    const snapshotAt = opts.snapshotAt ?? 1.0;
    const images: Record<string, any> = {};
    let savedSnapshot = false;
    const snapW = Math.min(1024, videoTrack.displayWidth);
    let frames = 0;
    const wallStart = performance.now();
    for await (const sample of sink.samples(0, opts.maxSeconds === Infinity || opts.maxSeconds === undefined ? undefined : opts.maxSeconds)) {
      const t0 = performance.now();
      const src = sample.toCanvasImageSource();
      if (!savedSnapshot && sample.timestamp >= snapshotAt) {
        savedSnapshot = true;
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = videoTrack.displayWidth;
        snapCanvas.height = videoTrack.displayHeight;
        const ctx = snapCanvas.getContext('2d')!;
        sample.draw(ctx, 0, 0, snapCanvas.width, snapCanvas.height);
        images.original = await downscaleToJPEG(snapCanvas, snapCanvas.width, snapCanvas.height, snapW, 0.85);
        images.graded = await downscaleToJPEG(pipeline.canvas, pipeline.canvas.width, pipeline.canvas.height, snapW, 0.85);
        snapCanvas.width = 1; snapCanvas.height = 1;
      }
      pipeline.render(src);
      const encodeStart = performance.now();
      await videoSource.add(sample.timestamp, sample.duration);
      encodeTimes.push(performance.now() - encodeStart);
      sample.close();
      frameTimes.push(performance.now() - t0);
      frames++;
      const h = heap();
      if (h !== null) peak = Math.max(peak ?? 0, h);
    }
    const wall = performance.now() - wallStart;
    await output.finalize();
    const buffer = (output.target as BufferTarget).buffer!;
    const blob = new Blob([buffer], { type: await output.getMimeType() });
    res.images = images;
    res.frames = frames;
    res.timing = {
      wallMs: Number(wall.toFixed(1)),
      fps: Number((frames / (wall / 1000)).toFixed(2)),
      perFrameMs: {
        median: Number([...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length / 2)].toFixed(2)),
        p95: Number([...frameTimes].sort((a, b) => a - b)[Math.floor(frameTimes.length * 0.95)]?.toFixed(2) ?? 0),
        max: Number([...frameTimes].sort((a, b) => a - b)[frames - 1].toFixed(2)),
      },
      encodeAwaitMs: {
        median: Number([...encodeTimes].sort((a, b) => a - b)[Math.floor(encodeTimes.length / 2)].toFixed(2)),
        p95: Number([...encodeTimes].sort((a, b) => a - b)[Math.floor(encodeTimes.length * 0.95)]?.toFixed(2) ?? 0),
        max: Number([...encodeTimes].sort((a, b) => a - b)[encodeTimes.length - 1].toFixed(2)),
      },
    };

    // Verify the produced file by reading it back with mediabunny.
    const verifyInput = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
    const vTrack = await verifyInput.getPrimaryVideoTrack();
    const aTrack = await verifyInput.getPrimaryAudioTrack();
    const vSink = vTrack ? new EncodedPacketSink(vTrack) : null;
    const aSink = aTrack ? new EncodedPacketSink(aTrack) : null;
    const vFirst = vSink ? await vSink.getFirstPacket() : null;
    const aFirst = aSink ? await aSink.getFirstPacket() : null;
    const vStats = vTrack ? await vTrack.computePacketStats() : null;
    const aStats = aTrack ? await aTrack.computePacketStats() : null;
    const vDuration = vTrack ? await vTrack.computeDuration() : null;
    const aDuration = aTrack ? await aTrack.computeDuration() : null;
    res.output = {
      bytes: blob.size,
      duration: await verifyInput.computeDuration(),
      mimeType: blob.type,
      videoCodec: vTrack ? await vTrack.getCodecParameterString() : null,
      audioCodec: aTrack ? await aTrack.getCodecParameterString() : null,
      firstVideoTimestamp: vFirst ? vFirst.timestamp : null,
      firstAudioTimestamp: aFirst ? aFirst.timestamp : null,
      avStartOffsetMs: vFirst && aFirst ? Number(((aFirst.timestamp - vFirst.timestamp) * 1000).toFixed(2)) : null,
      videoTrackDuration: vDuration,
      audioTrackDuration: aDuration,
      avEndDeltaMs: vDuration !== null && aDuration !== null ? Number(((aDuration - vDuration) * 1000).toFixed(2)) : null,
      outputVideoPacketCount: vStats?.packetCount ?? null,
      outputAudioPacketCount: aStats?.packetCount ?? null,
    };
    try { (verifyInput as any).dispose?.(); } catch {}
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let bin = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))) as any);
    }
    res.outputBase64 = btoa(bin);
    res.ok = true;
    return res;
  } catch (e: any) {
    res.error = `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`;
    try { await output?.cancel(); } catch {}
    return res;
  } finally {
    clearInterval(timer);
    const h = heap();
    if (h !== null) peak = Math.max(peak ?? 0, h);
    res.peakHeapDeltaMB = before !== null && peak !== null ? Number(((peak - before) / 1048576).toFixed(1)) : null;
    pipeline?.destroy();
    try { (input as any).dispose?.(); } catch {}
  }
}

async function snapshotFrames(path: string, timestamps: number[]) {
  const { input } = await openInput(path);
  const imgs: Record<string, any> = {};
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return { ok: false };
    const canvas = document.createElement('canvas');
    canvas.width = track.displayWidth;
    canvas.height = track.displayHeight;
    const ctx = canvas.getContext('2d')!;
    const sink = new VideoSampleSink(track);
    for (const ts of timestamps) {
      const sample = await sink.getSample(ts);
      if (!sample) continue;
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      imgs[`t${ts}`] = await downscaleToJPEG(canvas, canvas.width, canvas.height, 1024, 0.85);
      sample.close();
    }
    canvas.width = 1; canvas.height = 1;
    return { ok: true, images: imgs };
  } finally {
    try { (input as any).dispose?.(); } catch {}
  }
}

(window as any).__poc = {
  capabilities,
  analyze,
  bench,
  transcode,
  snapshotFrames,
  ready: Promise.resolve(true),
};
log('video PoC ready');
