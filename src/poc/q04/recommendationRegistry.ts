import type { FilmProfile } from '../../types/film';

export type FeatureKey = 'brightness' | 'contrast' | 'saturation' | 'warmth' | 'colorfulness';

export const CORE_FEATURES: readonly FeatureKey[] = ['brightness', 'contrast', 'saturation', 'warmth', 'colorfulness'];

export const FEATURE_LABELS: Record<FeatureKey, string> = {
  brightness: '밝기',
  contrast: '대비',
  saturation: '채도',
  warmth: '색온도',
  colorfulness: '색 다양성',
};

export interface RecommendationFeatures {
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  colorfulness: number;
  shadowShare: number;
  highlightShare: number;
  neutralShare: number;
  /** Hue-share proxy for skin-like warm midtones; NOT face detection. */
  skinToneShare: number;
  /** Green + blue hue share, used as a landscape proxy. */
  greenBlueShare: number;
}

export interface BonusCondition {
  feature: keyof RecommendationFeatures;
  /** gte/lte against `value`. All conditions must pass. */
  op: 'gte' | 'lte';
  value: number;
}

/**
 * Declarative bonus rule. The engine evaluates every rule generically; adding a
 * film never requires editing recommend.ts.
 */
export interface FilmBonusRule {
  key: string;
  label: string;
  conditions: BonusCondition[];
  /** Feature reported in the reason text and used when `fixed` is absent. */
  feature: keyof RecommendationFeatures;
  reasonLabel: string;
  /** Fixed bonus; otherwise min(cap, feature * scale). */
  fixed?: number;
  scale?: number;
  cap: number;
}

export interface RecommendationMetadata {
  filmId: string;
  /** Per-feature target in 0..1; missing features fall back to derived values. */
  targets?: Partial<Record<FeatureKey, number>>;
  bonuses?: FilmBonusRule[];
  note?: string;
  recommendable?: boolean;
}

export const FEATURE_WEIGHTS: Record<FeatureKey, number> = {
  brightness: 0.2,
  contrast: 0.22,
  saturation: 0.22,
  warmth: 0.24,
  colorfulness: 0.12,
};

export const FEATURE_TOLERANCES: Record<FeatureKey, number> = {
  brightness: 0.35,
  contrast: 0.35,
  saturation: 0.35,
  warmth: 0.3,
  colorfulness: 0.35,
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/**
 * Explicit heuristic priors authored from each profile's documented
 * description/technical target. They are constants, not learned data, and every
 * score exposes them to the UI. New profiles need no entry: deriveTargets()
 * synthesizes a neutral target from their default adjustments.
 */
const METADATA: Record<string, RecommendationMetadata> = {
  identity: { filmId: 'identity', recommendable: false, note: '기술 검증용 통과 프로파일' },
  'FS-001': {
    filmId: 'FS-001',
    targets: { brightness: 0.42, contrast: 0.65, saturation: 0.45, warmth: 0.55, colorfulness: 0.35 },
    note: '깊은 대비와 헤리티지 네거티브 톤',
    bonuses: [
      {
        key: 'lowlight',
        label: '저조도 톤',
        feature: 'shadowShare',
        reasonLabel: '암부 비중',
        conditions: [{ feature: 'shadowShare', op: 'gte', value: 0.5 }],
        fixed: 0.04,
        cap: 0.04,
      },
    ],
  },
  'FS-002': {
    filmId: 'FS-002',
    targets: { brightness: 0.52, contrast: 0.55, saturation: 0.3, warmth: 0.4, colorfulness: 0.25 },
    note: '낮은 채도의 쿨한 에디토리얼 크롬',
  },
  'FS-003': {
    filmId: 'FS-003',
    targets: { brightness: 0.55, contrast: 0.48, saturation: 0.5, warmth: 0.68, colorfulness: 0.4 },
    note: '앰버 하이라이트의 따뜻한 메모리',
  },
  'FS-004': {
    filmId: 'FS-004',
    targets: { brightness: 0.55, contrast: 0.5, saturation: 0.48, warmth: 0.55, colorfulness: 0.35 },
    note: '피부색을 살린 자연스러운 인화 톤',
    bonuses: [
      {
        key: 'portrait',
        label: '인물 톤',
        feature: 'skinToneShare',
        reasonLabel: '피부톤 후보 영역',
        conditions: [{ feature: 'skinToneShare', op: 'gte', value: 0.12 }],
        scale: 0.3,
        cap: 0.08,
      },
      {
        key: 'highlight',
        label: '하이라이트 롤오프',
        feature: 'highlightShare',
        reasonLabel: '명부 비중',
        conditions: [{ feature: 'highlightShare', op: 'gte', value: 0.25 }],
        fixed: 0.03,
        cap: 0.03,
      },
    ],
  },
  'FS-005': {
    filmId: 'FS-005',
    targets: { brightness: 0.58, contrast: 0.42, saturation: 0.45, warmth: 0.5, colorfulness: 0.3 },
    note: '중립적이고 부드러운 하이라이트 롤오프',
    bonuses: [
      {
        key: 'landscape',
        label: '풍경 색역',
        feature: 'greenBlueShare',
        reasonLabel: '녹색·청색 영역',
        conditions: [{ feature: 'greenBlueShare', op: 'gte', value: 0.28 }],
        scale: 0.12,
        cap: 0.06,
      },
      {
        key: 'highlight',
        label: '하이라이트 롤오프',
        feature: 'highlightShare',
        reasonLabel: '명부 비중',
        conditions: [{ feature: 'highlightShare', op: 'gte', value: 0.25 }],
        fixed: 0.03,
        cap: 0.03,
      },
    ],
  },
  'FS-006': {
    filmId: 'FS-006',
    targets: { brightness: 0.55, contrast: 0.65, saturation: 0.62, warmth: 0.48, colorfulness: 0.55 },
    note: '녹색·청색을 살린 비비드 리버설',
    bonuses: [
      {
        key: 'landscape',
        label: '풍경 색역',
        feature: 'greenBlueShare',
        reasonLabel: '녹색·청색 영역',
        conditions: [{ feature: 'greenBlueShare', op: 'gte', value: 0.28 }],
        scale: 0.12,
        cap: 0.06,
      },
    ],
  },
  'FS-007': {
    filmId: 'FS-007',
    targets: { brightness: 0.6, contrast: 0.35, saturation: 0.4, warmth: 0.58, colorfulness: 0.3 },
    note: '저대비 소프트 인물 톤',
    bonuses: [
      {
        key: 'portrait',
        label: '인물 톤',
        feature: 'skinToneShare',
        reasonLabel: '피부톤 후보 영역',
        conditions: [{ feature: 'skinToneShare', op: 'gte', value: 0.12 }],
        scale: 0.3,
        cap: 0.08,
      },
    ],
  },
  'FS-008': {
    filmId: 'FS-008',
    targets: { brightness: 0.4, contrast: 0.6, saturation: 0.35, warmth: 0.48, colorfulness: 0.4 },
    note: '어두운 시네마 황혼 톤',
    bonuses: [
      {
        key: 'lowlight',
        label: '저조도 톤',
        feature: 'shadowShare',
        reasonLabel: '암부 비중',
        conditions: [{ feature: 'shadowShare', op: 'gte', value: 0.5 }],
        fixed: 0.04,
        cap: 0.04,
      },
    ],
  },
  'FS-009': {
    filmId: 'FS-009',
    targets: { brightness: 0.5, contrast: 0.6, saturation: 0.08, warmth: 0.5, colorfulness: 0.1 },
    note: '실버 모노크롬 변환',
    bonuses: [
      {
        key: 'monochrome',
        label: '모노크롬 대안',
        feature: 'saturation',
        reasonLabel: '원본 채도',
        conditions: [
          { feature: 'saturation', op: 'lte', value: 0.08 },
          { feature: 'colorfulness', op: 'lte', value: 0.12 },
        ],
        fixed: 0.05,
        cap: 0.05,
      },
    ],
  },
};

export function registerRecommendationMetadata(metadata: RecommendationMetadata): void {
  if (!metadata.filmId) throw new Error('Recommendation metadata requires a filmId');
  METADATA[metadata.filmId] = metadata;
}

/** Removes an entry (or a runtime test registration); unknown ids are ignored. */
export function unregisterRecommendationMetadata(filmId: string): void {
  delete METADATA[filmId];
}

export function recommendationMetadataFor(filmId: string): RecommendationMetadata | undefined {
  return METADATA[filmId];
}

export function recommendationMetadataList(): RecommendationMetadata[] {
  return Object.values(METADATA);
}

/** Targets used when a profile has no explicit metadata entry. */
export function deriveTargets(profile: FilmProfile): Record<FeatureKey, number> {
  const adjustments = profile.defaultAdjustments ?? {};
  const value = (key: keyof typeof adjustments, fallback = 0) =>
    typeof adjustments[key] === 'number' && Number.isFinite(adjustments[key]) ? adjustments[key]! : fallback;
  return {
    brightness: clamp01(0.5 + value('exposure') * 0.06),
    contrast: clamp01(0.5 + value('contrast') / 200),
    saturation: clamp01(0.5 + value('saturation') / 200),
    warmth: clamp01(0.5 + value('temperature') / 200 + value('tint') / 400),
    colorfulness: 0.4,
  };
}

/** Effective targets: explicit metadata wins feature-by-feature over derived values. */
export function resolveTargets(profile: FilmProfile, metadata = recommendationMetadataFor(profile.id)): Record<FeatureKey, number> {
  const derived = deriveTargets(profile);
  if (!metadata?.targets) return derived;
  for (const key of CORE_FEATURES) {
    const explicit = metadata.targets[key];
    if (typeof explicit === 'number' && Number.isFinite(explicit)) derived[key] = clamp01(explicit);
  }
  return derived;
}
