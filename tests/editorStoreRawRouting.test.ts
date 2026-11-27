import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedImage } from '../src/engine/image/decoder';
import type { DecodedSource } from '../src/engine/contracts/imageBuffer';
import { decodeEditorImage } from '../src/stores/editorStore';
import { decodeImageFile } from '../src/engine/image/decoder';
import { decodeRawToSource } from '../src/engine/raw';

vi.mock('../src/engine/image/decoder', () => ({ decodeImageFile: vi.fn() }));
vi.mock('../src/engine/raw', () => ({ decodeRawToSource: vi.fn() }));

const fakeRaw = {
  source: {
    id: 'raw-test',
    name: 'sample.cr3',
    mimeType: 'image/x-cr3',
    width: 4,
    height: 2,
    precision: 'hdr-linear16',
    hasAlpha: false,
    decoderId: 'flashraw@0.5.0',
  },
  working: {
    id: 'raw-test:working',
    sourceId: 'raw-test',
    width: 4,
    height: 2,
    format: 'rgba16f',
    colorSpace: 'linear-srgb',
    memoryBytes: 4 * 2 * 8,
    storage: 'cpu',
    data: new Uint16Array(4 * 2 * 4),
  },
  warnings: [],
} as unknown as DecodedSource;

let originalGetContext: typeof HTMLCanvasElement.prototype.getContext;
let originalCreateObjectURL: typeof URL.createObjectURL;

beforeEach(() => {
  vi.clearAllMocks();
  originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = ((type: string) => {
    if (type !== '2d') return null;
    return {
      createImageData: (width: number, height: number) => ({
        width,
        height,
        data: new Uint8ClampedArray(width * height * 4),
      }),
      putImageData: () => {},
    };
  }) as typeof HTMLCanvasElement.prototype.getContext;
  originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:raw-test');
});

afterEach(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
  URL.createObjectURL = originalCreateObjectURL;
});

describe('decodeEditorImage routing', () => {
  it('routes RAW files through the RAW decoder and returns the working source', async () => {
    vi.mocked(decodeRawToSource).mockResolvedValue(fakeRaw);
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.cr3', { type: 'image/x-cr3' });

    const result = await decodeEditorImage(file);

    expect(decodeRawToSource).toHaveBeenCalledWith(
      { data: file, name: 'sample.cr3', type: 'image/x-cr3', size: file.size },
      { signal: undefined },
    );
    expect(decodeImageFile).not.toHaveBeenCalled();
    expect(result.rawSource).toBe(fakeRaw);
    expect(result.image.originalWidth).toBe(4);
    expect(result.image.originalHeight).toBe(2);
    expect(result.image.previewWidth).toBe(4);
    expect(result.image.name).toBe('sample.cr3');
  });

  it('keeps JPEG/PNG/WebP on the existing decoder with no RAW source', async () => {
    const plainImage = { name: 'photo.jpg', sourceUrl: 'blob:jpeg' } as DecodedImage;
    vi.mocked(decodeImageFile).mockResolvedValue(plainImage);
    const file = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });

    const result = await decodeEditorImage(file);

    expect(result.image).toBe(plainImage);
    expect(result.rawSource).toBeNull();
    expect(decodeRawToSource).not.toHaveBeenCalled();
    expect(decodeImageFile).toHaveBeenCalledWith(file, 'photo.jpg', undefined);
  });

  it('propagates AbortError unchanged instead of wrapping it', async () => {
    const aborted = new DOMException('RAW decode cancelled', 'AbortError');
    vi.mocked(decodeRawToSource).mockRejectedValue(aborted);
    const controller = new AbortController();
    const file = new File(['raw'], 'sample.cr3', { type: 'image/x-cr3' });

    await expect(decodeEditorImage(file, controller.signal)).rejects.toBe(aborted);
    expect(decodeImageFile).not.toHaveBeenCalled();
  });
});
