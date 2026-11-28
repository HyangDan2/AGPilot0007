export interface Vec2 {
  x: number;
  y: number;
}

// Row-major 3x3 projective matrix. Coordinates are normalized image space (NIS),
// origin top-left, u right, v down, unless a caller documents otherwise.
export type Mat3 = number[];

const EPS = 1e-12;

export const UNIT_SQUARE_CORNERS: readonly Vec2[] = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

export function identityMat3(): Mat3 {
  return [1, 0, 0, 0, 1, 0, 0, 0, 1];
}

export function multiplyMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
    }
  }
  return out;
}

export function invertMat3(m: Mat3): Mat3 {
  const [a, b, c, d, e, f, g, h, i] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < EPS) throw new Error('Matrix is singular');
  const s = 1 / det;
  return [
    (e * i - f * h) * s,
    (c * h - b * i) * s,
    (b * f - c * e) * s,
    (f * g - d * i) * s,
    (a * i - c * g) * s,
    (c * d - a * f) * s,
    (d * h - e * g) * s,
    (b * g - a * h) * s,
    (a * e - b * d) * s,
  ];
}

export function applyMat3(m: Mat3, p: Vec2): Vec2 {
  const w = m[6] * p.x + m[7] * p.y + m[8];
  if (Math.abs(w) < EPS) throw new Error('Point maps to infinity');
  const s = 1 / w;
  return {
    x: (m[0] * p.x + m[1] * p.y + m[2]) * s,
    y: (m[3] * p.x + m[4] * p.y + m[5]) * s,
  };
}

export function solveLinearSystem(a: number[][], b: number[]): number[] {
  const n = b.length;
  const m = a.map((row, i) => {
    if (row.length !== n) throw new Error('Linear system is not square');
    return [...row, b[i]];
  });
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < EPS) throw new Error('Singular linear system');
    if (pivot !== col) {
      const t = m[pivot];
      m[pivot] = m[col];
      m[col] = t;
    }
    const pv = m[col][col];
    for (let r = col + 1; r < n; r++) {
      const factor = m[r][col] / pv;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) m[r][k] -= factor * m[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    let sum = m[r][n];
    for (let c = r + 1; c < n; c++) sum -= m[r][c] * x[c];
    x[r] = sum / m[r][r];
  }
  return x;
}

// Direct linear transform for four point correspondences, h33 fixed to 1.
// Returns a matrix that maps src points onto dst points.
export function solveHomography(src: readonly Vec2[], dst: readonly Vec2[]): Mat3 {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('Exactly four point correspondences are required');
  }
  const a: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: X, y: Y } = dst[i];
    a.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    a.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = solveLinearSystem(a, b);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
}

// Maps unit-square NIS coordinates (TL, TR, BR, BL) to the given quad.
export function unitSquareToQuad(quad: readonly Vec2[]): Mat3 {
  if (quad.length !== 4) throw new Error('Quad requires four corners');
  return solveHomography(UNIT_SQUARE_CORNERS, quad);
}

// Builds the sampling quad for keystone correction. The returned quad is a
// region of the source image that is stretched onto the full output frame.
// vertical > 0 corrects a top that is narrower than the bottom (converging
// verticals); horizontal > 0 corrects a right side that is shorter than the
// left. strength is the maximum normalized inset (0.15 = 15% of the frame).
export function perspectiveCorrectionQuad(
  vertical: number,
  horizontal: number,
  strength = 0.15
): Vec2[] {
  const clamp = (v: number) => Math.min(1, Math.max(-1, v));
  const v = clamp(vertical) * strength;
  const h = clamp(horizontal) * strength;
  return [
    { x: v, y: 0 },
    { x: 1 - v, y: h },
    { x: 1, y: 1 - h },
    { x: 0, y: 1 },
  ];
}

export function perspectiveCorrectionHomography(
  vertical: number,
  horizontal: number,
  strength = 0.15
): Mat3 {
  return unitSquareToQuad(perspectiveCorrectionQuad(vertical, horizontal, strength));
}

// Positive angle rotates sampling coordinates clockwise on a y-down image.
export function rotationHomography(angleRad: number, center: Vec2 = { x: 0.5, y: 0.5 }): Mat3 {
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return [
    c,
    -s,
    center.x - c * center.x + s * center.y,
    s,
    c,
    center.y - s * center.x - c * center.y,
    0,
    0,
    1,
  ];
}

export function translationHomography(tx: number, ty: number): Mat3 {
  return [1, 0, tx, 0, 1, ty, 0, 0, 1];
}
