import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { MetadataIndex, parseExifMetadata, searchMetadata, type ImageMetadata } from '../src/poc/q04/metadata';
import type { WorkspaceEntry } from '../src/engine/image/workspace';
import { withExifDate } from './helpers/exifFixture';

function entry(id: string, name = id, path = name): WorkspaceEntry {
  return { id, name, path, getFile: async () => new File(['x'], name, { type: 'image/jpeg' }) };
}

function record(overrides: Partial<ImageMetadata> & Pick<ImageMetadata, 'id'>): ImageMetadata {
  return { name: overrides.id, path: overrides.id, indexedAt: 1, ...overrides };
}

describe('Q04 EXIF indexing', () => {
  it('indexes incrementally, skips known ids and records parser failures', async () => {
    const parser = vi.fn(async (file: File) => {
      if (file.name.includes('bad')) throw new Error('corrupt header');
      return { captureDate: file.name.startsWith('a') ? '2020-01-01' : '2021-06-01', cameraMake: 'Canon', cameraModel: 'EOS R5', iso: 400 };
    });
    const index = new MetadataIndex(parser);
    const entries = [entry('a.jpg'), entry('b.jpg'), entry('bad.jpg')];
    const first = await index.index(entries, { concurrency: 2 });
    expect(first).toMatchObject({ indexed: 2, failed: 1, skipped: 0, total: 3, aborted: false });
    expect(index.get('a.jpg')?.cameraModel).toBe('EOS R5');
    expect(index.get('bad.jpg')?.error).toContain('corrupt');

    const second = await index.index(entries);
    expect(second).toMatchObject({ indexed: 0, skipped: 3, failed: 0 });
    expect(parser).toHaveBeenCalledTimes(3);

    const forced = await index.index(entries, { force: true });
    expect(forced).toMatchObject({ indexed: 2, failed: 1, skipped: 0 });
    expect(parser).toHaveBeenCalledTimes(6);
    index.clear();
    expect(index.size).toBe(0);
  });

  it('bounds indexing concurrency and can abort between files', async () => {
    let active = 0;
    let maxActive = 0;
    const parser = async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active--;
      return { iso: 100 };
    };
    const index = new MetadataIndex(parser);
    const entries = Array.from({ length: 6 }, (_, i) => entry(`p${i}.jpg`));
    const progress: number[] = [];
    await index.index(entries, { concurrency: 2, onProgress: (p) => progress.push(p.active) });
    expect(maxActive).toBe(2);
    expect(progress.length).toBeGreaterThan(0);

    const controller = new AbortController();
    controller.abort();
    const aborted = await new MetadataIndex(parser).index(entries, { signal: controller.signal });
    expect(aborted.aborted).toBe(true);
    expect(aborted.indexed).toBe(0);
  });

  it('parses real EXIF DateTimeOriginal from a local JPEG fixture', async () => {
    const jpeg = readFileSync('public/samples/about_preview.jpg');
    const file = new File([new Uint8Array(withExifDate(jpeg))], 'exif.jpg', { type: 'image/jpeg' });
    const parsed = await parseExifMetadata(file);
    expect(parsed.captureDate).toBe('2016-03-08');
  });
});

describe('Q04 metadata search', () => {
  const records = [
    record({ id: 'a', name: 'a.jpg', captureDate: '2020-01-01', cameraModel: 'Canon EOS R5', iso: 100 }),
    record({ id: 'b', name: 'b.jpg', captureDate: '2021-06-01', cameraModel: 'Fujifilm X-T5', iso: 800 }),
    record({ id: 'c', name: 'c.jpg', cameraModel: 'Canon EOS R6', iso: 3200 }),
  ];

  it('filters by text, date range, ISO and camera model', () => {
    expect(searchMetadata(records, { text: 'canon' }).map((r) => r.id)).toEqual(['a', 'c']);
    expect(searchMetadata(records, { dateFrom: '2020-06-01', dateTo: '2022-01-01' }).map((r) => r.id)).toEqual(['b']);
    expect(searchMetadata(records, { isoMin: 500 }).map((r) => r.id)).toEqual(['b', 'c']);
    expect(searchMetadata(records, { models: ['x-t5'] }).map((r) => r.id)).toEqual(['b']);
    expect(searchMetadata(records, { isoMax: 500, dateFrom: '2020-01-01' }).map((r) => r.id)).toEqual(['a']);
  });

  it('sorts deterministically and keeps missing values last', () => {
    expect(searchMetadata(records, { sort: 'date-asc' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(searchMetadata(records, { sort: 'date-desc' }).map((r) => r.id)).toEqual(['b', 'a', 'c']);
    expect(searchMetadata(records, { sort: 'iso-asc' }).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    expect(searchMetadata(records, { sort: 'iso-desc' }).map((r) => r.id)).toEqual(['c', 'b', 'a']);
    expect(searchMetadata(records, { limit: 2 }).map((r) => r.id)).toEqual(['a', 'b']);
  });
});
