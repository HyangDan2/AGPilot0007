export interface PixelSample {
  /** RGBA bytes, 4 per pixel. */
  data: ArrayLike<number>;
  width: number;
  height: number;
}

export interface HistogramAnalysis {
  pixelCount: number;
  lumaHistogram: number[];
  redHistogram: number[];
  greenHistogram: number[];
  blueHistogram: number[];
  /** Chroma-weighted hue share per 30° bucket, starting at 0° (red). */
  hueHistogram: number[];
  dominantHue: number | null;
  meanLuminance: number;
  medianLuminance: number;
  shadowPoint: number;
  highlightPoint: number;
  contrast: number;
  shadowShare: number;
  highlightShare: number;
  clippedBlacks: number;
  clippedWhites: number;
  meanSaturation: number;
  neutralShare: number;
  /** -1 (blue) .. +1 (orange); mean(R) - mean(B) over 255. */
  warmth: number;
  /** Hasler-Süsstrunk colorfulness on a 0..255 image, normalized by 255. */
  colorfulness: number;
}

export const HISTOGRAM_BINS = 64;
export const HUE_BINS = 12;

function emptyAnalysis(): HistogramAnalysis {
  return {
    pixelCount: 0,
    lumaHistogram: new Array(HISTOGRAM_BINS).fill(0),
    redHistogram: new Array(HISTOGRAM_BINS).fill(0),
    greenHistogram: new Array(HISTOGRAM_BINS).fill(0),
    blueHistogram: new Array(HISTOGRAM_BINS).fill(0),
    hueHistogram: new Array(HUE_BINS).fill(0),
    dominantHue: null,
    meanLuminance: 0,
    medianLuminance: 0,
    shadowPoint: 0,
    highlightPoint: 0,
    contrast: 0,
    shadowShare: 0,
    highlightShare: 0,
    clippedBlacks: 0,
    clippedWhites: 0,
    meanSaturation: 0,
    neutralShare: 0,
    warmth: 0,
    colorfulness: 0,
  };
}

function percentileFromHistogram(histogram: number[], total: number, fraction: number): number {
  if (!total) return 0;
  const target = fraction * total;
  let cumulative = 0;
  for (let bin = 0; bin < histogram.length; bin++) {
    cumulative += histogram[bin];
    if (cumulative >= target) return ((bin + 0.5) / histogram.length) * 255;
  }
  return 255;
}

const bin64 = (value: number) => Math.min(HISTOGRAM_BINS - 1, Math.max(0, Math.floor((value / 256) * HISTOGRAM_BINS)));

export function analyzePixels(sample: PixelSample): HistogramAnalysis {
  const { data } = sample;
  const result = emptyAnalysis();
  const pixelCount = Math.floor(Math.min(data.length / 4, sample.width * sample.height));
  if (pixelCount <= 0) return result;

  const { lumaHistogram, redHistogram, greenHistogram, blueHistogram } = result;
  const hueWeights = new Array<number>(HUE_BINS).fill(0);
  let valid = 0;
  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumLuma = 0;
  let sumSaturation = 0;
  let sumRg = 0;
  let sumYb = 0;
  let sumRgSq = 0;
  let sumYbSq = 0;
  let neutral = 0;
  let black = 0;
  let white = 0;
  let shadow = 0;
  let highlight = 0;
  let hueWeight = 0;

  for (let index = 0, pixel = 0; pixel < pixelCount; index += 4, pixel++) {
    if (data[index + 3] < 8) continue;
    const r = data[index] ?? 0;
    const g = data[index + 1] ?? 0;
    const b = data[index + 2] ?? 0;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;

    lumaHistogram[bin64(luma)]++;
    redHistogram[bin64(r)]++;
    greenHistogram[bin64(g)]++;
    blueHistogram[bin64(b)]++;

    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const delta = max - min;
    const saturation = max > 0 ? delta / max : 0;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;

    sumR += r;
    sumG += g;
    sumB += b;
    sumLuma += luma;
    sumSaturation += saturation;
    sumRg += rg;
    sumYb += yb;
    sumRgSq += rg * rg;
    sumYbSq += yb * yb;
    if (luma <= 2) black++;
    if (luma >= 253) white++;
    if (luma < 64) shadow++;
    if (luma > 192) highlight++;

    if (delta < 8) {
      neutral++;
    } else {
      let hue: number;
      if (max === r) hue = ((g - b) / delta) % 6;
      else if (max === g) hue = (b - r) / delta + 2;
      else hue = (r - g) / delta + 4;
      hue = (hue * 60 + 360) % 360;
      hueWeights[Math.min(HUE_BINS - 1, Math.floor(hue / 30))] += delta;
      hueWeight += delta;
    }
    valid++;
  }

  if (!valid) return result;

  const meanR = sumR / valid;
  const meanB = sumB / valid;
  const meanRg = sumRg / valid;
  const meanYb = sumYb / valid;
  const varianceRg = Math.max(0, sumRgSq / valid - meanRg * meanRg);
  const varianceYb = Math.max(0, sumYbSq / valid - meanYb * meanYb);
  const colorfulness = (Math.sqrt(varianceRg + varianceYb) + 0.3 * Math.sqrt(meanRg * meanRg + meanYb * meanYb)) / 255;

  let dominantHue: number | null = null;
  if (hueWeight > 0) {
    let best = 0;
    for (let bin = 1; bin < HUE_BINS; bin++) if (hueWeights[bin] > hueWeights[best]) best = bin;
    dominantHue = best * 30 + 15;
  }

  result.pixelCount = valid;
  result.meanLuminance = sumLuma / valid;
  result.medianLuminance = percentileFromHistogram(lumaHistogram, valid, 0.5);
  result.shadowPoint = percentileFromHistogram(lumaHistogram, valid, 0.05);
  result.highlightPoint = percentileFromHistogram(lumaHistogram, valid, 0.95);
  result.contrast = result.highlightPoint - result.shadowPoint;
  result.shadowShare = shadow / valid;
  result.highlightShare = highlight / valid;
  result.clippedBlacks = black / valid;
  result.clippedWhites = white / valid;
  result.meanSaturation = sumSaturation / valid;
  result.neutralShare = neutral / valid;
  result.warmth = (meanR - meanB) / 255;
  result.colorfulness = colorfulness;
  result.dominantHue = dominantHue;
  if (hueWeight > 0) result.hueHistogram = hueWeights.map((weight) => weight / hueWeight);
  return result;
}

/**
 * Samples at most maxDimension on the longest edge. The temporary canvas is
 * cleared immediately; callers keep only the returned RGBA bytes.
 */
export function sampleCanvas(source: HTMLCanvasElement, maxDimension = 192): PixelSample {
  const sourceWidth = Math.max(1, source.width);
  const sourceHeight = Math.max(1, source.height);
  const scale = Math.min(1, maxDimension / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('2D canvas context is unavailable');
  context.drawImage(source, 0, 0, width, height);
  const image = context.getImageData(0, 0, width, height);
  canvas.width = 1;
  canvas.height = 1;
  return { data: image.data, width: image.width, height: image.height };
}

export function analyzeCanvas(source: HTMLCanvasElement, maxDimension = 192): HistogramAnalysis {
  return analyzePixels(sampleCanvas(source, maxDimension));
}
