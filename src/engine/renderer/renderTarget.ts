/** Owns one color render target (texture + framebuffer) with explicit release. */
export class RenderTarget {
  private texture: WebGLTexture | null = null;
  private framebuffer: WebGLFramebuffer | null = null;
  private key = '';

  constructor(private gl: WebGL2RenderingContext) {}

  get exists(): boolean {
    return this.texture !== null;
  }

  get colorTexture(): WebGLTexture | null {
    return this.texture;
  }

  get handle(): WebGLFramebuffer | null {
    return this.framebuffer;
  }

  /** Allocates or reuses the target for the given pixel size. */
  ensure(width: number, height: number): WebGLTexture {
    const gl = this.gl;
    const key = `${width}x${height}`;
    if (this.texture && this.framebuffer && this.key === key) return this.texture;

    this.dispose();
    const texture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!texture || !framebuffer) throw new Error('Sharpening buffer could not be allocated');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    const floating = !!gl.getExtension('EXT_color_buffer_float');
    gl.texImage2D(gl.TEXTURE_2D, 0, floating ? gl.RGBA16F : gl.RGBA8, width, height, 0, gl.RGBA, floating ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteTexture(texture);
      gl.deleteFramebuffer(framebuffer);
      throw new Error('Sharpening buffer could not be allocated');
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.texture = texture;
    this.framebuffer = framebuffer;
    this.key = key;
    return texture;
  }

  dispose(): void {
    if (this.texture) this.gl.deleteTexture(this.texture);
    if (this.framebuffer) this.gl.deleteFramebuffer(this.framebuffer);
    this.texture = null;
    this.framebuffer = null;
    this.key = '';
  }
}
