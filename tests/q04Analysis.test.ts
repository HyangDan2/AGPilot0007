import { describe, expect, it } from 'vitest';
import { analyzePixels, type PixelSample } from '../src/poc/q04/analysis';
import { featuresFromAnalysis, recommendFilms, recommendForAnalysis, type RecommendationFeatures } from '../src/poc/q04/recommend';

function pixels(rgba: Array<[number, number, number, number?]>): PixelSample {
  const data = new Uint8ClampedArray(rgba.length * 4);
  rgba.forEach(([r, g, b, a = 255], index) => {
    data[index * 4] = r;
    data[index * 4 + 1] = g;
    data[index * 4 + 2] = b;
    data[index * 4 + 3] = a;
  });
  return { data, width: rgba.length, height: 1 };
}

function solid(r: number, g: number, b: number, count = 16): PixelSample {
  return pixels(Array.from({ length: count }, () => [r, g, b] as [number, number, number]));
}

function features(partial: Partial<RecommendationFeatures> = {}): RecommendationFeatures {
  return {
    brightness: 0.5,
    contrast: 0.5,
    saturation: 0.4,
    warmth: 0.5,
    colorfulness: 0.3,
    shadowShare: 0,
    highlightShare: 0,
    neutralShare: 0,
    skinToneShare: 0,
    greenBlueShare: 0,
    ...partial,
  };
}

describe('Q04 histogram and color distribution analysis', () => {
  it('measures a neutral gray image', () => {
    const analysis = analyzePixels(solid(128, 128, 128));
    expect(analysis.pixelCount).toBe(16);
    expect(analysis.meanLuminance).toBeCloseTo(128, 0);
    expect(analysis.medianLuminance).toBeCloseTo(129.5, 0);
    expect(analysis.contrast).toBe(0);
    expect(analysis.meanSaturation).toBe(0);
    expect(analysis.warmth).toBe(0);
    expect(analysis.neutralShare).toBe(1);
    expect(analysis.dominantHue).toBeNull();
    expect(analysis.hueHistogram.every((share) => share === 0)).toBe(true);
    expect(analysis.lumaHistogram.reduce((sum, n) => sum + n, 0)).toBe(16);
    expect(analysis.redHistogram.reduce((sum, n) => sum + n, 0)).toBe(16);
  });

  it('detects clipping, shadow/highlight shares and contrast', () => {
    const analysis = analyzePixels(pixels([[0, 0, 0], [0, 0, 0], [255, 255, 255], [255, 255, 255]]));
    expect(analysis.clippedBlacks).toBe(0.5);
    expect(analysis.clippedWhites).toBe(0.5);
    expect(analysis.shadowShare).toBe(0.5);
    expect(analysis.highlightShare).toBe(0.5);
    expect(analysis.contrast).toBeGreaterThan(240);
  });

  it('separates warm and cool hues and reports dominant hue', () => {
    const red = analyzePixels(solid(255, 0, 0));
    expect(red.warmth).toBeCloseTo(1, 5);
    expect(red.meanSaturation).toBeCloseTo(1, 5);
    expect(red.hueHistogram[0]).toBeCloseTo(1, 5);
    expect(red.dominantHue).toBe(15);

    const blue = analyzePixels(solid(0, 0, 255));
    expect(blue.warmth).toBeCloseTo(-1, 5);
    expect(blue.hueHistogram[8]).toBeCloseTo(1, 5);
    expect(blue.dominantHue).toBe(255);
  });

  it('ignores transparent pixels and handles empty samples safely', () => {
    const mixed = analyzePixels(pixels([[255, 0, 0, 0], [128, 128, 128, 255]]));
    expect(mixed.pixelCount).toBe(1);
    expect(mixed.warmth).toBe(0);
    expect(mixed.meanSaturation).toBe(0);

    const empty = analyzePixels({ data: new Uint8ClampedArray(0), width: 0, height: 0 });
    expect(empty.pixelCount).toBe(0);
    expect(Number.isFinite(empty.meanLuminance)).toBe(true);
    expect(empty.contrast).toBe(0);
  });
});

describe('Q04 statistical preset recommendation', () => {
  it('ranks warm portrait-like statistics toward amber and portrait films', () => {
    const results = recommendFilms(features({ brightness: 0.6, contrast: 0.45, saturation: 0.45, warmth: 0.75, colorfulness: 0.35, skinToneShare: 0.25 }));
    expect(results[0].filmId).toBe('FS-003');
    const ids = results.map((item) => item.filmId);
    expect(ids).toContain('FS-004');
    expect(ids).toContain('FS-007');
    const portrait = results.find((item) => item.filmId === 'FS-004')!;
    expect(portrait.bonuses.some((bonus) => bonus.key === 'portrait')).toBe(true);
    expect(portrait.bonuses[0].reason).toContain('피부톤');
  });

  it('ranks cool desaturated statistics toward SKELD', () => {
    const results = recommendFilms(features({ brightness: 0.55, contrast: 0.5, saturation: 0.28, warmth: 0.35, colorfulness: 0.22 }));
    expect(results[0].filmId).toBe('FS-002');
  });

  it('ranks vivid green/blue statistics toward SOLVIK with a landscape reason', () => {
    const results = recommendFilms(features({ brightness: 0.55, contrast: 0.65, saturation: 0.65, warmth: 0.45, colorfulness: 0.55, greenBlueShare: 0.55 }));
    expect(results[0].filmId).toBe('FS-006');
    expect(results[0].bonuses.some((bonus) => bonus.key === 'landscape')).toBe(true);
  });

  it('ranks dark low-key statistics toward cinema dusk', () => {
    const results = recommendFilms(features({ brightness: 0.35, contrast: 0.62, saturation: 0.3, warmth: 0.45, colorfulness: 0.3, shadowShare: 0.6 }));
    expect(results[0].filmId).toBe('FS-008');
    expect(results[0].bonuses.some((bonus) => bonus.key === 'lowlight')).toBe(true);
  });

  it('offers monochrome when the source is nearly neutral', () => {
    const results = recommendFilms(features({ brightness: 0.5, contrast: 0.5, saturation: 0.03, warmth: 0.5, colorfulness: 0.05, neutralShare: 0.9 }));
    expect(results[0].filmId).toBe('FS-009');
    expect(results[0].bonuses.some((bonus) => bonus.key === 'monochrome')).toBe(true);
  });

  it('always exposes scoring evidence and excludes the identity profile', () => {
    const results = recommendFilms(features(), { limit: 4 });
    expect(results).toHaveLength(4);
    for (const item of results) {
      expect(item.filmId).not.toBe('identity');
      expect(item.criteria).toHaveLength(5);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(1);
      expect(item.summary).toContain(item.filmName);
      for (const criterion of item.criteria) {
        expect(Number.isFinite(criterion.imageValue)).toBe(true);
        expect(Number.isFinite(criterion.contribution)).toBe(true);
      }
    }
    const scores = results.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    expect(recommendFilms(features(), { limit: 4 }).map((item) => item.filmId)).toEqual(results.map((item) => item.filmId));
  });

  it('connects pixel analysis to recommendation features and keeps the evidence', () => {
    const analysis = analyzePixels(solid(200, 170, 120, 64));
    const derived = featuresFromAnalysis(analysis);
    expect(derived.warmth).toBeGreaterThan(0.5);
    expect(derived.skinToneShare).toBeGreaterThan(0);
    const set = recommendForAnalysis(analysis, { limit: 3 });
    expect(set.features).toEqual(derived);
    expect(set.recommendations).toHaveLength(3);
    expect(set.recommendations[0].criteria[0].imageValue).toBeCloseTo(derived.brightness, 5);
  });
});
