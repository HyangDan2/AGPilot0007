import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('mediabunny', () => ({
  getEncodableVideoCodecs: vi.fn(async () => ['avc', 'vp9']),
}));

import { getEncodableVideoCodecs } from 'mediabunny';
import {
  assertContainerCodecPair,
  probeVideoCapabilities,
  selectEncoder,
} from '../src/engine/video/capabilities';
import { VideoCapabilityError } from '../src/engine/video/errors';

type Config = { codec: string };

function installEncoder(supported: (config: Config) => boolean) {
  const isConfigSupported = vi.fn(async (config: Config) => ({ supported: supported(config), config }));
  vi.stubGlobal('VideoEncoder', { isConfigSupported });
  return isConfigSupported;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(getEncodableVideoCodecs).mockResolvedValue(['avc', 'vp9']);
});

describe('Capabilities probe', () => {
  it('reports no encoders when WebCodecs is missing', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('VideoDecoder', undefined);
    const caps = await probeVideoCapabilities();
    expect(caps).toMatchObject({
      canDecode: false,
      encoders: { avc: false, vp9: false },
      containers: { mp4: false, webm: false },
      audioPassthrough: false,
    });
  });

  it('probes both codecs through isConfigSupported', async () => {
    vi.stubGlobal('VideoDecoder', {});
    const spy = installEncoder(() => true);
    const caps = await probeVideoCapabilities();
    expect(caps).toEqual({
      canDecode: true,
      encoders: { avc: true, vp9: true },
      containers: { mp4: true, webm: true },
      audioPassthrough: true,
    });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(spy.mock.calls[0][0].codec).toMatch(/^avc1\.6400/);
    expect(spy.mock.calls[1][0].codec).toMatch(/^vp09\./);
  });

  it('refuses H.264 when the platform rejects the concrete level', async () => {
    vi.stubGlobal('VideoDecoder', {});
    installEncoder((config) => !config.codec.startsWith('avc1'));
    const caps = await probeVideoCapabilities();
    expect(caps.encoders).toEqual({ avc: false, vp9: true });
    expect(caps.containers).toEqual({ mp4: false, webm: true });
  });

  it('treats a throwing probe as unsupported instead of crashing', async () => {
    vi.stubGlobal('VideoDecoder', {});
    vi.stubGlobal('VideoEncoder', { isConfigSupported: vi.fn(async () => { throw new Error('boom'); }) });
    const caps = await probeVideoCapabilities();
    expect(caps.encoders).toEqual({ avc: false, vp9: false });
    vi.mocked(getEncodableVideoCodecs).mockRejectedValueOnce(new Error('list failed'));
    expect((await probeVideoCapabilities()).encoders).toEqual({ avc: false, vp9: false });
  });
});

describe('Encoder selection', () => {
  it('rejects mismatched container/codec pairs', () => {
    expect(() => assertContainerCodecPair('mp4', 'vp9')).toThrow(VideoCapabilityError);
    expect(() => assertContainerCodecPair('webm', 'avc')).toThrow(VideoCapabilityError);
    expect(() => assertContainerCodecPair('mp4', 'avc')).not.toThrow();
  });

  it('returns the AVC level string for 1080p and rejects unsupported configs', async () => {
    installEncoder(() => true);
    const chosen = await selectEncoder('mp4', 'avc', 1920, 1080, 30, 8);
    expect(chosen.codecString).toBe('avc1.640028');
    expect(chosen.bitrate).toBe(8_000_000);

    installEncoder(() => false);
    await expect(selectEncoder('webm', 'vp9', 1280, 720, 30, 3)).rejects.toMatchObject({
      name: 'VideoCapabilityError',
      code: 'unsupported-codec',
    });
    await expect(selectEncoder('mp4', 'vp9', 1280, 720, 30, 3)).rejects.toMatchObject({ code: 'unsupported-container' });
  });
});
