import { DecodedImage, resolveDecodedImageOriginal } from '../image/decoder';
import { ParsedLut3D } from '../color/lutLoader';
import { WebGL2FilmRenderer } from '../renderer/webglRenderer';
import type { RenderSettings } from '../pipeline/renderSettings';
import { ExportOptions, PreparedExport } from '../../types/export';
import { createAbortError, throwIfExportAborted, type ExportControl } from '../contracts/exportControl';
import { assertRenderPlanParity, runRenderPipeline } from '../pipeline/renderPipeline';
import { createWebGLPipelineBackend } from '../renderer/webglPipelineBackend';
import { createQ02RenderRegistry } from '../optical/modules';
import { geometryOutputSize } from '../optical/geometry';
import { renderTiled } from '../renderer/tiledExport';
import { renderLensTiled, shouldTileLensExport } from '../optical/lensTiledExport';
import { planLensBlur } from '../optical/lensBlur';
import { isNeutralLensBlur, type LensBlurPlan } from '../contracts/lensBlur';
import { budgetForDevice, detectDeviceCapabilities, estimateFrameBytes } from '../contracts/resourceBudget';

export type { ExportOptions, PreparedExport };

export interface ExportResult {
  blob: Blob;
  filename: string;
  width: number;
  height: number;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

/**
 * Prepares a fully rendered and encoded image in memory.
 * Returns a PreparedExport containing the Blob, File, object URL, and metadata,
 * ready for direct sharing, downloading, or previewing without re-rendering.
 */
export async function prepareExportImage(
  image: DecodedImage,
  lut: ParsedLut3D,
  settings: RenderSettings,
  options: ExportOptions,
  onProgress?: (progress: number, stage: string) => void,
  control?: ExportControl
): Promise<PreparedExport> {
  throwIfExportAborted(control?.signal);
  const registry = createQ02RenderRegistry();
  assertRenderPlanParity(settings, registry);
  onProgress?.(10, 'Initializing export pipeline...');

  // RAW keeps a preview canvas in originalElement; the resolver starts the
  // full-resolution develop. Failures propagate so a preview is never exported
  // silently in place of the original.
  const source = await resolveDecodedImageOriginal(image);

  // Geometry output (quarter turns swap axes, crop multiplies) is the export base.
  const output = geometryOutputSize(settings.geometry, image.originalWidth, image.originalHeight);
  const aspect = output.width / output.height;

  const scale = options.scale && options.scale > 0 && options.scale <= 1 ? options.scale : 1.0;
  let exportWidth = options.targetWidth ? Math.round(options.targetWidth) : Math.round(output.width * scale);
  let exportHeight = Math.round(exportWidth / aspect);

  // Create temporary probe canvas to inspect GPU constraints
  const probeCanvas = document.createElement('canvas');
  probeCanvas.width = 16;
  probeCanvas.height = 16;
  const glProbe = probeCanvas.getContext('webgl2');

  const maxTexSize = glProbe ? glProbe.getParameter(glProbe.MAX_TEXTURE_SIZE) || 4096 : 4096;
  const maxRenderSize = glProbe ? glProbe.getParameter(glProbe.MAX_RENDERBUFFER_SIZE) || 4096 : 4096;
  const maxSafeDim = Math.min(maxTexSize, maxRenderSize);
  glProbe?.getExtension('WEBGL_lose_context')?.loseContext();

  const encodeCanvas = (canvas: HTMLCanvasElement, width: number, height: number, cleanup: () => void) =>
    new Promise<PreparedExport>((resolve, reject) => {
      onProgress?.(90, `Encoding ${options.format === 'image/jpeg' ? 'JPEG' : 'PNG'} output...`);
      canvas.toBlob(
        (blob) => {
          cleanup();

          if (control?.signal?.aborted) {
            reject(createAbortError());
            return;
          }

          if (!blob || blob.size === 0) {
            reject(new Error('Failed to generate export image: blob was empty or encoding failed.'));
            return;
          }

          control?.onStage?.('complete');
          onProgress?.(100, 'Photo preparation complete!');
          const ext = options.format === 'image/jpeg' ? 'jpg' : 'png';
          const baseName = image.name.replace(/\.[^/.]+$/, '');
          const filename = `${baseName}_HD2Lab_FilmStudio.${ext}`;

          let file: File;
          try {
            file = new File([blob], filename, { type: options.format });
          } catch {
            file = Object.assign(blob, { name: filename, lastModified: Date.now() }) as any;
          }

          const objectUrl = URL.createObjectURL(blob);

          resolve({
            blob,
            file,
            objectUrl,
            filename,
            format: options.format,
            quality: options.quality,
            width,
            height,
            fileSize: blob.size,
            formattedSize: formatBytes(blob.size),
            createdAt: Date.now(),
          });
        },
        options.format,
        options.quality,
      );
    });

  // Frames that exceed the texture limit or the GPU budget render in tiles.
  // Scaled/target-wide requests keep the clamped path, which honors the size.
  const budget = budgetForDevice({ ...detectDeviceCapabilities(), maxTextureSize: maxSafeDim });
  const fullResRequest = (!options.scale || options.scale >= 1) && !options.targetWidth;
  const needsTiling =
    fullResRequest &&
    (Math.max(output.width, output.height) > maxSafeDim ||
      estimateFrameBytes(output.width, output.height, 'rgba8') > budget.maxGpuBytes);
  const local = settings.localAdjustments;
  const localActive = !!local && local.enabled && local.groups.some((group) => group.enabled);
  const lensActive = !!settings.lensBlur && !isNeutralLensBlur(settings.lensBlur);
  const renderLensInTiles = async () => {
    throwIfExportAborted(control?.signal);
    onProgress?.(30, 'Rendering lens blur in tiles...');
    control?.onStage?.('render');
    const tiled = await renderLensTiled({
      image,
      settings,
      maxTextureSize: maxSafeDim,
      budgetBytes: budget.maxGpuBytes,
      signal: control?.signal,
    });
    throwIfExportAborted(control?.signal);
    control?.onStage?.('encode');
    return encodeCanvas(tiled, output.width, output.height, () => {
      tiled.width = 1;
      tiled.height = 1;
    });
  };
  if (needsTiling) {
    if (settings.localStage || localActive) {
      throw new Error(
        'This export needs tiled rendering, which does not support local adjustments yet. Disable local adjustments or export at a smaller size.',
      );
    }
    if (lensActive) {
      return renderLensInTiles();
    }
    throwIfExportAborted(control?.signal);
    onProgress?.(30, 'Rendering large image in tiles...');
    control?.onStage?.('render');
    const tiled = await renderTiled({
      image,
      settings,
      maxTextureSize: maxSafeDim,
      budgetBytes: budget.maxGpuBytes,
      overlap: Math.max(8, Math.round(Math.min(output.width, output.height) * 0.004)),
    });
    throwIfExportAborted(control?.signal);
    control?.onStage?.('encode');
    return encodeCanvas(tiled, output.width, output.height, () => {
      tiled.width = 1;
      tiled.height = 1;
    });
  }

  // Large lens exports tile even when the frame fits, staying off the
  // full-resolution lens intermediate. Small exports keep the single pass.
  if (fullResRequest && lensActive && !settings.localStage && !localActive && shouldTileLensExport(output, maxSafeDim)) {
    return renderLensInTiles();
  }

  // If requested dimensions exceed GPU limits, safely constrain while strictly preserving aspect ratio
  if (exportWidth > maxSafeDim || exportHeight > maxSafeDim) {
    if (exportWidth >= exportHeight) {
      exportWidth = maxSafeDim;
      exportHeight = Math.round(exportWidth / aspect);
    } else {
      exportHeight = maxSafeDim;
      exportWidth = Math.round(exportHeight * aspect);
    }
    console.warn(`Export dimensions adjusted to GPU maximum: ${exportWidth}x${exportHeight} (device limit: ${maxSafeDim}px)`);
  }

  // Create dedicated offscreen canvas for export rendering
  const exportCanvas = document.createElement('canvas');
  exportCanvas.width = exportWidth;
  exportCanvas.height = exportHeight;

  onProgress?.(30, 'Allocating WebGL2 rendering surface...');

  const renderer = new WebGL2FilmRenderer(exportCanvas);
  if (!renderer.isReady()) {
    throw new Error('Failed to allocate WebGL2 export context on this device.');
  }
  const disposeRenderer = () => {
    renderer.destroy();
    exportCanvas.width = 1;
    exportCanvas.height = 1;
  };

  onProgress?.(50, 'Uploading image textures and 3D LUT...');
  renderer.setImage(source, exportWidth, exportHeight);
  renderer.setLut(lut);

  // Export quality gather at the final canvas size; the plan is transient and
  // never persisted. A null plan keeps the unmodified pipeline output.
  let lensStage: LensBlurPlan | null = null;
  if (settings.lensBlur && !isNeutralLensBlur(settings.lensBlur)) {
    lensStage = planLensBlur(
      { ...settings.lensBlur, quality: 'export' },
      { width: exportWidth, height: exportHeight },
      { maxTextureSize: maxTexSize },
    );
  }
  const pipelineSettings = lensStage ? { ...settings, lensStage } : settings;

  try {
    throwIfExportAborted(control?.signal);
    control?.onStage?.('render');
    onProgress?.(75, 'Applying film color science and tone curves...');
    await runRenderPipeline(
      {
        target: 'export',
        width: exportWidth,
        height: exportHeight,
        dpr: 1,
        settings: pipelineSettings,
        source,
        sourceWidth: image.originalWidth,
        sourceHeight: image.originalHeight,
        registry,
        signal: control?.signal,
        extras: {
          compareMode: 'none',
          splitPos: 1,
          seed: 42,
          sourceWidth: image.originalWidth,
          sourceHeight: image.originalHeight,
        },
      },
      createWebGLPipelineBackend(renderer),
    );
    throwIfExportAborted(control?.signal);
    control?.onStage?.('encode');
    throwIfExportAborted(control?.signal);
  } catch (error) {
    disposeRenderer();
    throw error;
  }

  return encodeCanvas(exportCanvas, exportWidth, exportHeight, disposeRenderer);
}

/**
 * Full resolution image export with the same shared render settings.
 */
export async function exportFullResolutionImage(
  image: DecodedImage,
  lut: ParsedLut3D,
  settings: RenderSettings,
  options: ExportOptions,
  onProgress?: (progress: number, stage: string) => void,
  control?: ExportControl
): Promise<ExportResult> {
  const prepared = await prepareExportImage(image, lut, settings, options, onProgress, control);
  return {
    blob: prepared.blob,
    filename: prepared.filename,
    width: prepared.width,
    height: prepared.height,
  };
}

/**
 * Robust cross-browser download trigger supporting iOS Safari, Android Chrome, and Desktop browsers.
 */
export function triggerSafeDownload(blob: Blob, filename: string): void {
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.rel = 'noopener';

  // For iOS Safari compatibility
  if (typeof navigator !== 'undefined' && navigator.userAgent.includes('Safari') && !navigator.userAgent.includes('Chrome')) {
    a.target = '_blank';
  }

  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke object URL after safe delay to allow download initiation
  setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 15000);
}
