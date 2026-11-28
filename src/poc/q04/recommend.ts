import { FILM_PROFILES } from '../../films/registry';
import type { FilmProfile } from '../../types/film';
import type { HistogramAnalysis } from './analysis';
import {
  CORE_FEATURES,
  FEATURE_LABELS,
  FEATURE_TOLERANCES,
  FEATURE_WEIGHTS,
  deriveTargets,
  recommendationMetadataFor,
  registerRecommendationMetadata,
  resolveTargets,
  unregisterRecommendationMetadata,
  type FeatureKey,
  type FilmBonusRule,
  type RecommendationFeatures,
  type RecommendationMetadata,
} from './recommendationRegistry';

export {
  CORE_FEATURES,
  FEATURE_LABELS,
  FEATURE_TOLERANCES,
  FEATURE_WEIGHTS,
  deriveTargets,
  registerRecommendationMetadata,
  recommendationMetadataFor,
  unregisterRecommendationMetadata,
  type FeatureKey,
  type FilmBonusRule,
  type RecommendationFeatures,
  type RecommendationMetadata,
};

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
  filmId: string;
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

function ruleApplies(rule: FilmBonusRule, features: RecommendationFeatures): boolean {
  return rule.conditions.every((condition) => {
    const value = features[condition.feature];
    return condition.op === 'gte' ? value >= condition.value : value <= condition.value;
  });
}

/** Generic evaluator: no film ids are referenced here. */
function bonusesFor(metadata: RecommendationMetadata | undefined, features: RecommendationFeatures): BonusResult[] {
  const bonuses: BonusResult[] = [];
  for (const rule of metadata?.bonuses ?? []) {
    if (!ruleApplies(rule, features)) continue;
    const value = features[rule.feature];
    const raw = rule.fixed ?? Math.min(rule.cap, value * (rule.scale ?? 0));
    bonuses.push({
      key: rule.key,
      label: rule.label,
      bonus: raw,
      reason: `${rule.reasonLabel} ${percent(value)}`,
    });
  }
  const total = bonuses.reduce((sum, item) => sum + item.bonus, 0);
  if (total > MAX_BONUS) {
    const scale = MAX_BONUS / total;
    for (const item of bonuses) item.bonus *= scale;
  }
  return bonuses;
}

export function scoreFilm(profile: FilmProfile, features: RecommendationFeatures): Recommendation {
  const metadata = recommendationMetadataFor(profile.id);
  const targets = resolveTargets(profile, metadata);
  const criteria: CriterionResult[] = CORE_FEATURES.map((key) => {
    const imageValue = features[key];
    const target = targets[key];
    const tolerance = FEATURE_TOLERANCES[key];
    const weight = FEATURE_WEIGHTS[key];
    const similarity = clamp01(1 - Math.abs(imageValue - target) / tolerance);
    return {
      key,
      label: FEATURE_LABELS[key],
      imageValue,
      target,
      tolerance,
      weight,
      similarity,
      contribution: weight * similarity,
    };
  });
  const baseScore = clamp01(criteria.reduce((sum, item) => sum + item.contribution, 0));
  const bonuses = bonusesFor(metadata, features);
  const score = clamp01(baseScore + bonuses.reduce((sum, item) => sum + item.bonus, 0));
  const strongest = [...criteria].sort((a, b) => b.contribution - a.contribution).slice(0, 2);
  const reasonText = bonuses.length ? ` · ${bonuses.map((item) => item.reason).join(', ')}` : '';
  const summary = `${profile.name} 적합도 ${percent(score)} — ${strongest
    .map((item) => `${item.label} 목표 근접도 ${percent(item.similarity)}`)
    .join(', ')}${reasonText}`;
  return {
    filmId: profile.id,
    filmName: profile.name,
    filmStyle: profile.style || metadata?.note || '',
    score,
    baseScore,
    criteria,
    bonuses,
    summary,
  };
}

/**
 * Ranks every registered film profile. Profiles join or leave automatically
 * with the film registry; only metadata.recommendable === false is skipped
 * (identity is registered that way because it has no film look).
 */
export function recommendFilms(features: RecommendationFeatures, options: { limit?: number; minScore?: number } = {}): Recommendation[] {
  const limit = Math.max(1, Math.floor(options.limit ?? 3));
  const minScore = options.minScore ?? 0;
  return Object.values(FILM_PROFILES)
    .filter((profile) => recommendationMetadataFor(profile.id)?.recommendable !== false)
    .map((profile) => scoreFilm(profile, features))
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score || a.filmId.localeCompare(b.filmId))
    .slice(0, limit);
}

/** Analysis -> features -> ranked presets, keeping the evidence attached. */
export function recommendForAnalysis(analysis: HistogramAnalysis, options: { limit?: number; minScore?: number } = {}): RecommendationSet {
  const features = featuresFromAnalysis(analysis);
  return { features, recommendations: recommendFilms(features, options) };
}
