import { getAssetUrl } from '../../utils/assets';

export interface ParsedLut3D {
  title?: string;
  size: number;
  domainMin: [number, number, number];
  domainMax: [number, number, number];
  floatData: Float32Array; // RGB floats [0..1], length size^3 * 3
  rgbaData: Uint8Array;    // RGBA bytes [0..255], length size^3 * 4 for WebGL2 TEXTURE_3D
}

export function parseCubeLut(cubeText: string): ParsedLut3D {
  const lines = cubeText.split(/\r?\n/);
  let size = 0;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let title: string | undefined;

  const rawValues: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (!rawLine || rawLine.startsWith('#')) {
      continue;
    }

    if (rawLine.startsWith('LUT_3D_SIZE')) {
      const parts = rawLine.split(/\s+/);
      size = parseInt(parts[1], 10);
      continue;
    }

    if (rawLine.startsWith('DOMAIN_MIN')) {
      const parts = rawLine.split(/\s+/);
      domainMin = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
      continue;
    }

    if (rawLine.startsWith('DOMAIN_MAX')) {
      const parts = rawLine.split(/\s+/);
      domainMax = [parseFloat(parts[1]), parseFloat(parts[2]), parseFloat(parts[3])];
      continue;
    }

    if (rawLine.startsWith('TITLE')) {
      title = rawLine.substring(5).trim().replace(/^["']|["']$/g, '');
      continue;
    }

    // Must be data lines: R G B
    const parts = rawLine.split(/\s+/);
    if (parts.length >= 3) {
      const r = parseFloat(parts[0]);
      const g = parseFloat(parts[1]);
      const b = parseFloat(parts[2]);
      if (!isNaN(r) && !isNaN(g) && !isNaN(b)) {
        rawValues.push(r, g, b);
      }
    }
  }

  if (size === 0) {
    // If size not declared, infer from cubic root
    const count = rawValues.length / 3;
    size = Math.round(Math.cbrt(count));
  }

  const totalPoints = size * size * size;
  if (rawValues.length < totalPoints * 3) {
    throw new Error(`Incomplete 3D LUT data: expected ${totalPoints * 3} values, got ${rawValues.length}`);
  }

  const floatData = new Float32Array(totalPoints * 3);
  const rgbaData = new Uint8Array(totalPoints * 4);

  for (let i = 0; i < totalPoints; i++) {
    const r = Math.min(1.0, Math.max(0.0, rawValues[i * 3]));
    const g = Math.min(1.0, Math.max(0.0, rawValues[i * 3 + 1]));
    const b = Math.min(1.0, Math.max(0.0, rawValues[i * 3 + 2]));

    floatData[i * 3] = r;
    floatData[i * 3 + 1] = g;
    floatData[i * 3 + 2] = b;

    rgbaData[i * 4] = Math.round(r * 255);
    rgbaData[i * 4 + 1] = Math.round(g * 255);
    rgbaData[i * 4 + 2] = Math.round(b * 255);
    rgbaData[i * 4 + 3] = 255;
  }

  return {
    title,
    size,
    domainMin,
    domainMax,
    floatData,
    rgbaData,
  };
}

// In-memory cache for parsed LUTs
const lutCache = new Map<string, ParsedLut3D>();

export async function loadCubeLut(pathOrUrl: string): Promise<ParsedLut3D> {
  const url = pathOrUrl.startsWith('http://') || pathOrUrl.startsWith('https://') || pathOrUrl.startsWith('blob:')
    ? pathOrUrl
    : getAssetUrl(pathOrUrl);

  if (lutCache.has(url)) {
    return lutCache.get(url)!;
  }

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to load LUT from ${url}: ${res.statusText}`);
  }
  const text = await res.text();
  const parsed = parseCubeLut(text);
  lutCache.set(url, parsed);
  return parsed;
}
