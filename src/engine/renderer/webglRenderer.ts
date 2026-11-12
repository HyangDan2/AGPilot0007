import { CameraSettings, DEFAULT_CAMERA } from '../../types/camera';
import { createDateStamp } from '../overlay/dateStamp';
import { VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE } from './shaderManager';
import { ParsedLut3D } from '../color/lutLoader';
import { AdjustmentSettings } from '../../types/film';

export interface RenderOptions {
  camera?: CameraSettings;
  adjustments: AdjustmentSettings;
  compareMode: 'none' | 'original' | 'split';
  splitPos: number; // 0.0 to 1.0
  seed?: number;
}

export class WebGL2FilmRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private imageTexture: WebGLTexture | null = null;
  private lutTexture: WebGLTexture | null = null;
  private stampTexture: WebGLTexture | null = null;
  private stampKey = '';
  private stampRect = [0,0,1,1];
  private quadBuffer: WebGLBuffer | null = null;
  private currentLutSize: number = 33;
  private isContextLost = false;
  private isInitialized = false;

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
    return this.isInitialized && !this.isContextLost && this.gl !== null && this.program !== null;
  }

  public getMaxTextureSize(): number {
    if (!this.gl || this.isContextLost) return 4096;
    return this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) || 4096;
  }

  public getMaxRenderbufferSize(): number {
    if (!this.gl || this.isContextLost) return 4096;
    return this.gl.getParameter(this.gl.MAX_RENDERBUFFER_SIZE) || 4096;
  }

  private initContext(): boolean {
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
      console.warn('WebGL2 context lost.');
      this.isContextLost = true;
      this.isInitialized = false;
    });

    this.canvas.addEventListener('webglcontextrestored', () => {
      console.log('WebGL2 context restored. Reinitializing pipeline...');
      this.imageTexture = null;
      this.lutTexture = null;
      this.stampTexture = null;
      this.stampKey = '';
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
      'u_image',
      'u_lut',
      'u_lut_size',
      'u_resolution',
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
      'u_seed', 'u_stamp', 'u_stamp_enabled', 'u_stamp_rect', 'u_optics', 'u_optical_samples',
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
      (typeof HTMLImageElement !== 'undefined' && imageSource instanceof HTMLImageElement) ||
      (typeof ImageBitmap !== 'undefined' && imageSource instanceof ImageBitmap);

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

  public render(options: RenderOptions) {
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

    const camera = options.camera || DEFAULT_CAMERA;
    const stamp = camera.dateStamp;
    const stampKey = JSON.stringify([this.canvas.width,this.canvas.height,stamp]);
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
      const patch = createDateStamp(this.canvas.width,this.canvas.height,stamp);
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

    // Pass uniforms
    if (this.uniforms.u_lut_size) gl.uniform1f(this.uniforms.u_lut_size, this.currentLutSize);
    if (this.uniforms.u_resolution) {
      gl.uniform2f(this.uniforms.u_resolution, this.canvas.width, this.canvas.height);
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

    // Draw
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
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
    const gl = this.gl;
    if (!gl) return;
    if (this.imageTexture) {
      gl.deleteTexture(this.imageTexture);
      this.imageTexture = null;
    }
    if (this.lutTexture) {
      gl.deleteTexture(this.lutTexture);
      this.lutTexture = null;
    }
    if (this.stampTexture) { gl.deleteTexture(this.stampTexture); this.stampTexture = null; }
    if (this.quadBuffer) { gl.deleteBuffer(this.quadBuffer); this.quadBuffer = null; }
    if (this.vao) { gl.deleteVertexArray(this.vao); this.vao = null; }
    if (this.program) {
      gl.deleteProgram(this.program);
      this.program = null;
    }
    this.isInitialized = false;
    this.gl = null;
  }
}
