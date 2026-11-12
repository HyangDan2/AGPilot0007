import { readCaptureDate } from './captureDate';
export interface DecodedImage {
  workspaceKey?: string;
  captureDate?: string;
  captureDateStatus?: 'available'|'missing'|'unreadable';
  sourceUrl: string;
  name: string;
  originalWidth: number;
  originalHeight: number;
  previewCanvas: HTMLCanvasElement;
  previewWidth: number;
  previewHeight: number;
  originalElement: HTMLImageElement;
}

export async function decodeImageFile(file: File | Blob, name = 'photo.jpg', signal?:AbortSignal): Promise<DecodedImage> {
  const metadata = await readCaptureDate(file);
  if(signal?.aborted)throw new DOMException('Image loading cancelled','AbortError');
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    const abort=()=>{img.onload=null;img.onerror=null;img.src='';URL.revokeObjectURL(objectUrl);reject(new DOMException('Image loading cancelled','AbortError'));};
    signal?.addEventListener('abort',abort,{once:true});
    img.onload = () => {
      signal?.removeEventListener('abort',abort);
      const originalWidth = img.naturalWidth || img.width;
      const originalHeight = img.naturalHeight || img.height;

      // Calculate preview dimensions (max 2048px on longest edge for high-speed preview)
      const maxDim = 2048;
      let pWidth = originalWidth;
      let pHeight = originalHeight;

      if (pWidth > maxDim || pHeight > maxDim) {
        if (pWidth >= pHeight) {
          pHeight = Math.round((pHeight * maxDim) / pWidth);
          pWidth = maxDim;
        } else {
          pWidth = Math.round((pWidth * maxDim) / pHeight);
          pHeight = maxDim;
        }
      }

      // Draw onto offscreen preview canvas
      const canvas = document.createElement('canvas');
      canvas.width = pWidth;
      canvas.height = pHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('Failed to create 2D canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, pWidth, pHeight);

      resolve({
        ...metadata,
        sourceUrl: objectUrl,
        name: (file as File).name || name,
        originalWidth,
        originalHeight,
        previewCanvas: canvas,
        previewWidth: pWidth,
        previewHeight: pHeight,
        originalElement: img,
      });
    };

    img.onerror = (err) => {
      signal?.removeEventListener('abort',abort);
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode image: ${err}`));
    };

    if(signal?.aborted){abort();return;}
    img.src = objectUrl;
  });
}
