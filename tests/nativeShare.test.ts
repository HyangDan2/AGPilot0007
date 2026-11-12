import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isFileShareSupported,
  canShareFile,
  sharePreparedFile,
  isIOS,
  isAndroid,
} from '../src/utils/nativeShare';
import { formatBytes } from '../src/engine/export/imageExporter';

describe('Web Share API & Native Share Utility', () => {
  const originalNavigator = global.navigator;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(global, 'navigator', {
      value: originalNavigator,
      writable: true,
      configurable: true,
    });
  });

  describe('isFileShareSupported', () => {
    it('returns true when navigator.share and navigator.canShare support files', () => {
      const mockCanShare = vi.fn().mockReturnValue(true);
      const mockShare = vi.fn().mockResolvedValue(undefined);

      Object.defineProperty(global, 'navigator', {
        value: {
          share: mockShare,
          canShare: mockCanShare,
        },
        writable: true,
        configurable: true,
      });

      expect(isFileShareSupported()).toBe(true);
      expect(mockCanShare).toHaveBeenCalled();
    });

    it('returns false when navigator.share is undefined', () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      expect(isFileShareSupported()).toBe(false);
    });

    it('returns false when navigator.canShare is undefined', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          share: vi.fn(),
        },
        writable: true,
        configurable: true,
      });

      expect(isFileShareSupported()).toBe(false);
    });

    it('returns false when navigator.canShare returns false for files', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          share: vi.fn(),
          canShare: vi.fn().mockReturnValue(false),
        },
        writable: true,
        configurable: true,
      });

      expect(isFileShareSupported()).toBe(false);
    });
  });

  describe('canShareFile', () => {
    it('returns true when file can be shared', () => {
      const mockCanShare = vi.fn().mockReturnValue(true);
      Object.defineProperty(global, 'navigator', {
        value: {
          share: vi.fn(),
          canShare: mockCanShare,
        },
        writable: true,
        configurable: true,
      });

      const file = new File(['test'], 'image.jpg', { type: 'image/jpeg' });
      expect(canShareFile(file)).toBe(true);
      expect(mockCanShare).toHaveBeenCalledWith({ files: [file] });
    });

    it('returns false when navigator.canShare returns false', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          share: vi.fn(),
          canShare: vi.fn().mockReturnValue(false),
        },
        writable: true,
        configurable: true,
      });

      const file = new File(['test'], 'image.jpg', { type: 'image/jpeg' });
      expect(canShareFile(file)).toBe(false);
    });
  });

  describe('sharePreparedFile', () => {
    it('invokes navigator.share and returns success when supported', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined);
      const mockCanShare = vi.fn().mockReturnValue(true);

      Object.defineProperty(global, 'navigator', {
        value: {
          share: mockShare,
          canShare: mockCanShare,
        },
        writable: true,
        configurable: true,
      });

      const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await sharePreparedFile(file, {
        title: 'Custom Title',
        text: 'Film Studio description',
      });

      expect(result).toEqual({ success: true });
      expect(mockShare).toHaveBeenCalledWith({
        files: [file],
        title: 'Custom Title',
        text: 'Film Studio description',
      });
    });

    it('handles user cancellation (AbortError) cleanly without reporting an error', async () => {
      const abortError = new Error('The user aborted a request.');
      abortError.name = 'AbortError';
      const mockShare = vi.fn().mockRejectedValue(abortError);
      const mockCanShare = vi.fn().mockReturnValue(true);

      Object.defineProperty(global, 'navigator', {
        value: {
          share: mockShare,
          canShare: mockCanShare,
        },
        writable: true,
        configurable: true,
      });

      const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await sharePreparedFile(file);

      expect(result).toEqual({ success: false, cancelled: true });
    });

    it('handles user cancellation with error code 20 cleanly', async () => {
      const codeError = { code: 20, message: 'Share sheet canceled by user' };
      const mockShare = vi.fn().mockRejectedValue(codeError);
      const mockCanShare = vi.fn().mockReturnValue(true);

      Object.defineProperty(global, 'navigator', {
        value: {
          share: mockShare,
          canShare: mockCanShare,
        },
        writable: true,
        configurable: true,
      });

      const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await sharePreparedFile(file);

      expect(result).toEqual({ success: false, cancelled: true });
    });

    it('reports failure when navigator.share is unavailable', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {},
        writable: true,
        configurable: true,
      });

      const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await sharePreparedFile(file);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Web Share API is not supported');
    });

    it('reports failure when file cannot be shared according to canShare', async () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          share: vi.fn(),
          canShare: vi.fn().mockReturnValue(false),
        },
        writable: true,
        configurable: true,
      });

      const file = new File(['image-bytes'], 'photo.jpg', { type: 'image/jpeg' });
      const result = await sharePreparedFile(file);

      expect(result.success).toBe(false);
      expect(result.error).toContain('does not support sharing this file format');
    });
  });

  describe('Device & Platform Detection', () => {
    it('identifies iOS devices from userAgent', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15',
        },
        writable: true,
        configurable: true,
      });
      expect(isIOS()).toBe(true);
      expect(isAndroid()).toBe(false);
    });

    it('identifies iPad with MacIntel and multi-touch', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          platform: 'MacIntel',
          maxTouchPoints: 5,
        },
        writable: true,
        configurable: true,
      });
      expect(isIOS()).toBe(true);
      expect(isAndroid()).toBe(false);
    });

    it('identifies Android devices from userAgent', () => {
      Object.defineProperty(global, 'navigator', {
        value: {
          userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36',
        },
        writable: true,
        configurable: true,
      });
      expect(isAndroid()).toBe(true);
      expect(isIOS()).toBe(false);
    });
  });

  describe('formatBytes', () => {
    it('formats 0 and positive byte sizes appropriately', () => {
      expect(formatBytes(0)).toBe('0 B');
      expect(formatBytes(1024)).toBe('1.0 KB');
      expect(formatBytes(1048576)).toBe('1.0 MB');
      expect(formatBytes(2621440)).toBe('2.5 MB');
    });
  });
});
