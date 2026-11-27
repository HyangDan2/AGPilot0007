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
  StreamTarget,
  CanvasSource,
  EncodedAudioPacketSource,
  Quality,
  getEncodableVideoCodecs,
  getEncodableAudioCodecs,
} from 'mediabunny';
import { estimateEncodedBytes } from '../shared/imagingContract';

const logEl = () => document.getElementById('log') as HTMLDivElement;
function log(msg: string) {
  const el = logEl();
  if (el) el.textContent += `${msg}\n`;
}

const heap = () => (performance as any).memory?.usedJSHeapSize ?? null;
const heapMB = () => {
  const h = heap();
  return h === null ? null : Number((h / 1048576).toFixed(1));
};

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

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, Math.min(i + CHUNK, bytes.length))) as any);
  }
  return btoa(bin);
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
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
      showSaveFilePicker: has('showSaveFilePicker'),
      FileSystemWritableFileStream: has('FileSystemWritableFileStream'),
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
    outputTargets: null as any,
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
  out.outputTargets = detectOutputTargets();
  return out;
}

// ---------------------------------------------------------------- output target detection (IMG-02)

function detectOutputTargets() {
  const picker = typeof (globalThis as any).showSaveFilePicker === 'function';
  const harness = typeof (globalThis as any).__q03Sink === 'function';
  const ua = (navigator as any).userActivation;
  const userActivation = ua ? { isActive: !!ua.isActive, hasBeenActive: !!ua.hasBeenActive } : null;
  const canOpenPicker = picker && isSecureContext && userActivation?.isActive !== false;
  return {
    showSaveFilePicker: picker,
    fileSystemWritableFileStream: typeof (globalThis as any).FileSystemWritableFileStream === 'function',
    harnessSink: harness,
    secureContext: isSecureContext,
    userActivation,
    requiresUserGesture: true,
    canOpenPickerNow: canOpenPicker,
    defaultMode: harness ? 'harness-stream' : canOpenPicker ? 'file-picker' : 'buffer',
    note: 'the file picker needs an active user gesture; background/automation code is gated off and the streaming or budgeted buffer target is used instead',
  };
}

class MemoryBudgetError extends Error {
  code = 'MemoryBudgetExceeded';
  constructor(message: string, readonly detail: Record<string, any>) {
    super(message);
    this.name = 'MemoryBudgetError';
  }
}

class OutputTargetError extends Error {
  code = 'OutputTargetUnavailable';
  constructor(message: string, readonly detail: Record<string, any>) {
    super(message);
    this.name = 'OutputTargetError';
  }
}

function memoryBudgetMB(requested?: number) {
  const limit = (performance as any).memory?.jsHeapSizeLimit as number | undefined;
  const fallback = limit ? Math.min(512, Math.floor((limit / 1048576) * 0.3)) : 256;
  const budget = requested && requested > 0 ? requested : fallback;
  return { budgetMB: budget, heapLimitMB: limit ? Math.round(limit / 1048576) : null };
}

// ---------------------------------------------------------------- codec / profile selection (IMG-04)

interface EncoderChoice {
  container: 'mp4' | 'webm';
  codec: 'avc' | 'hevc' | 'vp9' | 'av1' | 'vp8';
  codecString: string;
  width: number;
  height: number;
  bitrate: number;
  framerate: number;
  level: string;
  profile: string | null;
  bpp: number;
  candidates: any[];
}

const H264_LEVELS = [
  { name: '3.0', hex: '1e', maxFS: 1620, maxMBPS: 40500, maxBR: 10_000_000 },
  { name: '3.1', hex: '1f', maxFS: 3600, maxMBPS: 108000, maxBR: 14_000_000 },
  { name: '3.2', hex: '20', maxFS: 5120, maxMBPS: 216000, maxBR: 20_000_000 },
  { name: '4.0', hex: '28', maxFS: 8192, maxMBPS: 245760, maxBR: 20_000_000 },
  { name: '4.1', hex: '29', maxFS: 8192, maxMBPS: 245760, maxBR: 50_000_000 },
  { name: '4.2', hex: '2a', maxFS: 8704, maxMBPS: 522240, maxBR: 50_000_000 },
  { name: '5.0', hex: '32', maxFS: 22080, maxMBPS: 589824, maxBR: 135_000_000 },
  { name: '5.1', hex: '33', maxFS: 36864, maxMBPS: 983040, maxBR: 240_000_000 },
  { name: '5.2', hex: '34', maxFS: 36864, maxMBPS: 2073600, maxBR: 240_000_000 },
  { name: '6.0', hex: '3c', maxFS: 139264, maxMBPS: 4177920, maxBR: 240_000_000 },
  { name: '6.1', hex: '3d', maxFS: 139264, maxMBPS: 8355840, maxBR: 480_000_000 },
  { name: '6.2', hex: '3e', maxFS: 139264, maxMBPS: 16711680, maxBR: 800_000_000 },
];

function h264Level(width: number, height: number, fps: number, bitrate: number) {
  const mbW = Math.ceil(width / 16);
  const mbH = Math.ceil(height / 16);
  const fs = mbW * mbH;
  const mbps = fs * fps;
  const level = H264_LEVELS.find((l) => l.maxFS >= fs && l.maxMBPS >= mbps && l.maxBR >= bitrate) ?? H264_LEVELS[H264_LEVELS.length - 1];
  return { ...level, fs, mbps };
}

function vp9Level(width: number, height: number, fps: number) {
  const lumaRate = width * height * fps;
  if (lumaRate <= 27_648_000) return { level: '31', name: '3.1' };
  if (lumaRate <= 62_208_000) return { level: '40', name: '4.0' };
  if (lumaRate <= 124_416_000) return { level: '50', name: '5.0' };
  if (lumaRate <= 248_832_000) return { level: '51', name: '5.1' };
  return { level: '60', name: '6.0' };
}

function av1Level(width: number, height: number, fps: number) {
  const lumaRate = width * height * fps;
  if (lumaRate <= 22_118_400) return { idx: '05', name: '3.1' };
  if (lumaRate <= 66_355_200) return { idx: '08', name: '4.0' };
  if (lumaRate <= 132_710_400) return { idx: '09', name: '4.1' };
  if (lumaRate <= 265_420_800) return { idx: '12', name: '5.0' };
  return { idx: '13', name: '5.1' };
}

function bitrateFor(codec: string, width: number, height: number, fps: number) {
  const bpp = (codec === 'avc' ? 0.10 : codec === 'hevc' ? 0.07 : codec === 'vp9' ? 0.07 : codec === 'vp8' ? 0.09 : 0.06);
  return Math.max(1_000_000, Math.min(40_000_000, Math.round(width * height * fps * bpp)));
}

async function chooseEncoder(container: 'mp4' | 'webm', width: number, height: number, fps: number): Promise<EncoderChoice | null> {
  const encodable = await getEncodableVideoCodecs();
  const preferred: EncoderChoice['codec'][] = container === 'mp4' ? ['avc', 'hevc', 'av1', 'vp9'] : ['vp9', 'av1', 'vp8'];
  const candidates: any[] = [];
  for (const codec of preferred) {
    if (!encodable.includes(codec)) { candidates.push({ codec, skipped: 'not in getEncodableVideoCodecs()' }); continue; }
    const bitrate = bitrateFor(codec, width, height, fps);
    const strings: { codecString: string; profile: string | null; level: string }[] = [];
    if (codec === 'avc') {
      const level = h264Level(width, height, fps, bitrate);
      const profiles = [
        { id: '64', name: 'high' }, { id: '4d', name: 'main' }, { id: '42', name: 'baseline' },
      ];
      for (const p of profiles) strings.push({ codecString: `avc1.${p.id}00${level.hex}`, profile: p.name, level: level.name });
    } else if (codec === 'vp9') {
      const l = vp9Level(width, height, fps);
      strings.push({ codecString: `vp09.00.${l.level}.08`, profile: 'profile0', level: l.name });
    } else if (codec === 'av1') {
      const l = av1Level(width, height, fps);
      strings.push({ codecString: `av01.0.${l.idx}M.08`, profile: 'main', level: l.name });
    } else if (codec === 'vp8') {
      strings.push({ codecString: 'vp8', profile: null, level: 'n/a' });
    } else {
      const hl = h264Level(width, height, fps, bitrate);
      const hevcLevels: Record<string, string> = { '3.0': '90', '3.1': '93', '4.0': '120', '4.1': '123', '5.0': '150', '5.1': '153', '5.2': '156', '6.0': '180', '6.1': '183', '6.2': '186' };
      const l = hevcLevels[hl.name] ?? '153';
      strings.push({ codecString: `hvc1.1.6.L${l}.B0`, profile: 'main', level: hl.name });
    }
    for (const s of strings) {
      let supported = false;
      let error: string | null = null;
      try {
        const res = await (VideoEncoder as any).isConfigSupported({ codec: s.codecString, width, height, bitrate, framerate: fps });
        supported = res?.supported === true;
      } catch (e: any) {
        error = `${e?.name}: ${String(e?.message ?? e)}`;
      }
      candidates.push({ codec, ...s, bitrate, supported, error });
      if (supported) {
        return { container, codec, codecString: s.codecString, width, height, bitrate, framerate: fps, level: s.level, profile: s.profile, bpp: bitrate / (width * height * fps), candidates };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------- input helpers

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
      const timing = await inspectTiming(videoTrack, 120);
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
        timing,
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

async function inspectTiming(videoTrack: any, maxPackets = 120) {
  const sink = new EncodedPacketSink(videoTrack);
  const timestamps: number[] = [];
  const durations: number[] = [];
  for await (const packet of sink.packets(undefined, undefined)) {
    timestamps.push(packet.timestamp);
    durations.push(packet.duration);
    if (timestamps.length >= maxPackets) break;
  }
  const sortedDur = [...durations].sort((a, b) => a - b);
  const minDur = sortedDur[0] ?? 0;
  const maxDur = sortedDur[sortedDur.length - 1] ?? 0;
  // packets arrive in decode order; B-frames make raw timestamps non-monotonic
  const ordered = [...timestamps].sort((a, b) => a - b);
  const deltas: number[] = [];
  for (let i = 1; i < ordered.length; i++) deltas.push(Number((ordered[i] - ordered[i - 1]).toFixed(6)));
  const mean = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : 0;
  const variance = deltas.length ? deltas.reduce((a, b) => a + (b - mean) ** 2, 0) / deltas.length : 0;
  return {
    sampledPackets: timestamps.length,
    firstTimestamps: timestamps.slice(0, 8),
    durationsMinMs: Number((minDur * 1000).toFixed(3)),
    durationsMaxMs: Number((maxDur * 1000).toFixed(3)),
    uniqueDurations: new Set(durations.map((d) => d.toFixed(4))).size,
    deltaStdMs: Number((Math.sqrt(variance) * 1000).toFixed(3)),
    variableFrameRate: (maxDur - minDur) > 0.001 || Math.sqrt(variance) > 0.001,
  };
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
      try {
        if (drawCanvas && drawCtx) sample.draw(drawCtx, 0, 0, drawCanvas.width, drawCanvas.height);
        else if (pipeline) {
          const src = sample.toCanvasImageSource();
          pipeline.render(src);
          pipeline.gl.finish();
        }
      } finally {
        sample.close();
      }
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

const activeRuns = new Map<string, AbortController>();

function cancelRun(runId: string) {
  const ac = activeRuns.get(runId);
  if (!ac) return false;
  ac.abort();
  return true;
}

function abortError() {
  return new DOMException('transcode cancelled', 'AbortError');
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw abortError();
}

interface SnapshotResult {
  timestamp: number;
  frameIndex: number;
  renderedBeforeCapture: boolean;
  sameFrame: boolean;
  pixelDiff: { samples: number; differingFrac: number; meanAbsCode: number; maxCode: number } | null;
  originalGrid: number[];
  gradedGrid: number[];
  original: any;
  graded: any;
}

function snapshotGrid(ctx: CanvasRenderingContext2D, width: number, height: number) {
  const grid: number[] = [];
  for (let gy = 0; gy < 3; gy++) {
    for (let gx = 0; gx < 3; gx++) {
      const x = Math.min(width - 1, Math.max(0, Math.round(((gx + 0.5) / 3) * width)));
      const y = Math.min(height - 1, Math.max(0, Math.round(((gy + 0.5) / 3) * height)));
      const d = ctx.getImageData(x, y, 1, 1).data;
      grid.push(d[0], d[1], d[2]);
    }
  }
  return grid;
}

function compareSnapshots(originalCtx: CanvasRenderingContext2D, gradedCtx: CanvasRenderingContext2D, width: number, height: number) {
  const a = originalCtx.getImageData(0, 0, width, height).data;
  const b = gradedCtx.getImageData(0, 0, width, height).data;
  let differing = 0, sum = 0, max = 0, samples = 0;
  for (let y = 0; y < height; y += 8) {
    for (let x = 0; x < width; x += 8) {
      const i = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const d = Math.abs(a[i + c] - b[i + c]);
        samples++;
        if (d > 0) { differing++; sum += d; if (d > max) max = d; }
      }
    }
  }
  return { samples, differingFrac: differing / samples, meanAbsCode: differing ? sum / differing : 0, maxCode: max };
}

interface TranscodeOptions {
  strength?: number;
  maxSeconds?: number;
  snapshotAt?: number;
  runId?: string;
  target?: 'auto' | 'harness' | 'buffer' | 'file';
  memoryBudgetMB?: number;
  outputName?: string;
  abortAfterMs?: number;
  includeOutputBase64?: boolean;
  key?: string;
}

interface TranscodeResult {
  ok: boolean;
  aborted?: boolean;
  error?: string;
  container?: string;
  videoCodec?: string | null;
  encoder?: EncoderChoice | null;
  frames?: number;
  audioPacketsCopied?: number;
  audioHash?: string | null;
  timing?: { wallMs: number; perFrameMs: { median: number; p95: number; max: number }; encodeAwaitMs: { median: number; p95: number; max: number }; fps: number };
  peakHeapDeltaMB?: number | null;
  heapSeries?: any[];
  heapSlopeMBPerMinute?: number | null;
  targetInfo?: any;
  outputFile?: string;
  output?: any;
  images?: Record<string, any>;
  snapshot?: SnapshotResult | null;
  assertions?: any;
  outputBase64?: string;
  quality?: any;
  inputInfo?: any;
  memory?: any;
}

async function transcode(path: string, opts: TranscodeOptions = {}): Promise<TranscodeResult> {
  const { input } = await openInput(path);
  const res: TranscodeResult = { ok: false };
  let pipeline: GlLutPipeline | null = null;
  let orientedCanvas: HTMLCanvasElement | null = null;
  const frameTimes: number[] = [];
  const encodeTimes: number[] = [];
  const heapSeries: any[] = [];
  const before = heap();
  let peak = before;
  const timer = setInterval(() => {
    const h = heap();
    if (h !== null) peak = Math.max(peak ?? 0, h);
  }, 20);
  let output: Output | null = null;
  let videoSource: CanvasSource | null = null;
  let audioSource: EncodedAudioPacketSource | null = null;
  const runId = opts.runId ?? `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const ac = new AbortController();
  activeRuns.set(runId, ac);
  let abortTimer = 0;
  if (opts.abortAfterMs) abortTimer = window.setTimeout(() => ac.abort(), opts.abortAfterMs);
  const budget = memoryBudgetMB(opts.memoryBudgetMB);
  res.memory = budget;
  try {
    const videoTrack = await input.getPrimaryVideoTrack();
    if (!videoTrack) throw new Error('no video track');
    if (!(await videoTrack.canDecode())) throw new Error('video track cannot be decoded by this browser');
    const audioTrack = await input.getPrimaryAudioTrack();
    const format = await input.getFormat();
    const container: 'mp4' | 'webm' = format.mimeType?.includes('webm') ? 'webm' : 'mp4';
    res.container = container;
    const timing = await inspectTiming(videoTrack, 120);
    const fpsStats = await videoTrack.computePacketStats(60);
    const rawRate = fpsStats?.averagePacketRate && Number.isFinite(fpsStats.averagePacketRate) ? fpsStats.averagePacketRate : 30;
    const fps = Math.max(1, Math.round(rawRate));
    const rotation = await videoTrack.getRotation();
    const width = videoTrack.displayWidth;
    const height = videoTrack.displayHeight;
    res.inputInfo = {
      codec: videoTrack.codec,
      codedWidth: videoTrack.codedWidth,
      codedHeight: videoTrack.codedHeight,
      displayWidth: width,
      displayHeight: height,
      rotation,
      averagePacketRate: Number(rawRate.toFixed(3)),
      vfr: timing.variableFrameRate,
      timing,
      audio: audioTrack ? { codec: audioTrack.codec, canDecode: await audioTrack.canDecode(), sampleRate: audioTrack.sampleRate, channels: audioTrack.numberOfChannels } : null,
      format: { name: format.name, mimeType: format.mimeType },
    };

    const encoder = await chooseEncoder(container, width, height, fps);
    if (!encoder) throw new Error(`no encodable ${container} video codec for ${width}x${height}@${fps}`);
    res.encoder = encoder;
    res.videoCodec = encoder.codec;

    const duration = await input.computeDuration();
    const estimateBytes = estimateEncodedBytes(encoder.bitrate, opts.maxSeconds ? Math.min(opts.maxSeconds, duration) : duration, audioTrack ? 192_000 : 0);
    const frameBytes = width * height * 4 * 3;
    const estimateMB = Number(((estimateBytes + frameBytes) / 1048576).toFixed(1));

    // Target selection: no whole-file Base64 in any product path.
    const detected = detectOutputTargets();
    const requested = opts.target ?? 'auto';
    let mode: 'harness-stream' | 'buffer' | 'file-picker' | 'unsupported' = 'buffer';
    if (requested === 'harness' || (requested === 'auto' && detected.harnessSink)) mode = 'harness-stream';
    else if (requested === 'file') mode = detected.showSaveFilePicker ? 'file-picker' : 'unsupported';
    else mode = 'buffer';
    res.targetInfo = { requested, mode, detected, estimateMB, budgetMB: budget.budgetMB, chunks: 0, bytes: 0, backpressureWrites: 0 };

    if (mode === 'unsupported') {
      const reason = !detected.showSaveFilePicker
        ? 'File System Access API is not available'
        : !detected.secureContext
          ? 'a secure context is required'
          : 'an active user gesture is required';
      throw new OutputTargetError(`file picker unavailable: ${reason}`, { mode, detected });
    }
    if (mode === 'buffer' && estimateMB > budget.budgetMB) {
      throw new MemoryBudgetError(`estimated output ${estimateMB}MB exceeds the ${budget.budgetMB}MB memory budget`, { estimateMB, budgetMB: budget.budgetMB, hint: 'use a streaming target or shorten the export' });
    }

    let outputFile: string | undefined;
    let target: any;
    if (mode === 'harness-stream') {
      const safeName = (opts.outputName ?? `out_${opts.key ?? 'video'}`).replace(/[^a-zA-Z0-9_.-]/g, '_');
      outputFile = `out/${safeName}.${container}`;
      const sink = (globalThis as any).__q03Sink as (b64: string, pos: number, file: string) => Promise<void>;
      let bytes = 0;
      let chunks = 0;
      let writes = 0;
      target = new StreamTarget(new WritableStream({
        write: async (chunk) => {
          await sink(bytesToBase64(chunk.data), chunk.position, outputFile!);
          bytes += chunk.data.byteLength;
          chunks++;
          writes++;
          res.targetInfo.bytes = bytes;
          res.targetInfo.chunks = chunks;
          res.targetInfo.backpressureWrites = writes;
        },
      }), { chunked: true, chunkSize: 1 << 20 });
    } else if (mode === 'file-picker') {
      const picker = (globalThis as any).showSaveFilePicker;
      let handle: any;
      try {
        handle = await picker({ suggestedName: `${opts.outputName ?? 'export'}.${container}` });
      } catch (e: any) {
        // Direct-save capability is only real once the picker returns a handle; a dismissed or
        // automation-blocked picker must degrade to an explicit target error, not a crash.
        throw new OutputTargetError(`file picker dismissed at runtime: ${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`, { mode, detected, pickerError: e?.name ?? null });
      }
      const writable = await handle.createWritable();
      target = new StreamTarget(writable, { chunked: true, chunkSize: 1 << 20 });
      res.outputFile = handle.name;
    } else {
      target = new BufferTarget();
    }
    res.outputFile = outputFile ?? res.outputFile;

    pipeline = new GlLutPipeline(width, height, opts.strength ?? 0.85);
    const outFormat = container === 'webm' ? new WebMOutputFormat() : new Mp4OutputFormat();
    output = new Output({ format: outFormat, target });
    videoSource = new CanvasSource(pipeline.canvas, { codec: encoder.codec, quality: new Quality('high'), keyFrameInterval: 2 });
    const videoMetadata: Record<string, any> = {};
    if (!timing.variableFrameRate) videoMetadata.frameRate = fps;
    output.addVideoTrack(videoSource, videoMetadata);
    if (audioTrack && audioTrack.codec) {
      audioSource = new EncodedAudioPacketSource(audioTrack.codec as any);
      output.addAudioTrack(audioSource);
    }
    await output.start();
    checkAbort(ac.signal);

    // Audio: encoded-packet passthrough, preserving timestamps and packet bytes.
    let audioPackets = 0;
    if (audioTrack && audioSource) {
      const audioSink = new EncodedPacketSink(audioTrack);
      const audioHashParts: Uint8Array[] = [];
      let hashBytes = 0;
      const decoderConfig = await audioTrack.getDecoderConfig();
      const audioStart = performance.now();
      for await (const packet of audioSink.packets()) {
        if (opts.maxSeconds && packet.timestamp > opts.maxSeconds) break;
        checkAbort(ac.signal);
        await audioSource.add(packet, audioPackets === 0 && decoderConfig ? { decoderConfig: decoderConfig as any } : undefined);
        audioPackets++;
        if (hashBytes < 8 * 1024 * 1024) {
          audioHashParts.push(packet.data.slice());
          hashBytes += packet.data.byteLength;
        }
      }
      res.audioPacketsCopied = audioPackets;
      (res as any).audioCopyMs = Number((performance.now() - audioStart).toFixed(1));
      const total = audioHashParts.reduce((n, p) => n + p.byteLength, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const p of audioHashParts) { merged.set(p, off); off += p.byteLength; }
      res.audioHash = await sha256Hex(merged);
    }

    const sink = new VideoSampleSink(videoTrack);
    const snapshotAt = opts.snapshotAt ?? 1.0;
    const images: Record<string, any> = {};
    let snapshot: SnapshotResult | null = null;
    const snapW = Math.min(1024, width);
    const needsOrientation = rotation !== 0 && rotation !== undefined;
    if (needsOrientation) {
      orientedCanvas = document.createElement('canvas');
      orientedCanvas.width = width;
      orientedCanvas.height = height;
    }
    const orientCtx = orientedCanvas?.getContext('2d', { willReadFrequently: true }) ?? null;
    let frames = 0;
    const wallStart = performance.now();
    for await (const sample of sink.samples(0, opts.maxSeconds)) {
      try {
        checkAbort(ac.signal);
        const t0 = performance.now();
        let src: CanvasImageSource;
        if (orientCtx && orientedCanvas && (sample.rotation !== 0 || sample.flip)) {
          sample.draw(orientCtx, 0, 0, orientedCanvas.width, orientedCanvas.height);
          src = orientedCanvas;
        } else {
          src = sample.toCanvasImageSource();
        }
        pipeline.render(src);
        pipeline.gl.finish();
        if (!snapshot && sample.timestamp >= snapshotAt) {
          const snapCanvas = document.createElement('canvas');
          snapCanvas.width = width;
          snapCanvas.height = height;
          const snapCtx = snapCanvas.getContext('2d', { willReadFrequently: true })!;
          // Capture the exact display-oriented image the pipeline rendered, so the original/graded
          // pixel compare cannot drift when rotation/flip handling differs between draw paths.
          snapCtx.drawImage(src, 0, 0, width, height);
          // The graded pixels come from the same render that is about to be encoded. A WebGL
          // canvas cannot hand out a 2d context, so copy it into one for the pixel comparison.
          const gradedCanvas = document.createElement('canvas');
          gradedCanvas.width = width;
          gradedCanvas.height = height;
          const gradedCtx = gradedCanvas.getContext('2d', { willReadFrequently: true })!;
          gradedCtx.drawImage(pipeline.canvas, 0, 0);
          snapshot = {
            timestamp: sample.timestamp,
            frameIndex: frames,
            renderedBeforeCapture: true,
            sameFrame: true,
            pixelDiff: compareSnapshots(snapCtx, gradedCtx, width, height),
            originalGrid: snapshotGrid(snapCtx, width, height),
            gradedGrid: snapshotGrid(gradedCtx, width, height),
            original: await downscaleToJPEG(snapCanvas, width, height, snapW, 0.85),
            graded: await downscaleToJPEG(gradedCanvas, width, height, snapW, 0.85),
          };
          images.original = snapshot.original;
          images.graded = snapshot.graded;
          snapCanvas.width = 1; snapCanvas.height = 1;
          gradedCanvas.width = 1; gradedCanvas.height = 1;
        }
        const encodeStart = performance.now();
        await videoSource.add(sample.timestamp, sample.duration);
        encodeTimes.push(performance.now() - encodeStart);
        frameTimes.push(performance.now() - t0);
        frames++;
        if (frames % 30 === 0) {
          const h = heapMB();
          heapSeries.push({ frame: frames, heapMB: h });
          if (before !== null && heap() !== null && (heap()! - before) > budget.budgetMB * 1048576) {
            throw new MemoryBudgetError(`heap grew beyond the ${budget.budgetMB}MB budget at frame ${frames}`, { budgetMB: budget.budgetMB, frame: frames, heapMB: h });
          }
          await new Promise((r) => setTimeout(r, 0));
        } else if (frames % 5 === 0) {
          await new Promise((r) => setTimeout(r, 0));
        }
        const h = heap();
        if (h !== null) peak = Math.max(peak ?? 0, h);
      } finally {
        sample.close();
      }
    }
    const wall = performance.now() - wallStart;
    checkAbort(ac.signal);
    if (!frameTimes.length) throw new Error('no frames decoded');
    await output.finalize();
    const targetBytes = mode === 'harness-stream' ? res.targetInfo.bytes : mode === 'buffer' ? (output.target as BufferTarget).buffer!.byteLength : null;
    res.images = images;
    res.frames = frames;
    res.snapshot = snapshot;
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
    res.targetInfo.bytes = targetBytes ?? res.targetInfo.bytes;
    res.output = {
      file: res.outputFile ?? null,
      bytes: targetBytes,
      mimeType: await output.getMimeType(),
      duration: duration,
    };
    if (mode === 'buffer') {
      const buffer = (output.target as BufferTarget).buffer!;
      const blob = new Blob([buffer], { type: res.output.mimeType });
      const verify = await verifyBlob(blob, path, { frames, maxSeconds: opts.maxSeconds, expectedWidth: width, expectedHeight: height, vfr: timing.variableFrameRate });
      res.assertions = verify.assertions;
      res.output.verified = verify.info;
      if (opts.includeOutputBase64) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        res.outputBase64 = bytesToBase64(bytes);
      }
    }
    res.heapSeries = heapSeries;
    res.heapSlopeMBPerMinute = heapSlope(heapSeries, res.timing.fps);
    res.ok = true;
    return res;
  } catch (e: any) {
    const aborted = e?.name === 'AbortError' || ac.signal.aborted;
    res.aborted = aborted;
    res.error = `${e?.name ?? 'Error'}: ${String(e?.message ?? e)}`;
    if (e instanceof MemoryBudgetError) (res as any).memoryBudgetDetail = e.detail;
    if (e instanceof OutputTargetError) (res as any).targetDetail = e.detail;
    try { if (output && output.state !== 'finalized' && output.state !== 'canceled') await output.cancel(); } catch {}
    return res;
  } finally {
    if (abortTimer) window.clearTimeout(abortTimer);
    activeRuns.delete(runId);
    clearInterval(timer);
    try { videoSource?.close(); } catch {}
    try { audioSource?.close(); } catch {}
    const h = heap();
    if (h !== null) peak = Math.max(peak ?? 0, h);
    res.peakHeapDeltaMB = before !== null && peak !== null ? Number(((peak - before) / 1048576).toFixed(1)) : null;
    pipeline?.destroy();
    if (orientedCanvas) { orientedCanvas.width = 1; orientedCanvas.height = 1; }
    try { (input as any).dispose?.(); } catch {}
  }
}

function heapSlope(series: any[], fps: number) {
  const pts = series.filter((p) => p.heapMB !== null);
  if (pts.length < 3 || !fps) return null;
  const n = pts.length;
  const meanX = pts.reduce((a, p) => a + p.frame, 0) / n;
  const meanY = pts.reduce((a, p) => a + p.heapMB, 0) / n;
  let num = 0, den = 0;
  for (const p of pts) {
    num += (p.frame - meanX) * (p.heapMB - meanY);
    den += (p.frame - meanX) ** 2;
  }
  if (den === 0) return null;
  const perFrame = num / den;
  return Number((perFrame * fps * 60).toFixed(2));
}

// ---------------------------------------------------------------- output verification (IMG-08)

async function collectPacketHash(track: any, maxTimestamp?: number) {
  const sink = new EncodedPacketSink(track);
  const parts: Uint8Array[] = [];
  let bytes = 0, packets = 0;
  for await (const packet of sink.packets()) {
    if (maxTimestamp !== undefined && packet.timestamp > maxTimestamp) break;
    if (bytes < 16 * 1024 * 1024) {
      parts.push(packet.data.slice());
      bytes += packet.data.byteLength;
    }
    packets++;
  }
  const merged = new Uint8Array(bytes);
  let off = 0;
  for (const p of parts) { merged.set(p, off); off += p.byteLength; }
  return { packets, bytes, hash: await sha256Hex(merged) };
}

async function verifyBlob(blob: Blob, inputPath: string, expect: { frames: number; maxSeconds?: number; expectedWidth?: number; expectedHeight?: number; vfr?: boolean }, opts: { decodeFrames?: boolean } = {}) {
  const verifyInput = new Input({ source: new BlobSource(blob), formats: ALL_FORMATS });
  const checks: any[] = [];
  const info: Record<string, any> = {};
  try {
    const vTrack = await verifyInput.getPrimaryVideoTrack();
    const aTrack = await verifyInput.getPrimaryAudioTrack();
    const vFirst = vTrack ? await new EncodedPacketSink(vTrack).getFirstPacket() : null;
    const aFirst = aTrack ? await new EncodedPacketSink(aTrack).getFirstPacket() : null;
    const vStats = vTrack ? await vTrack.computePacketStats() : null;
    const aStats = aTrack ? await aTrack.computePacketStats() : null;
    const vDuration = vTrack ? await vTrack.computeDuration() : null;
    const aDuration = aTrack ? await aTrack.computeDuration() : null;
    const totalDuration = await verifyInput.computeDuration();
    info.output = {
      mimeType: blob.type,
      bytes: blob.size,
      duration: totalDuration,
      videoCodec: vTrack ? await vTrack.getCodecParameterString() : null,
      audioCodec: aTrack ? await aTrack.getCodecParameterString() : null,
      codedWidth: vTrack?.codedWidth ?? null,
      codedHeight: vTrack?.codedHeight ?? null,
      displayWidth: vTrack?.displayWidth ?? null,
      displayHeight: vTrack?.displayHeight ?? null,
      rotation: vTrack ? await vTrack.getRotation() : null,
      firstVideoTimestamp: vFirst ? vFirst.timestamp : null,
      firstAudioTimestamp: aFirst ? aFirst.timestamp : null,
      avStartOffsetMs: vFirst && aFirst ? Number(((aFirst.timestamp - vFirst.timestamp) * 1000).toFixed(2)) : null,
      videoTrackDuration: vDuration,
      audioTrackDuration: aDuration,
      avEndDeltaMs: vDuration !== null && aDuration !== null ? Number(((aDuration - vDuration) * 1000).toFixed(2)) : null,
      outputVideoPacketCount: vStats?.packetCount ?? null,
      outputAudioPacketCount: aStats?.packetCount ?? null,
      variableFrameRate: vStats ? await inspectTiming(vTrack, 120) : null,
    };
    if (expect.expectedWidth && expect.expectedHeight) {
      checks.push({ name: 'display dimensions', expected: `${expect.expectedWidth}x${expect.expectedHeight}`, actual: `${info.output.displayWidth}x${info.output.displayHeight}`, pass: info.output.displayWidth === expect.expectedWidth && info.output.displayHeight === expect.expectedHeight });
    }
    checks.push({ name: 'video packet count == encoded frames', expected: expect.frames, actual: info.output.outputVideoPacketCount, pass: info.output.outputVideoPacketCount === expect.frames });
    // Input baseline: passthrough must preserve the input's own A/V offsets and audio bytes.
    let inputAv: { avStartOffsetMs: number | null; avEndDeltaMs: number | null } | null = null;
    let inputHash: { packets: number; bytes: number; hash: string } | null = null;
    let outHash: { packets: number; bytes: number; hash: string } | null = null;
    if (aTrack) {
      outHash = await collectPacketHash(aTrack, expect.maxSeconds);
      const { input } = await openInput(inputPath);
      try {
        const inTrack = await input.getPrimaryAudioTrack();
        const inV = await input.getPrimaryVideoTrack();
        if (inTrack) {
          inputHash = await collectPacketHash(inTrack, expect.maxSeconds);
          info.audio = { input: inputHash, output: outHash, hashMatch: inputHash.hash === outHash.hash && inputHash.packets === outHash.packets };
        }
        if (inV && inTrack) {
          const inVFirst = await new EncodedPacketSink(inV).getFirstPacket();
          const inAFirst = await new EncodedPacketSink(inTrack).getFirstPacket();
          const inVDuration = await inV.computeDuration();
          const inADuration = await inTrack.computeDuration();
          inputAv = {
            avStartOffsetMs: inVFirst && inAFirst ? Number(((inAFirst.timestamp - inVFirst.timestamp) * 1000).toFixed(2)) : null,
            avEndDeltaMs: inVDuration !== null && inADuration !== null ? Number(((inADuration - inVDuration) * 1000).toFixed(2)) : null,
          };
          info.inputAv = { ...inputAv, videoTrackDuration: inVDuration, audioTrackDuration: inADuration };
        }
      } finally {
        (input as any).dispose?.();
      }
    }
    if (info.output.avStartOffsetMs !== null) {
      if (inputAv?.avStartOffsetMs !== null && inputAv?.avStartOffsetMs !== undefined) {
        checks.push({ name: 'A/V start offset preserved from input (<=1ms)', expected: inputAv.avStartOffsetMs, actual: info.output.avStartOffsetMs, pass: Math.abs(info.output.avStartOffsetMs - inputAv.avStartOffsetMs) <= 1 });
      } else {
        checks.push({ name: 'A/V start offset <= 25ms', expected: '|offset| <= 25', actual: info.output.avStartOffsetMs, pass: Math.abs(info.output.avStartOffsetMs) <= 25 });
      }
    }
    if (info.output.avEndDeltaMs !== null) {
      if (!expect.maxSeconds && inputAv?.avEndDeltaMs !== null && inputAv?.avEndDeltaMs !== undefined) {
        checks.push({ name: 'A/V end delta preserved from input (<=5ms)', expected: inputAv.avEndDeltaMs, actual: info.output.avEndDeltaMs, pass: Math.abs(info.output.avEndDeltaMs - inputAv.avEndDeltaMs) <= 5 });
      } else if (!expect.maxSeconds) {
        checks.push({ name: 'A/V end delta <= 10ms', expected: '|delta| <= 10', actual: info.output.avEndDeltaMs, pass: Math.abs(info.output.avEndDeltaMs) <= 10 });
      }
    }
    if (outHash) {
      checks.push({ name: 'audio packet hash matches input (passthrough)', expected: inputHash?.hash ?? null, actual: outHash.hash, pass: !!inputHash && info.audio?.hashMatch === true });
    }

    const decodeFrames = opts.decodeFrames ?? (expect.frames <= 420);
    if (decodeFrames && vTrack && (await vTrack.canDecode())) {
      const sink = new VideoSampleSink(vTrack);
      let decoded = 0;
      let last = -Infinity;
      let monotonic = true;
      for await (const sample of sink.samples()) {
        try {
          if (sample.timestamp < last - 1e-6) monotonic = false;
          last = sample.timestamp;
          decoded++;
        } finally {
          sample.close();
        }
      }
      info.decodedFrames = decoded;
      checks.push({ name: 'decoded frame count == packet count', expected: info.output.outputVideoPacketCount, actual: decoded, pass: decoded === info.output.outputVideoPacketCount });
      checks.push({ name: 'output decode without error + monotonic timestamps', expected: 'true', actual: String(monotonic), pass: monotonic });
    } else if (vTrack && (await vTrack.canDecode())) {
      // Sparse check for long exports: first and last samples only.
      const sink = new VideoSampleSink(vTrack);
      const first = await sink.getSample(0);
      const last = await sink.getSample(Math.max(0, totalDuration - 0.001));
      let ok = !!first;
      try { first?.close(); } catch {}
      try { last?.close(); } catch {}
      if (!last) ok = false;
      checks.push({ name: 'first/last frame decodes (long export)', expected: 'true', actual: String(ok), pass: ok });
    }
    const pass = checks.every((c) => c.pass !== false);
    return { info, assertions: { pass, checks } };
  } finally {
    try { (verifyInput as any).dispose?.(); } catch {}
  }
}

async function verifyOutput(outputPath: string, inputPath: string, expect: { frames: number; maxSeconds?: number; expectedWidth?: number; expectedHeight?: number }) {
  const url = outputPath.startsWith('results/') ? `/${outputPath}` : `/testdata/${outputPath}`;
  const resp = await fetch(url);
  if (!resp.ok) return { ok: false, error: `fetch ${resp.status} for ${url}` };
  const blob = await resp.blob();
  const result = await verifyBlob(blob, inputPath, expect);
  return { ok: result.assertions.pass, ...result };
}

async function verifyOutputFile(outputPath: string, inputPath: string, expect: { frames: number; maxSeconds?: number; expectedWidth?: number; expectedHeight?: number }) {
  return verifyOutput(outputPath, inputPath, expect);
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
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const sink = new VideoSampleSink(track);
    for (const ts of timestamps) {
      const sample = await sink.getSample(ts);
      if (!sample) continue;
      try {
        sample.draw(ctx, 0, 0, canvas.width, canvas.height);
        imgs[`t${ts}`] = { ...(await downscaleToJPEG(canvas, canvas.width, canvas.height, 1024, 0.85)), grid: snapshotGrid(ctx, canvas.width, canvas.height), timestamp: sample.timestamp };
      } finally {
        sample.close();
      }
    }
    canvas.width = 1; canvas.height = 1;
    return { ok: true, images: imgs };
  } finally {
    try { (input as any).dispose?.(); } catch {}
  }
}

async function verifySnapshot(path: string, timestamp: number, originalGrid: number[], gradedGrid: number[]) {
  const { input } = await openInput(path);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track || !(await track.canDecode())) return { ok: false, error: 'video not decodable' };
    const canvas = document.createElement('canvas');
    canvas.width = track.displayWidth;
    canvas.height = track.displayHeight;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    const sink = new VideoSampleSink(track);
    const sample = await sink.getSample(timestamp);
    if (!sample) return { ok: false, error: 'no sample at timestamp' };
    try {
      sample.draw(ctx, 0, 0, canvas.width, canvas.height);
      const grid = snapshotGrid(ctx, canvas.width, canvas.height);
      const compare = (a: number[], b: number[]) => {
        let max = 0;
        for (let i = 0; i < a.length; i++) max = Math.max(max, Math.abs(a[i] - b[i]));
        return max;
      };
      const originalMaxDiff = compare(grid, originalGrid);
      const gradedMaxDiff = compare(grid, gradedGrid);
      return {
        ok: originalMaxDiff === 0,
        timestamp: sample.timestamp,
        independentOriginalMaxCodeDiff: originalMaxDiff,
        gradedDiffFromIndependentDecode: gradedMaxDiff,
        originalGrid,
        independentGrid: grid,
        gradedGrid,
        sameFrameVerified: originalMaxDiff === 0,
        gradingApplied: gradedMaxDiff > 0,
      };
    } finally {
      sample.close();
      canvas.width = 1; canvas.height = 1;
    }
  } finally {
    try { (input as any).dispose?.(); } catch {}
  }
}

(window as any).__poc = {
  capabilities,
  analyze,
  bench,
  transcode,
  verifyOutput: verifyOutputFile,
  verifySnapshot,
  snapshotFrames,
  cancelRun,
  ready: Promise.resolve(true),
};
log('video PoC ready');
