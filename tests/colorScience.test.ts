import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { parseCubeLut } from '../src/engine/color/lutLoader';
import { sampleLut3DTrilinear } from '../src/engine/color/lutInterpolation';

describe('HD2Lab Color Science Verification (First Quality Gate & 9 Profiles)', () => {
  const loadCube = (filename: string) => {
    const filePath = path.resolve(__dirname, '../public/luts', filename);
    const content = fs.readFileSync(filePath, 'utf-8');
    return parseCubeLut(content);
  };

  const lutIdentity = loadCube('identity.cube');
  const lutVaern = loadCube('FS-001_VAERN.cube');
  const lutSkeld = loadCube('FS-002_SKELD.cube');
  const lutAurven = loadCube('FS-003_AURVEN.cube');
  const lutVestra = loadCube('FS-004_VESTRA.cube');
  const lutVeyra = loadCube('FS-005_VEYRA.cube');
  const lutSolvik = loadCube('FS-006_SOLVIK.cube');
  const lutLysen = loadCube('FS-007_LYSEN.cube');
  const lutMyrvel = loadCube('FS-008_MYRVEL.cube');
  const lutRimva = loadCube('FS-009_RIMVA.cube');

  it('verifies identity LUT produces zero modification', () => {
    const testRgb: [number, number, number] = [0.45, 0.55, 0.65];
    const out = sampleLut3DTrilinear(lutIdentity, ...testRgb);
    expect(Math.abs(out[0] - testRgb[0])).toBeLessThan(1e-4);
    expect(Math.abs(out[1] - testRgb[1])).toBeLessThan(1e-4);
    expect(Math.abs(out[2] - testRgb[2])).toBeLessThan(1e-4);
  });

  describe('Quality Gate: VÆRN vs SKELD vs AURVEN distinctiveness', () => {
    it('verifies FS-001 VÆRN distinctive red response and deep contrast', () => {
      // Saturated red midtone patch: [0.8, 0.2, 0.2]
      const redIn: [number, number, number] = [0.8, 0.2, 0.2];
      const redVaern = sampleLut3DTrilinear(lutVaern, ...redIn);
      const redSkeld = sampleLut3DTrilinear(lutSkeld, ...redIn);

      // VÆRN preserves and boosts saturated red response; SKELD attenuates saturation
      expect(redVaern[0]).toBeGreaterThan(redSkeld[0]);

      // Shadow green patch: [0.15, 0.35, 0.15]
      const greenShadow: [number, number, number] = [0.15, 0.35, 0.15];
      const greenVaern = sampleLut3DTrilinear(lutVaern, ...greenShadow);
      // VÆRN mutes green shadows (attenuating green channel in shadows)
      expect(greenVaern[1]).toBeLessThan(greenShadow[1]);
    });

    it('verifies FS-002 SKELD restrained blue tones and editorial documentary contrast', () => {
      // Sky blue patch: [0.3, 0.6, 0.9]
      const skyIn: [number, number, number] = [0.3, 0.6, 0.9];
      const skySkeld = sampleLut3DTrilinear(lutSkeld, ...skyIn);
      const skySolvik = sampleLut3DTrilinear(lutSolvik, ...skyIn);

      // SKELD restrains blue saturation significantly compared to vivid SOLVIK
      const deltaBlueSkeld = skySkeld[2] - skySkeld[0];
      const deltaBlueSolvik = skySolvik[2] - skySolvik[0];
      expect(deltaBlueSkeld).toBeLessThan(deltaBlueSolvik);
    });

    it('verifies FS-003 AURVEN warm amber highlight bias and lifted shadow depth', () => {
      // Highlight neutral patch: [0.85, 0.85, 0.85]
      const hlIn: [number, number, number] = [0.85, 0.85, 0.85];
      const hlAurven = sampleLut3DTrilinear(lutAurven, ...hlIn);

      // AURVEN injects warm amber bias into highlights: Red > Green > Blue
      expect(hlAurven[0]).toBeGreaterThan(hlAurven[1]);
      expect(hlAurven[1]).toBeGreaterThan(hlAurven[2]);

      // Deep shadow black patch: [0.0, 0.0, 0.0]
      const blackIn: [number, number, number] = [0.0, 0.0, 0.0];
      const blackAurven = sampleLut3DTrilinear(lutAurven, ...blackIn);
      // Lifted shadow toe
      expect(blackAurven[0]).toBeGreaterThan(0.02);
    });
  });

  describe('Remaining Profiles Distinctive Signatures', () => {
    it('verifies FS-006 SOLVIK vivid nature landscape green boost', () => {
      // Foliage green patch: [0.2, 0.7, 0.2]
      const greenIn: [number, number, number] = [0.2, 0.7, 0.2];
      const greenSolvik = sampleLut3DTrilinear(lutSolvik, ...greenIn);
      const greenVeyra = sampleLut3DTrilinear(lutVeyra, ...greenIn);

      // Solvik boosts green chroma (separation of G over R) significantly more than neutral Veyra
      const chromaSolvik = greenSolvik[1] - greenSolvik[0];
      const chromaVeyra = greenVeyra[1] - greenVeyra[0];
      expect(chromaSolvik).toBeGreaterThan(chromaVeyra);
    });

    it('verifies FS-008 MYRVEL cinematic teal/orange split toning', () => {
      // Shadow patch: [0.15, 0.15, 0.15]
      const shadowIn: [number, number, number] = [0.15, 0.15, 0.15];
      const shadowMyrvel = sampleLut3DTrilinear(lutMyrvel, ...shadowIn);
      // Shadow has cool cyan-teal cast (Blue & Green > Red)
      expect(shadowMyrvel[2]).toBeGreaterThan(shadowMyrvel[0]);

      // Highlight patch: [0.8, 0.8, 0.8]
      const hlIn: [number, number, number] = [0.8, 0.8, 0.8];
      const hlMyrvel = sampleLut3DTrilinear(lutMyrvel, ...hlIn);
      // Highlight has warm dusk cast (Red > Blue)
      expect(hlMyrvel[0]).toBeGreaterThan(hlMyrvel[2]);
    });

    it('verifies FS-009 RIMVA silver monochrome neutrality (R == G == B)', () => {
      const testColors: [number, number, number][] = [
        [0.8, 0.2, 0.3], // Red
        [0.2, 0.8, 0.4], // Green
        [0.3, 0.4, 0.9], // Blue
        [0.7, 0.6, 0.2], // Yellow
      ];

      for (const col of testColors) {
        const out = sampleLut3DTrilinear(lutRimva, ...col);
        // All channels must be equal within 0.001 (pure monochrome)
        expect(Math.abs(out[0] - out[1])).toBeLessThan(0.001);
        expect(Math.abs(out[1] - out[2])).toBeLessThan(0.001);
      }
    });

    it('confirms every one of the 9 profiles yields a distinct color output', () => {
      // Test across standard Macbeth color patch: skin tone [0.76, 0.59, 0.51]
      const skinIn: [number, number, number] = [0.76, 0.59, 0.51];
      const luts = [
        lutVaern,
        lutSkeld,
        lutAurven,
        lutVestra,
        lutVeyra,
        lutSolvik,
        lutLysen,
        lutMyrvel,
        lutRimva,
      ];

      const outputs = luts.map((lut) => sampleLut3DTrilinear(lut, ...skinIn));

      // Compare pairwise distance between all 9 profiles
      for (let i = 0; i < outputs.length; i++) {
        for (let j = i + 1; j < outputs.length; j++) {
          const dist = Math.hypot(
            outputs[i][0] - outputs[j][0],
            outputs[i][1] - outputs[j][1],
            outputs[i][2] - outputs[j][2]
          );
          // Each pair must have noticeable Euclidean color distance (> 0.015)
          expect(dist).toBeGreaterThan(0.015);
        }
      }
    });
  });
});
