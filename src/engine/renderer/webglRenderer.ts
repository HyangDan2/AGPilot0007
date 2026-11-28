import {normalizeSharpening} from '../../types/sharpening';
import {buildRGBBaseMatrix,hasRGBBaseEdits} from '../color/rgbBase';
import { MIXER_COLORS, normalizeColorMixer, hasColorMixerEdits } from '../../types/colorMixer';
import { buildCurveTexture, CURVE_SAMPLES } from '../color/userCurves';
import { getEffectiveCamera } from '../../films/cameraEffects';
import { createDateStamp } from '../overlay/dateStamp';
import { VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE } from './shaderManager';
import { LENS_BLUR_FRAGMENT } from '../optical/lensBlur';
import type { LensBlurPlan } from '../contracts/lensBlur';
import { ParsedLut3D } from '../color/lutLoader';
import { RenderTarget } from './renderTarget';
import type { RenderRequest } from '../pipeline/renderSettings';
import {
  localStageAdjustmentUniforms,
  localStageBlendCode,
  localStageTextureBudget,
  type LocalStagePlan,
} from '../local/maskRaster';

/** Post-pass vertex shader; attribute locations match the shared VAO slots. */
const LENS_VERTEX_SHADER_SOURCE = `#version 300 es
layout(location = 0) in vec2 a_position;
layout(location = 1) in vec2 a_uv;
out vec2 v_uv;
void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

/**
 * The lens blur chunk samples a scene texture in its own UV space where v=0 is
 * the bottom row, while the main pass writes v=0 at the top of the target, so
 * the wrapper flips v once and gathers in scene space (mirrors gradedAt).
 */
const lensFragmentShaderSource = (): string => `#version 300 es
precision highp float;
precision highp sampler2D;
in vec2 v_uv;
out vec4 fragColor;
${LENS_BLUR_FRAGMENT}
void main() {
    vec2 uv = vec2(v_uv.x, 1.0 - v_uv.y);
    vec4 scene = texture(u_q02_lens_scene, uv);
    fragColor = vec4(q02_lens_blur(scene.rgb, uv), scene.a);
}
`;

const LENS_UNIFORM_NAMES = [
  'u_q02_lens_scene', 'u_q02_lens_psf', 'u_q02_lens_depth', 'u_q02_lens_taps',
  'u_q02_lens_use_depth', 'u_q02_lens_aspect', 'u_q02_lens_focus_plane',
  'u_q02_lens_focus_range', 'u_q02_lens_falloff', 'u_q02_lens_max_coc',
  'u_q02_lens_guard', 'u_q02_lens_highlight_boost',
];

export class WebGL2FilmRenderer {
  private detailTarget: RenderTarget | null = null;
  private imageWidth=1;
  private imageHeight=1;
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private imageTexture: WebGLTexture | null = null;
  private lutTexture: WebGLTexture | null = null;
  private stampTexture: WebGLTexture | null = null;
  private stampKey = '';
  private curveTexture: WebGLTexture | null = null;
  private curveKey = '';
  private curvesEnabled = false;
  private localMaskTextures: (WebGLTexture | null)[] = [];
  private localPlan: LocalStagePlan | null = null;
  private localPlanMasks: HTMLCanvasElement[] = [];
  private localGroupCount = 0;
  private warnedLocalBudget = false;
  private lensSourceTarget: RenderTarget | null = null;
  private lensProgram: WebGLProgram | null = null;
  private lensUniforms: Record<string, WebGLUniformLocation | null> = {};
  private lensPsfTexture: WebGLTexture | null = null;
  private lensDepthTexture: WebGLTexture | null = null;
  private lensFallbackDepth: WebGLTexture | null = null;
  private lensUploadedPlan: LensBlurPlan | null = null;
  private lensDepthLinear = false;
  private stampRect = [0,0,1,1];
  private quadBuffer: WebGLBuffer | null = null;
  private currentLutSize: number = 33;
  private isContextLost = false;
  private isInitialized = false;
  private destroyed = false;

  private onContextRestoredCallback?: () => void;

  // Uniform locations cache
  private uniforms: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement, onContextRestored?: () => void) {
    this.canvas = canvas;
    this.onContextRestoredCallback = onContextRestored;
    this.initContext();
    this.setupContextLossHandling();
  }

  public isReady(): boolean {
    return !this.destroyed && this.isInitialized && !this.isContextLost && this.gl !== null && this.program !== null;
  }

  public getMaxTextureSize(): number {
    if (this.destroyed || !this.gl || this.isContextLost) return 4096;
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 4096;
  }

  public getMaxRenderbufferSize(): number {
    if (this.destroyed || !this.gl || this.isContextLost) return 4096;
    return this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) || 4096;
  }

  private initContext(): boolean {
    if (this.destroyed) return false;
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    });

    if (!gl) {
      console.error('WebGL2 is not supported in this browser.');
      this.isInitialized = false;
      return false;
    }

    this.gl = gl;
    this.isContextLost = false;
    this.initPipeline();
    return this.isInitialized;
  }

  private setupContextLossHandling() {
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      if (this.destroyed) return;
      console.warn('WebGL2 context lost.');
      this.isContextLost = true;
      this.isInitialized = false;
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      if (this.destroyed) return;
      console.log('WebGL2 context restored. Reinitializing pipeline...');
      this.detailTarget?.dispose();this.detailTarget=null;
      this.imageTexture = null;
      this.lutTexture = null;
      this.stampTexture = null;
      this.stampKey = '';
      this.curveTexture = null; this.curveKey = '';
      this.localMaskTextures = []; this.localPlan = null; this.localPlanMasks = []; this.localGroupCount = 0;
      this.lensSourceTarget?.dispose(); this.lensSourceTarget = null;
      this.lensProgram = null; this.lensUniforms = {};
      this.lensPsfTexture = null; this.lensDepthTexture = null; this.lensFallbackDepth = null;
      this.lensUploadedPlan = null;
      this.initContext();
      this.onContextRestoredCallback?.();
    });
  }

  private initPipeline() {
    const gl = this.gl;
    if (!gl) return;

    // Compile Vertex Shader
    const vs = gl.createShader(gl.VERTEX_SHADER);
    if (!vs) {
      console.error('Failed to create vertex shader');
      return;
    }
    gl.shaderSource(vs, VERTEX_SHADER_SOURCE);
    gl.compileShader(vs);
    if (!gl.getShaderParameter(vs, gl.COMPILE_STATUS)) {
      console.error('Vertex shader compilation failed:', gl.getShaderInfoLog(vs));
      gl.deleteShader(vs);
      return;
    }

    // Compile Fragment Shader
    const fs = gl.createShader(gl.FRAGMENT_SHADER);
    if (!fs) {
      console.error('Failed to create fragment shader');
      gl.deleteShader(vs);
      return;
    }
    gl.shaderSource(fs, FRAGMENT_SHADER_SOURCE);
    gl.compileShader(fs);
    if (!gl.getShaderParameter(fs, gl.COMPILE_STATUS)) {
      console.error('Fragment shader compilation failed:', gl.getShaderInfoLog(fs));
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }

    // Link Program
    const prog = gl.createProgram();
    if (!prog) {
      console.error('Failed to create shader program');
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      return;
    }
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('Shader program linking failed:', gl.getProgramInfoLog(prog));
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteProgram(prog);
      return;
    }
    this.program = prog;

    // Clean up detached shaders
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    // Cache uniforms
    const uniformNames = [
      'u_graded','u_detail_stage','u_detail','u_source_size','u_detail_mask','u_detail_fast',
      'u_image',
      'u_lut',
      'u_lut_size',
      'u_resolution',
      'u_tile_mode','u_tile_origin','u_tile_size','u_frame_size',
      'u_exposure',
      'u_temperature',
      'u_tint',
      'u_highlights',
      'u_shadows',
      'u_contrast',
      'u_saturation',
      'u_grain',
      'u_sharpness',
      'u_vignette',
      'u_film_strength',
      'u_compare_mode',
      'u_split_pos',
      'u_rgb_base_enabled','u_rgb_base_matrix','u_shadows_tint','u_mixer_enabled','u_mixer_reference','u_mix_bands[0]','u_point_count','u_point_color[0]','u_point_range[0]','u_point_shift[0]','u_mixer_visualize',
      'u_curves', 'u_curves_enabled', 'u_endpoints', 'u_seed', 'u_stamp', 'u_stamp_enabled', 'u_stamp_rect', 'u_optics', 'u_optical_samples',
      'u_q02_local_masks[0]', 'u_q02_local_group_count', 'u_q02_local_group_opacity[0]', 'u_q02_local_group_blend[0]',
      'u_q02_local_adjust_a[0]', 'u_q02_local_adjust_b[0]', 'u_q02_local_adjust_c[0]',
    ];
    for (const name of uniformNames) {
      this.uniforms[name] = gl.getUniformLocation(prog, name);
    }

    // Setup full-screen quad VAO
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    const quadBuffer = gl.createBuffer();
    this.quadBuffer = quadBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
    // x, y, u, v
    const vertices = new Float32Array([
      -1.0, -1.0, 0.0, 1.0, // bottom-left (OpenGL Y-inverted vs image coordinate)
       1.0, -1.0, 1.0, 1.0,
      -1.0,  1.0, 0.0, 0.0,
      -1.0,  1.0, 0.0, 0.0,
       1.0, -1.0, 1.0, 1.0,
       1.0,  1.0, 1.0, 0.0,
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

    const posLoc = gl.getAttribLocation(prog, 'a_position');
    const uvLoc = gl.getAttribLocation(prog, 'a_uv');

    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 16, 0);

    gl.enableVertexAttribArray(uvLoc);
    gl.vertexAttribPointer(uvLoc, 2, gl.FLOAT, false, 16, 8);

    gl.bindVertexArray(null);
    this.isInitialized = true;
  }

  public setImage(imageSource: TexImageSource | ArrayBufferView, width?: number, height?: number) {
    const gl = this.gl;
    if (!gl || this.isContextLost) return;

    if (!this.imageTexture) {
      this.imageTexture = gl.createTexture();
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Verify TexImageSource type to call the correct 6-argument overload
    const isDomSource =
      (typeof HTMLCanvasElement !== 'undefined' && imageSource instanceof HTMLCanvasElement) ||
      (typeof OffscreenCanvas !== 'undefined' && imageSource instanceof OffscreenCanvas) ||
      (typeof HTMLImageElement !== 'undefined' && imageSource instanceof HTMLImageElement) ||
      (typeof ImageBitmap !== 'undefined' && imageSource instanceof ImageBitmap) ||
      (typeof VideoFrame !== 'undefined' && imageSource instanceof VideoFrame);

    if (isDomSource) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        imageSource as TexImageSource
      );
    } else {
      const w = width ?? this.canvas.width;
      const h = height ?? this.canvas.height;
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        imageSource as ArrayBufferView
      );
    }

    const dom=imageSource as any;
    this.imageWidth=isDomSource?(dom.naturalWidth||dom.displayWidth||dom.width):(width||this.canvas.width);
    this.imageHeight=isDomSource?(dom.naturalHeight||dom.displayHeight||dom.height):(height||this.canvas.height);
    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.error('WebGL error during setImage (texImage2D):', err);
    }
  }

  public setLut(lut: ParsedLut3D) {
    const gl = this.gl;
    if (!gl || this.isContextLost) return;

    if (!this.lutTexture) {
      this.lutTexture = gl.createTexture();
    }

    this.currentLutSize = lut.size;

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    // Upload 3D RGBA texture
    gl.texImage3D(
      gl.TEXTURE_3D,
      0,
      gl.RGBA,
      lut.size,
      lut.size,
      lut.size,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      lut.rgbaData
    );

    const err = gl.getError();
    if (err !== gl.NO_ERROR) {
      console.error('WebGL error during setLut (texImage3D):', err);
    }
  }

  public render(options: RenderRequest) {
    const gl = this.gl;
    if (!gl || !this.program || !this.vao || this.isContextLost || !this.isInitialized) return;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.program);

    // Bind textures
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.imageTexture);
    if (this.uniforms.u_image) gl.uniform1i(this.uniforms.u_image, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    if (this.uniforms.u_lut) gl.uniform1i(this.uniforms.u_lut, 1);

    const camera = getEffectiveCamera(options.filmId, options.camera);
    const stamp = camera.dateStamp;
    // Tiled passes keep the stamp in full-frame coordinates so seams line up.
    const stampWidth = options.tile ? options.tile.frameWidth : this.canvas.width;
    const stampHeight = options.tile ? options.tile.frameHeight : this.canvas.height;
    const stampKey = JSON.stringify([stampWidth, stampHeight, stamp]);
    gl.activeTexture(gl.TEXTURE2);
    if (!this.stampTexture) {
      this.stampTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D,this.stampTexture);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array(4));
    }
    gl.bindTexture(gl.TEXTURE_2D,this.stampTexture);
    if (this.stampKey !== stampKey) {
      const patch = createDateStamp(stampWidth,stampHeight,stamp);
      if (patch) {
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,patch.canvas);
        this.stampRect = [patch.layout.x,patch.layout.y,patch.layout.width,patch.layout.height];
      }
      this.stampKey = stampKey;
    }
    gl.uniform1i(this.uniforms.u_stamp,2);
    gl.uniform1i(this.uniforms.u_stamp_enabled,stamp.enabled && !!stamp.date ? 1 : 0);
    gl.uniform4fv(this.uniforms.u_stamp_rect,this.stampRect);
    gl.uniform3f(this.uniforms.u_optics,camera.optics.glow/100,camera.optics.halation/100,camera.optics.softness/100);
    gl.uniform1i(this.uniforms.u_optical_samples,camera.optics.quality === 'high' ? 8 : 4);

    gl.activeTexture(gl.TEXTURE3);
    if (!this.curveTexture) {
      this.curveTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
    gl.bindTexture(gl.TEXTURE_2D, this.curveTexture);
    const curveKey = JSON.stringify(options.curves || null);
    if (curveKey !== this.curveKey) {
      const texture = buildCurveTexture(options.curves);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, CURVE_SAMPLES, 1, 0, gl.RGBA, gl.FLOAT, texture.data);
      this.curvesEnabled = texture.enabled; this.curveKey = curveKey;
    }
    gl.uniform1i(this.uniforms.u_curves, 3);
    gl.uniform1i(this.uniforms.u_curves_enabled, this.curvesEnabled ? 1 : 0);
    gl.uniform2f(this.uniforms.u_endpoints, (options.adjustments.blacks || 0)/100, (options.adjustments.whites || 0)/100);
    const mixer=normalizeColorMixer(options.colorMixer);
    gl.uniform1i(this.uniforms.u_rgb_base_enabled,mixer.enabled&&hasRGBBaseEdits(mixer.rgbBase)?1:0);
    gl.uniformMatrix3fv(this.uniforms.u_rgb_base_matrix,false,buildRGBBaseMatrix(mixer.rgbBase));
    gl.uniform1f(this.uniforms.u_shadows_tint,mixer.rgbBase.shadowsTint/100);
    gl.uniform1i(this.uniforms.u_mixer_enabled,hasColorMixerEdits(mixer)?1:0);
    gl.uniform1i(this.uniforms.u_mixer_reference,options.mixerReference?1:0);
    gl.uniform3fv(this.uniforms['u_mix_bands[0]'],MIXER_COLORS.flatMap(c=>[mixer.bands[c].hue/1200,mixer.bands[c].saturation/100,mixer.bands[c].luminance/100]));
    gl.uniform1i(this.uniforms.u_point_count,mixer.points.length);
    const colors=new Float32Array(24),ranges=new Float32Array(32),shifts=new Float32Array(32);
    mixer.points.forEach((p,i)=>{colors.set(p.color,i*3);ranges.set([p.range.hue/360,p.range.saturation/100,p.range.luminance/100,p.feather/100],i*4);shifts.set([p.shift.hue/200,p.shift.saturation/100,p.shift.luminance/100,p.enabled&&(p.shift.hue!==0||p.shift.saturation!==0||p.shift.luminance!==0)?1:0],i*4);});
    gl.uniform3fv(this.uniforms['u_point_color[0]'],colors);gl.uniform4fv(this.uniforms['u_point_range[0]'],ranges);gl.uniform4fv(this.uniforms['u_point_shift[0]'],shifts);
    gl.uniform1i(this.uniforms.u_mixer_visualize,options.mixerVisualize?mixer.points.findIndex(p=>p.id===options.mixerVisualize):-1);
    // Pass uniforms
    if (this.uniforms.u_lut_size) gl.uniform1f(this.uniforms.u_lut_size, this.currentLutSize);
    if (this.uniforms.u_resolution) {
      gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
    }
    const tile = options.tile;
    gl.uniform1i(this.uniforms.u_tile_mode, tile ? 1 : 0);
    if (tile) {
      gl.uniform2f(this.uniforms.u_tile_origin, tile.x, tile.y);
      gl.uniform2f(this.uniforms.u_tile_size, tile.width, tile.height);
      gl.uniform2f(this.uniforms.u_frame_size, tile.frameWidth, tile.frameHeight);
    }

    const adj = options.adjustments;
    if (this.uniforms.u_exposure) gl.uniform1f(this.uniforms.u_exposure, adj.exposure);
    if (this.uniforms.u_temperature) gl.uniform1f(this.uniforms.u_temperature, adj.temperature / 100.0);
    if (this.uniforms.u_tint) gl.uniform1f(this.uniforms.u_tint, adj.tint / 100.0);
    if (this.uniforms.u_highlights) gl.uniform1f(this.uniforms.u_highlights, adj.highlights / 100.0);
    if (this.uniforms.u_shadows) gl.uniform1f(this.uniforms.u_shadows, adj.shadows / 100.0);
    if (this.uniforms.u_contrast) gl.uniform1f(this.uniforms.u_contrast, adj.contrast / 100.0);
    if (this.uniforms.u_saturation) gl.uniform1f(this.uniforms.u_saturation, adj.saturation / 100.0);
    if (this.uniforms.u_grain) gl.uniform1f(this.uniforms.u_grain, adj.grain / 100.0);
    if (this.uniforms.u_sharpness) gl.uniform1f(this.uniforms.u_sharpness, adj.sharpness / 100.0);
    if (this.uniforms.u_vignette) gl.uniform1f(this.uniforms.u_vignette, adj.vignette / 100.0);
    if (this.uniforms.u_film_strength) gl.uniform1f(this.uniforms.u_film_strength, adj.filmStrength / 100.0);

    const compareModeInt = options.compareMode === 'original' ? 1 : options.compareMode === 'split' ? 2 : 0;
    if (this.uniforms.u_compare_mode) gl.uniform1i(this.uniforms.u_compare_mode, compareModeInt);
    if (this.uniforms.u_split_pos) gl.uniform1f(this.uniforms.u_split_pos, options.splitPos);
    if (this.uniforms.u_seed) gl.uniform1f(this.uniforms.u_seed, options.seed ?? 42.0);

    const sharpening=normalizeSharpening(options.sharpening,adj.sharpness);
    if(this.uniforms.u_sharpness)gl.uniform1f(this.uniforms.u_sharpness,sharpening.mode==='legacy'?sharpening.amount/100:0);
    const detail=(options.sharpeningMask||sharpening.mode==='advanced'&&sharpening.amount>0)&&!options.mixerReference&&!options.mixerVisualize&&options.compareMode!=='original';
    gl.uniform1i(this.uniforms.u_detail_fast,options.sharpeningDraft?1:0);
    gl.uniform1i(this.uniforms.u_detail_stage,0);
    gl.uniform1i(this.uniforms.u_detail_mask,options.sharpeningMask?1:0);
    gl.uniform4f(this.uniforms.u_detail,sharpening.amount/100,sharpening.radius,sharpening.detail/100,sharpening.masking/100);
    gl.uniform2f(this.uniforms.u_source_size,options.sourceWidth||this.imageWidth,options.sourceHeight||this.imageHeight);
    // Must precede the detail pre-pass, which applies the local stage inside grade.
    this.applyLocalStage(gl, options.localStage ?? null);
    if(detail){
      this.ensureDetailTarget();
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,null);gl.uniform1i(this.uniforms.u_graded,4);
      gl.bindFramebuffer(gl.FRAMEBUFFER,this.detailTarget!.handle);
      gl.uniform1i(this.uniforms.u_detail_stage,1);
      gl.bindVertexArray(this.vao);gl.drawArrays(gl.TRIANGLES,0,6);
      gl.bindFramebuffer(gl.FRAMEBUFFER,null);
      gl.activeTexture(gl.TEXTURE4);gl.bindTexture(gl.TEXTURE_2D,this.detailTarget!.colorTexture);gl.uniform1i(this.uniforms.u_graded,4);
      gl.uniform1i(this.uniforms.u_detail_stage,2);
    }else if(this.detailTarget&&!options.mixerReference&&!options.mixerVisualize&&sharpening.amount===0&&!options.sharpeningMask){this.detailTarget.dispose();this.detailTarget=null;}
    const lens = options.lensStage && options.lensStage.tapCount >= 2 ? options.lensStage : null;
    if (lens) {
      this.lensSourceTarget ??= new RenderTarget(gl);
      this.lensSourceTarget.ensure(this.canvas.width, this.canvas.height);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.lensSourceTarget.handle);
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    // Draw
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    if (lens) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      this.applyLensPass(gl, lens);
    }
  }

  private ensureLensProgram(gl: WebGL2RenderingContext): WebGLProgram {
    if (this.lensProgram) return this.lensProgram;
    const compile = (type: number, source: string, label: string): WebGLShader => {
      const shader = gl.createShader(type);
      if (!shader) throw new Error(`Lens blur ${label} shader could not be created`);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader);
        gl.deleteShader(shader);
        throw new Error(`Lens blur ${label} shader failed to compile: ${log || 'unknown error'}`);
      }
      return shader;
    };
    const vs = compile(gl.VERTEX_SHADER, LENS_VERTEX_SHADER_SOURCE, 'vertex');
    const fs = compile(gl.FRAGMENT_SHADER, lensFragmentShaderSource(), 'fragment');
    const program = gl.createProgram();
    if (!program) {
      gl.deleteShader(vs); gl.deleteShader(fs);
      throw new Error('Lens blur program could not be created');
    }
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs); gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error(`Lens blur program failed to link: ${log || 'unknown error'}`);
    }
    this.lensUniforms = {};
    for (const name of LENS_UNIFORM_NAMES) this.lensUniforms[name] = gl.getUniformLocation(program, name);
    this.lensDepthLinear = !!gl.getExtension('OES_texture_float_linear');
    this.lensProgram = program;
    return program;
  }

  /**
   * Runs the Q02 gather from the intermediate graded target to the canvas.
   * Plans are uploaded once per object; repeat frames rebind the same textures.
   */
  private applyLensPass(gl: WebGL2RenderingContext, plan: LensBlurPlan) {
    const scene = this.lensSourceTarget?.colorTexture;
    if (!scene) return;
    const program = this.ensureLensProgram(gl);
    const u = this.lensUniforms;
    gl.useProgram(program);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, scene);
    gl.uniform1i(u.u_q02_lens_scene, 0);

    if (!this.lensPsfTexture) {
      this.lensPsfTexture = gl.createTexture();
    }
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.lensPsfTexture);
    if (this.lensUploadedPlan !== plan) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      // The chunk gathers in scene space where +v points image-up, but the CPU
      // reference applies tap dy top-down; mirror dy once per plan.
      const psf = new Float32Array(plan.psf.length);
      psf.set(plan.psf);
      for (let i = 1; i < psf.length; i += 4) psf[i] = -plan.psf[i];
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, 64, 1, 0, gl.RGBA, gl.FLOAT, psf);
    }
    gl.uniform1i(u.u_q02_lens_psf, 1);

    gl.activeTexture(gl.TEXTURE2);
    if (plan.depth) {
      if (!this.lensDepthTexture) this.lensDepthTexture = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.lensDepthTexture);
      if (this.lensUploadedPlan !== plan) {
        const filter = this.lensDepthLinear ? gl.LINEAR : gl.NEAREST;
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        // plan.depth is top-down row-major, while the wrapper samples the
        // scene target's v=1 at image top. UNPACK_FLIP_Y_WEBGL is ignored for
        // ArrayBufferView uploads (and other paths need it false), so flip the
        // rows into a scratch array before upload.
        const { width, height } = plan;
        const flipped = new Float32Array(plan.depth.length);
        for (let row = 0; row < height; row++) {
          flipped.set(plan.depth.subarray(row * width, (row + 1) * width), (height - 1 - row) * width);
        }
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, width, height, 0, gl.RED, gl.FLOAT, flipped);
      }
      gl.uniform1i(u.u_q02_lens_use_depth, 1);
    } else {
      if (!this.lensFallbackDepth) {
        this.lensFallbackDepth = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, this.lensFallbackDepth);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
      } else {
        gl.bindTexture(gl.TEXTURE_2D, this.lensFallbackDepth);
      }
      gl.uniform1i(u.u_q02_lens_use_depth, 0);
    }
    gl.uniform1i(u.u_q02_lens_depth, 2);

    gl.uniform1i(u.u_q02_lens_taps, Math.min(plan.tapCount, 64));
    gl.uniform1f(u.u_q02_lens_aspect, plan.width / plan.height);
    gl.uniform1f(u.u_q02_lens_focus_plane, plan.focusPlane);
    gl.uniform1f(u.u_q02_lens_focus_range, plan.focusRange);
    gl.uniform1f(u.u_q02_lens_falloff, plan.falloff);
    gl.uniform1f(u.u_q02_lens_max_coc, plan.maxCocShortSide);
    gl.uniform4f(u.u_q02_lens_guard, plan.guardBand, plan.depth ? plan.guardStrength : 0, 0, 0);
    gl.uniform1f(u.u_q02_lens_highlight_boost, plan.highlightBoost);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
    this.lensUploadedPlan = plan;
  }

  /**
   * Binds Q02 mask canvases from texture unit 5 upward and uploads the group
   * uniforms. Without an active plan the CP2 path stays untouched: the group
   * count is only reset when it was raised before, so inert frames issue no
   * local-stage GL calls at all.
   */
  private applyLocalStage(gl: WebGL2RenderingContext, plan: LocalStagePlan | null) {
    const countLocation = this.uniforms.u_q02_local_group_count;
    if (!countLocation) return;
    if (!plan || plan.groups.length === 0) {
      if (this.localGroupCount !== 0) {
        gl.uniform1i(countLocation, 0);
        this.localGroupCount = 0;
      }
      this.localPlan = null;
      return;
    }
    const budget = localStageTextureBudget(gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS) as number);
    const count = Math.min(plan.groups.length, budget.groupLimit);
    if (count === 0) {
      if (!this.warnedLocalBudget) {
        this.warnedLocalBudget = true;
        console.warn('Local stage skipped: this device has no texture units above the base pipeline.');
      }
      if (this.localGroupCount !== 0) {
        gl.uniform1i(countLocation, 0);
        this.localGroupCount = 0;
      }
      this.localPlan = null;
      return;
    }

    const planChanged = this.localPlan !== plan;
    const masksChanged = planChanged || plan.masks.some((mask, index) => this.localPlanMasks[index] !== mask);
    if (planChanged || masksChanged) {
      for (let index = 0; index < count; index++) {
        let texture = this.localMaskTextures[index];
        if (!texture) {
          texture = gl.createTexture();
          if (!texture) continue;
          this.localMaskTextures[index] = texture;
        }
        gl.activeTexture(gl.TEXTURE0 + budget.base + index);
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, plan.masks[index]);
      }
      this.localPlan = plan;
      this.localPlanMasks = plan.masks.slice();
    }

    const units = new Int32Array(8);
    for (let index = 0; index < 8; index++) units[index] = budget.base + Math.min(index, count - 1);
    gl.uniform1iv(this.uniforms['u_q02_local_masks[0]'], units);

    const opacity = new Float32Array(8);
    const blend = new Int32Array(8);
    const adjustA = new Float32Array(32);
    const adjustB = new Float32Array(32);
    const adjustC = new Float32Array(32);
    for (let index = 0; index < count; index++) {
      const group = plan.groups[index];
      opacity[index] = group.opacity;
      blend[index] = localStageBlendCode(group.blend);
      const values = localStageAdjustmentUniforms(group.adjustment);
      adjustA.set(values.a, index * 4);
      adjustB.set(values.b, index * 4);
      adjustC.set(values.c, index * 4);
    }
    gl.uniform1i(countLocation, count);
    this.localGroupCount = count;
    gl.uniform1fv(this.uniforms['u_q02_local_group_opacity[0]'], opacity);
    gl.uniform1iv(this.uniforms['u_q02_local_group_blend[0]'], blend);
    gl.uniform4fv(this.uniforms['u_q02_local_adjust_a[0]'], adjustA);
    gl.uniform4fv(this.uniforms['u_q02_local_adjust_b[0]'], adjustB);
    gl.uniform4fv(this.uniforms['u_q02_local_adjust_c[0]'], adjustC);
  }

  private ensureDetailTarget(){
    const gl=this.gl!;
    this.detailTarget??=new RenderTarget(gl);
    gl.activeTexture(gl.TEXTURE4);
    this.detailTarget.ensure(this.canvas.width,this.canvas.height);
  }
  /**
   * Reads raw pixel data from canvas framebuffer for testing and verification.
   */
  public readPixels(x: number, y: number, w: number, h: number): Uint8Array | null {
    const gl = this.gl;
    if (!gl || this.isContextLost) return null;
    const pixels = new Uint8Array(w * h * 4);
    gl.readPixels(x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  }

  public destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    const gl = this.gl;
    if (!gl) return;
    if(this.detailTarget){this.detailTarget.dispose();this.detailTarget=null;}
    if (this.imageTexture) {
      gl.deleteTexture(this.imageTexture);
      this.imageTexture = null;
    }
    if (this.lutTexture) {
      gl.deleteTexture(this.lutTexture);
      this.lutTexture = null;
    }
    if (this.stampTexture) { gl.deleteTexture(this.stampTexture); this.stampTexture = null; }
    if (this.curveTexture) { gl.deleteTexture(this.curveTexture); this.curveTexture = null; }
    for (const texture of this.localMaskTextures) { if (texture) gl.deleteTexture(texture); }
    this.localMaskTextures = []; this.localPlan = null; this.localPlanMasks = []; this.localGroupCount = 0;
    if (this.lensSourceTarget) { this.lensSourceTarget.dispose(); this.lensSourceTarget = null; }
    if (this.lensPsfTexture) { gl.deleteTexture(this.lensPsfTexture); this.lensPsfTexture = null; }
    if (this.lensDepthTexture) { gl.deleteTexture(this.lensDepthTexture); this.lensDepthTexture = null; }
    if (this.lensFallbackDepth) { gl.deleteTexture(this.lensFallbackDepth); this.lensFallbackDepth = null; }
    if (this.lensProgram) { gl.deleteProgram(this.lensProgram); this.lensProgram = null; }
    this.lensUniforms = {}; this.lensUploadedPlan = null;
    if (this.quadBuffer) { gl.deleteBuffer(this.quadBuffer); this.quadBuffer = null; }
    if (this.vao) { gl.deleteVertexArray(this.vao); this.vao = null; }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    // Export canvases are single-use and detached; without an explicit loss
    // Chromium keeps the context alive and repeated export/cancel cycles
    // exhaust the page's budget. Attached canvases (viewport, loupe) may be
    // reused by a new renderer, so their context must stay restorable.
    const lose = gl.getExtension('WEBGL_lose_context');
    if (lose && !this.canvas.isConnected) lose.loseContext();
    this.isInitialized = false;
    this.gl = null;
  }
}
