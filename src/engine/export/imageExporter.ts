import {SharpeningSettings} from '../../types/sharpening';
import { ColorMixerSettings } from '../../types/colorMixer';
import { ToneCurves } from '../../types/curves';
import { CameraSettings } from '../../types/camera';
import { DecodedImage } from '../image/decoder';
import { ParsedLut3D } from '../color/lutLoader';
import { AdjustmentSettings, FilmId } from '../../types/film';
import { WebGL2FilmRenderer } from '../renderer/webglRenderer';
import { ExportOptions, PreparedExport } from '../../types/export';

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
  adjustments: AdjustmentSettings,
  options: ExportOptions,
  onProgress?: (progress: number, stage: string) => void,
  camera?: CameraSettings,
  filmId?: FilmId,
  curves?: ToneCurves,
  colorMixer?: ColorMixerSettings,
  sharpening?:SharpeningSettings
): Promise<PreparedExport> {
  onProgress?.(10, 'Initializing export pipeline...');

  // Target dimensions preserving exact aspect ratio
  const origW = image.originalWidth;
  const origH = image.originalHeight;
  const aspect = origW / origH;

  const scale = options.scale && options.scale > 0 && options.scale <= 1 ? options.scale : 1.0;
  let exportWidth = options.targetWidth ? Math.round(options.targetWidth) : Math.round(origW * scale);
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

  onProgress?.(50, 'Uploading image textures and 3D LUT...');
  renderer.setImage(image.originalElement, exportWidth, exportHeight);
  renderer.setLut(lut);

  onProgress?.(75, 'Applying film color science and tone curves...');
  renderer.render({
    adjustments,
    camera,
    filmId,
    curves,
    colorMixer,sharpening,sourceWidth:image.originalWidth,sourceHeight:image.originalHeight,
    compareMode: 'none',
    splitPos: 1.0,
    seed: 42.0,
  });

  onProgress?.(90, `Encoding ${options.format === 'image/jpeg' ? 'JPEG' : 'PNG'} output...`);

  return new Promise<PreparedExport>((resolve, reject) => {
    exportCanvas.toBlob(
      (blob) => {
        // Clean up GPU resources immediately
        renderer.destroy();
        exportCanvas.width = 1;
        exportCanvas.height = 1;

        if (!blob || blob.size === 0) {
          reject(new Error('Failed to generate export image: blob was empty or encoding failed.'));
          return;
        }

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
          width: exportWidth,
          height: exportHeight,
          fileSize: blob.size,
          formattedSize: formatBytes(blob.size),
          createdAt: Date.now(),
        });
      },
      options.format,
      options.quality
    );
  });
}

/**
 * Backward-compatible full resolution image export function.
 */
export async function exportFullResolutionImage(
  image: DecodedImage,
  lut: ParsedLut3D,
  adjustments: AdjustmentSettings,
  options: ExportOptions,
  onProgress?: (progress: number, stage: string) => void,
  camera?: CameraSettings,
  filmId?: FilmId,
  curves?: ToneCurves,
  colorMixer?: ColorMixerSettings,
  sharpening?:SharpeningSettings
): Promise<ExportResult> {
  const prepared = await prepareExportImage(image, lut, adjustments, options, onProgress, camera, filmId, curves, colorMixer,sharpening);
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
