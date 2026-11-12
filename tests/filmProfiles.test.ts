import { describe, it, expect } from 'vitest';
import { FILM_PROFILES, FILM_LIST } from '../src/films/registry';
import { FilmId } from '../src/types/film';

describe('Film Profiles Registry & Specifications', () => {
  const REQUIRED_IDS: FilmId[] = [
    'FS-001',
    'FS-002',
    'FS-003',
    'FS-004',
    'FS-005',
    'FS-006',
    'FS-007',
    'FS-008',
    'FS-009',
  ];

  it('contains all nine mandatory film profiles with exact IDs', () => {
    expect(FILM_LIST.length).toBe(9);
    for (const id of REQUIRED_IDS) {
      expect(FILM_PROFILES[id]).toBeDefined();
      expect(FILM_PROFILES[id].id).toBe(id);
    }
  });

  it('verifies exact display names and styles', () => {
    const expected = [
      { id: 'FS-001', name: 'VÆRN', style: 'Heritage Negative' },
      { id: 'FS-002', name: 'SKELD', style: 'Editorial Chrome' },
      { id: 'FS-003', name: 'AURVEN', style: 'Amber Memory' },
      { id: 'FS-004', name: 'VESTRA', style: 'True Print' },
      { id: 'FS-005', name: 'VEYRA', style: 'Natural Balance' },
      { id: 'FS-006', name: 'SOLVIK', style: 'Vivid Nature' },
      { id: 'FS-007', name: 'LYSEN', style: 'Soft Portrait' },
      { id: 'FS-008', name: 'MYRVEL', style: 'Cinema Dusk' },
      { id: 'FS-009', name: 'RIMVA', style: 'Silver Monochrome' },
    ];

    for (const exp of expected) {
      const p = FILM_PROFILES[exp.id as FilmId];
      expect(p.name).toBe(exp.name);
      expect(p.style).toBe(exp.style);
      expect(p.description.length).toBeGreaterThan(15);
      expect(p.technicalTarget.length).toBeGreaterThan(15);
      expect(p.lutFile).toMatch(/\.cube$/);
      expect(p.lutSize).toBe(33);
      expect(p.provenance.license).toContain('MIT');
    }
  });

  it('ensures each profile has unique descriptions and technical targets', () => {
    const names = new Set(FILM_LIST.map((f) => f.name));
    const descriptions = new Set(FILM_LIST.map((f) => f.description));
    const targets = new Set(FILM_LIST.map((f) => f.technicalTarget));
    const lutFiles = new Set(FILM_LIST.map((f) => f.lutFile));

    expect(names.size).toBe(9);
    expect(descriptions.size).toBe(9);
    expect(targets.size).toBe(9);
    expect(lutFiles.size).toBe(9);
  });
});
