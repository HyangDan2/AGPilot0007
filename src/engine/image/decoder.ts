export interface DecodedImage {
  sourceUrl: string;
  name: string;
  originalWidth: number;
  originalHeight: number;
  previewCanvas: HTMLCanvasElement;
  previewWidth: number;
  previewHeight: number;
  originalElement: HTMLImageElement;
}

export async function decodeImageFile(file: File | Blob, name = 'photo.jpg'): Promise<DecodedImage> {
  const objectUrl = URL.createObjectURL(file);

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
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
        reject(new Error('Failed to create 2D canvas context'));
        return;
      }
      ctx.drawImage(img, 0, 0, pWidth, pHeight);

      resolve({
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
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Failed to decode image: ${err}`));
    };

    img.src = objectUrl;
  });
}
