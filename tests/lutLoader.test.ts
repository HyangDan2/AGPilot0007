import { describe, it, expect } from 'vitest';
import { parseCubeLut } from '../src/engine/color/lutLoader';

describe('Cube LUT Parser', () => {
  it('correctly parses a minimal 2x2x2 cube LUT', () => {
    const cubeText = `
# Sample 2x2x2 LUT
TITLE "Test LUT"
LUT_3D_SIZE 2
DOMAIN_MIN 0.0 0.0 0.0
DOMAIN_MAX 1.0 1.0 1.0

0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
    const parsed = parseCubeLut(cubeText);
    expect(parsed.size).toBe(2);
    expect(parsed.domainMin).toEqual([0, 0, 0]);
    expect(parsed.domainMax).toEqual([1, 1, 1]);
    expect(parsed.floatData.length).toBe(2 * 2 * 2 * 3);
    expect(parsed.rgbaData.length).toBe(2 * 2 * 2 * 4);

    // Verify first corner is black
    expect(parsed.floatData[0]).toBe(0.0);
    expect(parsed.floatData[1]).toBe(0.0);
    expect(parsed.floatData[2]).toBe(0.0);
    expect(parsed.rgbaData[0]).toBe(0);
    expect(parsed.rgbaData[3]).toBe(255); // Alpha

    // Verify last corner is white
    const lastIdx = (8 - 1) * 3;
    expect(parsed.floatData[lastIdx]).toBe(1.0);
    expect(parsed.floatData[lastIdx + 1]).toBe(1.0);
    expect(parsed.floatData[lastIdx + 2]).toBe(1.0);
    expect(parsed.rgbaData[(8 - 1) * 4]).toBe(255);
  });

  it('infers size from point count if LUT_3D_SIZE is missing', () => {
    // 8 points = 2x2x2
    const cubeText = `
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;
    const parsed = parseCubeLut(cubeText);
    expect(parsed.size).toBe(2);
  });

  it('throws on incomplete data', () => {
    const invalidText = `
LUT_3D_SIZE 3
0.0 0.0 0.0
1.0 1.0 1.0
`;
    expect(() => parseCubeLut(invalidText)).toThrow(/Incomplete 3D LUT data/);
  });
});
