import { ParsedLut3D } from './lutLoader';

/**
 * Trilinear interpolation of a 3D LUT on CPU.
 * Input: [r, g, b] in [0, 1] range.
 * Returns: [r, g, b] in [0, 1] range.
 */
export function sampleLut3DTrilinear(
  lut: ParsedLut3D,
  r: number,
  g: number,
  b: number
): [number, number, number] {
  const { size, floatData } = lut;
  const n = size;

  // Clamp input to [0, 1]
  const cr = Math.min(1.0, Math.max(0.0, r));
  const cg = Math.min(1.0, Math.max(0.0, g));
  const cb = Math.min(1.0, Math.max(0.0, b));

  const x = cr * (n - 1);
  const y = cg * (n - 1);
  const z = cb * (n - 1);

  const x0 = Math.floor(x);
  const x1 = Math.min(n - 1, x0 + 1);
  const y0 = Math.floor(y);
  const y1 = Math.min(n - 1, y0 + 1);
  const z0 = Math.floor(z);
  const z1 = Math.min(n - 1, z0 + 1);

  const dx = x - x0;
  const dy = y - y0;
  const dz = z - z0;

  // Helper to fetch RGB at (ix, iy, iz)
  // Data layout: R fastest, then G, then B
  // index = (z * n * n + y * n + x) * 3
  const getRGB = (ix: number, iy: number, iz: number): [number, number, number] => {
    const idx = (iz * n * n + iy * n + ix) * 3;
    return [floatData[idx], floatData[idx + 1], floatData[idx + 2]];
  };

  const c000 = getRGB(x0, y0, z0);
  const c100 = getRGB(x1, y0, z0);
  const c010 = getRGB(x0, y1, z0);
  const c110 = getRGB(x1, y1, z0);
  const c001 = getRGB(x0, y0, z1);
  const c101 = getRGB(x1, y0, z1);
  const c011 = getRGB(x0, y1, z1);
  const c111 = getRGB(x1, y1, z1);

  // Interpolate along X
  const c00 = [
    c000[0] * (1 - dx) + c100[0] * dx,
    c000[1] * (1 - dx) + c100[1] * dx,
    c000[2] * (1 - dx) + c100[2] * dx,
  ];
  const c10 = [
    c010[0] * (1 - dx) + c110[0] * dx,
    c010[1] * (1 - dx) + c110[1] * dx,
    c010[2] * (1 - dx) + c110[2] * dx,
  ];
  const c01 = [
    c001[0] * (1 - dx) + c101[0] * dx,
    c001[1] * (1 - dx) + c101[1] * dx,
    c001[2] * (1 - dx) + c101[2] * dx,
  ];
  const c11 = [
    c011[0] * (1 - dx) + c111[0] * dx,
    c011[1] * (1 - dx) + c111[1] * dx,
    c011[2] * (1 - dx) + c111[2] * dx,
  ];

  // Interpolate along Y
  const c0 = [
    c00[0] * (1 - dy) + c10[0] * dy,
    c00[1] * (1 - dy) + c10[1] * dy,
    c00[2] * (1 - dy) + c10[2] * dy,
  ];
  const c1 = [
    c01[0] * (1 - dy) + c11[0] * dy,
    c01[1] * (1 - dy) + c11[1] * dy,
    c01[2] * (1 - dy) + c11[2] * dy,
  ];

  // Interpolate along Z
  return [
    Math.min(1.0, Math.max(0.0, c0[0] * (1 - dz) + c1[0] * dz)),
    Math.min(1.0, Math.max(0.0, c0[1] * (1 - dz) + c1[1] * dz)),
    Math.min(1.0, Math.max(0.0, c0[2] * (1 - dz) + c1[2] * dz)),
  ];
}
