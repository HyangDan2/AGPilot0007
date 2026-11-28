export interface SkewEstimate {
  // Deviation of the dominant line normal from the nearest cardinal axis (0 or
  // 90 degrees). Positive values mean the content is rotated clockwise on a
  // y-down image; the correction rotation is -angleDeg.
  angleDeg: number;
  confidence: number;
  dominantNormalDeg: number;
}

export interface SkewOptions {
  angleStepDeg?: number;
  edgePercentile?: number;
  maxEdgePixels?: number;
}

export function lumaFromRgba(
  rgba: ArrayLike<number>,
  width: number,
  height: number
): Float32Array {
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = (0.2126 * rgba[p] + 0.7152 * rgba[p + 1] + 0.0722 * rgba[p + 2]) / 255;
  }
  return out;
}

// Sobel edge map followed by a Hough transform restricted to the line-normal
// angle range [0, 180). The dominant peak is refined with parabolic
// interpolation and compared against the nearest cardinal axis.
export function estimateSkewAngle(
  luma: Float32Array,
  width: number,
  height: number,
  options: SkewOptions = {}
): SkewEstimate {
  if (width < 8 || height < 8 || luma.length !== width * height) {
    throw new Error('Invalid luma buffer');
  }
  const angleStepDeg = options.angleStepDeg ?? 0.25;
  const edgePercentile = options.edgePercentile ?? 0.9;
  const maxEdgePixels = options.maxEdgePixels ?? 12000;

  const magnitude = new Float32Array(width * height);
  const stride = Math.max(1, Math.floor(Math.sqrt((width * height) / 200000)));
  let maxMagnitude = 0;

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = luma[i - width - 1];
      const tc = luma[i - width];
      const tr = luma[i - width + 1];
      const ml = luma[i - 1];
      const mr = luma[i + 1];
      const bl = luma[i + width - 1];
      const bc = luma[i + width];
      const br = luma[i + width + 1];
      const gx = -tl - 2 * ml - bl + tr + 2 * mr + br;
      const gy = -tl - 2 * tc - tr + bl + 2 * bc + br;
      const value = Math.hypot(gx, gy);
      magnitude[i] = value;
      if (value > maxMagnitude) maxMagnitude = value;
    }
  }
  if (!(maxMagnitude > 1e-3)) return { angleDeg: 0, confidence: 0, dominantNormalDeg: 0 };

  const samples: number[] = [];
  for (let y = 1; y < height - 1; y += stride) {
    for (let x = 1; x < width - 1; x += stride) samples.push(magnitude[y * width + x]);
  }
  samples.sort((a, b) => a - b);
  const percentile = samples[Math.min(samples.length - 1, Math.floor(samples.length * edgePercentile))];
  // Sparse scenes keep most pixels below the percentile, so the threshold also
  // tracks the strongest edge; low-contrast textures stay gated by contrast.
  const threshold = Math.max(percentile, maxMagnitude * 0.1);
  if (!(threshold > 1e-4)) return { angleDeg: 0, confidence: 0, dominantNormalDeg: 0 };

  const edgeX: number[] = [];
  const edgeY: number[] = [];
  const edgeW: number[] = [];
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const value = magnitude[y * width + x];
      if (value > threshold) {
        edgeX.push(x);
        edgeY.push(y);
        edgeW.push(Math.min(4, value / threshold));
      }
    }
  }
  if (edgeX.length < 16) return { angleDeg: 0, confidence: 0, dominantNormalDeg: 0 };

  const keep = Math.max(1, Math.ceil(edgeX.length / maxEdgePixels));
  const selected: number[] = [];
  for (let i = 0; i < edgeX.length; i += keep) selected.push(i);

  const angleBins = Math.round(180 / angleStepDeg);
  const diag = Math.ceil(Math.hypot(width, height)) + 2;
  const rhoBins = 2 * diag + 1;
  const accumulator = new Float64Array(rhoBins);
  const scores = new Float64Array(angleBins);

  let bestScore = -1;
  let bestBin = 0;
  for (let t = 0; t < angleBins; t++) {
    const theta = (t * angleStepDeg * Math.PI) / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    accumulator.fill(0);
    for (const idx of selected) {
      const rho = edgeX[idx] * cos + edgeY[idx] * sin;
      const bin = Math.round(rho) + diag;
      if (bin >= 0 && bin < rhoBins) accumulator[bin] += edgeW[idx];
    }
    let thetaBest = 0;
    for (let i = 0; i < rhoBins; i++) {
      if (accumulator[i] > thetaBest) thetaBest = accumulator[i];
    }
    scores[t] = thetaBest;
    if (thetaBest > bestScore) {
      bestScore = thetaBest;
      bestBin = t;
    }
  }

  const prev = scores[(bestBin - 1 + angleBins) % angleBins];
  const center = scores[bestBin];
  const next = scores[(bestBin + 1) % angleBins];
  const denom = prev - 2 * center + next;
  const delta = Math.abs(denom) > 1e-9 ? 0.5 * (prev - next) / denom : 0;
  const dominantNormalDeg = ((bestBin + delta) * angleStepDeg + 180) % 180;

  const nearestCardinal = Math.round(dominantNormalDeg / 90) * 90;
  let angleDeg = dominantNormalDeg - nearestCardinal;
  if (angleDeg > 45) angleDeg -= 90;
  if (angleDeg < -45) angleDeg += 90;

  const contrast = Math.min(1, maxMagnitude / 0.5);
  const confidence = Math.min(1, Math.max(0, (bestScore / Math.min(width, height)) * contrast));
  return {
    angleDeg,
    confidence,
    dominantNormalDeg,
  };
}
