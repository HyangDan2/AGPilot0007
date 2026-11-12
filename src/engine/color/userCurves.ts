import { CURVE_CHANNELS, ToneCurves, normalizeCurves, isIdentityCurve } from '../../types/curves';
import { createMonotoneSpline } from './toneCurve';
export const CURVE_SAMPLES = 1024;
export function buildCurveTexture(curves?: ToneCurves): { data: Float32Array; enabled: boolean } {
  const normalized = normalizeCurves(curves);
  const data = new Float32Array(CURVE_SAMPLES * 4);
  CURVE_CHANNELS.forEach((channel, c) => {
    const sample = createMonotoneSpline(normalized[channel]);
    for (let i=0;i<CURVE_SAMPLES;i++) data[i*4+c] = sample(i/(CURVE_SAMPLES-1));
  });
  return { data, enabled: CURVE_CHANNELS.some(c => !isIdentityCurve(normalized[c])) };
}
export function histogramFromPixels(pixels: Uint8ClampedArray) {
  const bins = Array.from({length:4},()=>Array(64).fill(0) as number[]);
  for(let i=0;i<pixels.length;i+=4) {
    if (!pixels[i+3]) continue;
    bins[0][Math.min(63, Math.floor((pixels[i]*.2126+pixels[i+1]*.7152+pixels[i+2]*.0722)/4))]++;
    for(let c=0;c<3;c++) bins[c+1][pixels[i+c]>>2]++;
  }
  return bins;
}
