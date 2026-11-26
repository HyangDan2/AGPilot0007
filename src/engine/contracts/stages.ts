/**
 * Canonical order of the shared edit pipeline. Modules declare a stage and may
 * only depend on modules in the same or an earlier stage.
 */
export const PIPELINE_STAGES = [
  'source',
  'optical',
  'geometry',
  'tone',
  'look',
  'colorLab',
  'detail',
  'composite',
  'output',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const stageIndex = (stage: PipelineStage): number => PIPELINE_STAGES.indexOf(stage);
