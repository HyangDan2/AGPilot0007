import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ExportModal } from '../src/components/ExportModal';
import { useEditorStore } from '../src/stores/editorStore';
import { prepareExportImage } from '../src/engine/export/imageExporter';

vi.mock('../src/engine/export/imageExporter', () => ({
  prepareExportImage: vi.fn(),
  triggerSafeDownload: vi.fn(),
}));

vi.mock('../src/engine/color/lutLoader', () => ({
  loadCubeLut: vi.fn(async () => ({})),
}));

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function fakeImage() {
  return {
    sourceUrl: '',
    name: 'cancel-test.jpg',
    originalWidth: 100,
    originalHeight: 80,
    previewCanvas: document.createElement('canvas'),
    previewWidth: 100,
    previewHeight: 80,
    originalElement: document.createElement('img'),
  };
}

function abortError() {
  return Object.assign(new Error('Export cancelled'), { name: 'AbortError' });
}

describe('ExportModal cancel wiring (SC-05-P1-A)', () => {
  let container: HTMLDivElement;
  let root: Root;

  const buttonByText = (text: string) =>
    Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes(text));

  beforeEach(() => {
    useEditorStore.setState({ image: fakeImage() as any });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.mocked(prepareExportImage).mockReset();
  });

  it('passes an AbortSignal and aborts the in-flight export from the Cancel button', async () => {
    let control: any;
    vi.mocked(prepareExportImage).mockImplementation((...args: any[]) => {
      control = args[5];
      return new Promise((_, reject) => {
        if (control?.signal?.aborted) {
          reject(abortError());
          return;
        }
        control?.signal?.addEventListener('abort', () => reject(abortError()));
      });
    });

    await act(async () => {
      root.render(<ExportModal isOpen onClose={() => {}} />);
    });

    await act(async () => {
      buttonByText('Prepare Photo')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(prepareExportImage).toHaveBeenCalledTimes(1);
    expect(control.signal).toBeInstanceOf(AbortSignal);
    expect(control.signal.aborted).toBe(false);

    await act(async () => {
      control.onStage('render');
    });
    expect(container.textContent).toContain('Rendering color pipeline...');

    const cancelButton = buttonByText('Cancel Export');
    expect(cancelButton).toBeTruthy();
    await act(async () => {
      cancelButton!.click();
    });

    expect(control.signal.aborted).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });
    expect(container.textContent).toContain('Export cancelled.');
    expect(buttonByText('Prepare Photo')).toBeTruthy();
  });

  it('keeps a non-abort failure as an error instead of a cancellation', async () => {
    vi.mocked(prepareExportImage).mockRejectedValue(new Error('GPU surface unavailable'));

    await act(async () => {
      root.render(<ExportModal isOpen onClose={() => {}} />);
    });
    await act(async () => {
      buttonByText('Prepare Photo')!.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('GPU surface unavailable');
    expect(container.textContent).not.toContain('Export cancelled.');
  });
});
