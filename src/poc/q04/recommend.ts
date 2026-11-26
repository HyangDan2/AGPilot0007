import { FILM_PROFILES } from '../../films/registry';
import type { FilmId } from '../../types/film';
import type { HistogramAnalysis } from './analysis';

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

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function featuresFromAnalysis(analysis: HistogramAnalysis): RecommendationFeatures {
  const hue = analysis.hueHistogram;
  return {
    brightness: clamp01(analysis.meanLuminance / 255),
    contrast: clamp01(analysis.contrast / 255),
    saturation: clamp01(analysis.meanSaturation),
    warmth: clamp01((analysis.warmth + 1) / 2),
    colorfulness: clamp01(analysis.colorfulness),
    shadowShare: clamp01(analysis.shadowShare),
    highlightShare: clamp01(analysis.highlightShare),
    neutralShare: clamp01(analysis.neutralShare),
    skinToneShare: clamp01((hue[0] ?? 0) + (hue[1] ?? 0) * 0.5 + (hue[11] ?? 0) * 0.5),
    greenBlueShare: clamp01((hue[3] ?? 0) + (hue[4] ?? 0) + (hue[6] ?? 0) + (hue[7] ?? 0) + (hue[5] ?? 0) * 0.5),
  };
}

type TargetFilmId = Exclude<FilmId, 'identity'>;

export interface FilmTarget {
  filmId: TargetFilmId;
  targets: Record<FeatureKey, number>;
  note: string;
}

/**
 * Heuristic priors authored from each profile's documented description/technical
 * target (src/films/registry.ts). They are explicit constants, not learned data,
 * and every score exposes these targets to the UI.
 */
export const FILM_TARGETS: readonly FilmTarget[] = [
  { filmId: 'FS-001', targets: { brightness: 0.42, contrast: 0.65, saturation: 0.45, warmth: 0.55, colorfulness: 0.35 }, note: '깊은 대비와 헤리티지 네거티브 톤' },
  { filmId: 'FS-002', targets: { brightness: 0.52, contrast: 0.55, saturation: 0.3, warmth: 0.4, colorfulness: 0.25 }, note: '낮은 채도의 쿨한 에디토리얼 크롬' },
  { filmId: 'FS-003', targets: { brightness: 0.55, contrast: 0.48, saturation: 0.5, warmth: 0.68, colorfulness: 0.4 }, note: '앰버 하이라이트의 따뜻한 메모리' },
  { filmId: 'FS-004', targets: { brightness: 0.55, contrast: 0.5, saturation: 0.48, warmth: 0.55, colorfulness: 0.35 }, note: '피부색을 살린 자연스러운 인화 톤' },
  { filmId: 'FS-005', targets: { brightness: 0.58, contrast: 0.42, saturation: 0.45, warmth: 0.5, colorfulness: 0.3 }, note: '중립적이고 부드러운 하이라이트 롤오프' },
  { filmId: 'FS-006', targets: { brightness: 0.55, contrast: 0.65, saturation: 0.62, warmth: 0.48, colorfulness: 0.55 }, note: '녹색·청색을 살린 비비드 리버설' },
  { filmId: 'FS-007', targets: { brightness: 0.6, contrast: 0.35, saturation: 0.4, warmth: 0.58, colorfulness: 0.3 }, note: '저대비 소프트 인물 톤' },
  { filmId: 'FS-008', targets: { brightness: 0.4, contrast: 0.6, saturation: 0.35, warmth: 0.48, colorfulness: 0.4 }, note: '어두운 시네마 황혼 톤' },
  { filmId: 'FS-009', targets: { brightness: 0.5, contrast: 0.6, saturation: 0.08, warmth: 0.5, colorfulness: 0.1 }, note: '실버 모노크롬 변환' },
];

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

export interface CriterionResult {
  key: FeatureKey;
  label: string;
  imageValue: number;
  target: number;
  tolerance: number;
  weight: number;
  similarity: number;
  contribution: number;
}

export interface BonusResult {
  key: string;
  label: string;
  bonus: number;
  reason: string;
}

export interface Recommendation {
  filmId: TargetFilmId;
  filmName: string;
  filmStyle: string;
  score: number;
  baseScore: number;
  criteria: CriterionResult[];
  bonuses: BonusResult[];
  summary: string;
}

export interface RecommendationSet {
  features: RecommendationFeatures;
  recommendations: Recommendation[];
}

const MAX_BONUS = 0.15;
const percent = (value: number) => `${Math.round(value * 100)}%`;

function bonusesFor(filmId: TargetFilmId, features: RecommendationFeatures): BonusResult[] {
  const bonuses: BonusResult[] = [];
  if ((filmId === 'FS-004' || filmId === 'FS-007') && features.skinToneShare >= 0.12) {
    const bonus = Math.min(0.08, features.skinToneShare * 0.3);
    bonuses.push({ key: 'portrait', label: '인물 톤', bonus, reason: `피부톤 후보 영역 ${percent(features.skinToneShare)}` });
  }
  if ((filmId === 'FS-006' || filmId === 'FS-005') && features.greenBlueShare >= 0.28) {
    const bonus = Math.min(0.06, features.greenBlueShare * 0.12);
    bonuses.push({ key: 'landscape', label: '풍경 색역', bonus, reason: `녹색·청색 영역 ${percent(features.greenBlueShare)}` });
  }
  if (filmId === 'FS-009' && features.saturation <= 0.08 && features.colorfulness <= 0.12) {
    bonuses.push({ key: 'monochrome', label: '모노크롬 대안', bonus: 0.05, reason: `원본 채도 ${percent(features.saturation)}` });
  }
  if ((filmId === 'FS-001' || filmId === 'FS-008') && features.shadowShare >= 0.5) {
    bonuses.push({ key: 'lowlight', label: '저조도 톤', bonus: 0.04, reason: `암부 비중 ${percent(features.shadowShare)}` });
  }
  if ((filmId === 'FS-005' || filmId === 'FS-004') && features.highlightShare >= 0.25) {
    bonuses.push({ key: 'highlight', label: '하이라이트 롤오프', bonus: 0.03, reason: `명부 비중 ${percent(features.highlightShare)}` });
  }
  const total = bonuses.reduce((sum, item) => sum + item.bonus, 0);
  if (total > MAX_BONUS) {
    const scale = MAX_BONUS / total;
    for (const item of bonuses) item.bonus *= scale;
  }
  return bonuses;
}

export function scoreFilm(target: FilmTarget, features: RecommendationFeatures): Recommendation {
  const criteria: CriterionResult[] = CORE_FEATURES.map((key) => {
    const imageValue = features[key];
    const goal = target.targets[key];
    const tolerance = FEATURE_TOLERANCES[key];
    const weight = FEATURE_WEIGHTS[key];
    const similarity = clamp01(1 - Math.abs(imageValue - goal) / tolerance);
    return {
      key,
      label: FEATURE_LABELS[key],
      imageValue,
      target: goal,
      tolerance,
      weight,
      similarity,
      contribution: weight * similarity,
    };
  });
  const baseScore = clamp01(criteria.reduce((sum, item) => sum + item.contribution, 0));
  const bonuses = bonusesFor(target.filmId, features);
  const score = clamp01(baseScore + bonuses.reduce((sum, item) => sum + item.bonus, 0));
  const profile = FILM_PROFILES[target.filmId];
  const strongest = [...criteria].sort((a, b) => b.contribution - a.contribution).slice(0, 2);
  const reasonText = bonuses.length ? ` · ${bonuses.map((item) => item.reason).join(', ')}` : '';
  const summary = `${profile?.name ?? target.filmId} 적합도 ${percent(score)} — ${strongest
    .map((item) => `${item.label} 목표 근접도 ${percent(item.similarity)}`)
    .join(', ')}${reasonText}`;
  return {
    filmId: target.filmId,
    filmName: profile?.name ?? target.filmId,
    filmStyle: profile?.style ?? target.note,
    score,
    baseScore,
    criteria,
    bonuses,
    summary,
  };
}

export function recommendFilms(features: RecommendationFeatures, options: { limit?: number; minScore?: number } = {}): Recommendation[] {
  const limit = Math.max(1, Math.floor(options.limit ?? 3));
  const minScore = options.minScore ?? 0;
  return FILM_TARGETS.map((target) => scoreFilm(target, features))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.filmId.localeCompare(b.filmId))
    .slice(0, limit);
}

/** Analysis -> features -> ranked presets, keeping the evidence attached. */
export function recommendForAnalysis(analysis: HistogramAnalysis, options: { limit?: number; minScore?: number } = {}): RecommendationSet {
  const features = featuresFromAnalysis(analysis);
  return { features, recommendations: recommendFilms(features, options) };
}
