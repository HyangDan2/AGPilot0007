import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DecodedImage } from '../src/engine/image/decoder';
import type { DecodedSource } from '../src/engine/contracts/imageBuffer';
import { decodeEditorImage } from '../src/stores/editorStore';
import { decodeImageFile } from '../src/engine/image/decoder';
import { openRawForEditing } from '../src/engine/raw';

vi.mock('../src/engine/image/decoder', () => ({ decodeImageFile: vi.fn() }));
vi.mock('../src/engine/raw', () => ({ openRawForEditing: vi.fn() }));

const fakeSource = {
  id: 'raw-test',
  name: 'sample.cr3',
  mimeType: 'image/x-cr3',
  width: 3000,
  height: 2000,
  precision: 'hdr-linear16',
  hasAlpha: false,
  decoderId: 'raw-develop@1.0.0',
  working: {
    id: 'raw-test:working',
    sourceId: 'raw-test',
    width: 3000,
    height: 2000,
    format: 'rgba16f',
    colorSpace: 'linear-srgb',
    memoryBytes: 3000 * 2000 * 8,
    storage: 'cpu',
    data: new Uint16Array(4),
  },
  warnings: [],
} as unknown as DecodedSource;

const fakeImage = {
  name: 'sample.cr3',
  sourceUrl: 'blob:raw-test',
  originalWidth: 6000,
  originalHeight: 4000,
  previewCanvas: {},
  previewWidth: 2048,
  previewHeight: 1365,
  originalElement: {},
  resolveOriginal: () => Promise.resolve({} as HTMLImageElement),
} as unknown as DecodedImage;

const opened = {
  source: fakeSource,
  image: fakeImage,
  report: { warnings: [] },
  width: 6000,
  height: 4000,
  memory: { totalBytes: 1, withinOpenLimit: true },
} as unknown as Awaited<ReturnType<typeof openRawForEditing>>;

let originalCreateObjectURL: typeof URL.createObjectURL;

beforeEach(() => {
  vi.clearAllMocks();
  originalCreateObjectURL = URL.createObjectURL;
  URL.createObjectURL = vi.fn(() => 'blob:raw-test');
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
});

describe('decodeEditorImage routing', () => {
  it('routes RAW files through the develop seam and returns its source', async () => {
    vi.mocked(openRawForEditing).mockResolvedValue(opened);
    const file = new File([new Uint8Array([1, 2, 3])], 'sample.cr3', { type: 'image/x-cr3' });

    const result = await decodeEditorImage(file);

    expect(openRawForEditing).toHaveBeenCalledWith(
      { data: file, name: 'sample.cr3', type: 'image/x-cr3', size: file.size },
      { signal: undefined },
    );
    expect(decodeImageFile).not.toHaveBeenCalled();
    expect(result.rawSource).toBe(fakeSource);
    expect(result.image).toBe(fakeImage);
    expect(result.image.originalWidth).toBe(6000);
    expect(result.image.previewWidth).toBe(2048);
  });

  it('keeps JPEG/PNG/WebP on the existing decoder with no RAW source', async () => {
    const plainImage = { name: 'photo.jpg', sourceUrl: 'blob:jpeg' } as DecodedImage;
    vi.mocked(decodeImageFile).mockResolvedValue(plainImage);
    const file = new File(['jpeg'], 'photo.jpg', { type: 'image/jpeg' });

    const result = await decodeEditorImage(file);

    expect(result.image).toBe(plainImage);
    expect(result.rawSource).toBeNull();
    expect(openRawForEditing).not.toHaveBeenCalled();
    expect(decodeImageFile).toHaveBeenCalledWith(file, 'photo.jpg', undefined);
  });

  it('propagates AbortError unchanged instead of wrapping it', async () => {
    const aborted = new DOMException('RAW decode cancelled', 'AbortError');
    vi.mocked(openRawForEditing).mockRejectedValue(aborted);
    const controller = new AbortController();
    const file = new File(['raw'], 'sample.cr3', { type: 'image/x-cr3' });

    await expect(decodeEditorImage(file, controller.signal)).rejects.toBe(aborted);
    expect(decodeImageFile).not.toHaveBeenCalled();
  });

  it('labels RAW decoder failures instead of falling back to a preview', async () => {
    vi.mocked(openRawForEditing).mockRejectedValue(
      Object.assign(new Error('too large'), { code: 'budget-exceeded' }),
    );
    const file = new File(['raw'], 'sample.cr3', { type: 'image/x-cr3' });

    await expect(decodeEditorImage(file)).rejects.toThrow(/memory budget/);
    expect(decodeImageFile).not.toHaveBeenCalled();
  });
});