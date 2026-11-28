import React from 'react';
import { RotateCcw, Sparkles, Sun, Thermometer } from 'lucide-react';
import {
  DEVELOP_LIMITS,
  isNeutralDevelop,
  normalizeDevelopState,
  type RawDevelopState,
} from './developState';

export interface DevelopPanelProps {
  state: RawDevelopState;
  onChange: (next: RawDevelopState) => void;
  /** As-shot white balance reported by the RAW decoder, when known. */
  asShot: { temperatureK: number; tint: number } | null;
  disabled?: boolean;
}

const signed = (value: number, digits = 1) => `${value > 0 ? '+' : ''}${value.toFixed(digits)}`;

const DevelopSlider: React.FC<{
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}> = ({ id, label, value, min, max, step, display, disabled, onChange }) => (
  <div className="space-y-1">
    <div className="flex items-center justify-between text-[11px] text-[color:var(--ui-text-slate300)]">
      <label htmlFor={id}>{label}</label>
      <span className="font-mono text-[10px] text-[color:var(--ui-text-amber-400)]/90">{display}</span>
    </div>
    <input
      id={id}
      type="range"
      aria-label={label}
      data-testid={id}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(parseFloat(event.target.value))}
      className="w-full accent-amber-500 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
    />
  </div>
);

/**
 * RAW develop controls bound to the Q01-owned RawDevelopState. Q01 mounts this inside
 * AdjustmentPanel; exposure/WB set here stay effective alongside develop (BL-CP3-01).
 */
export const DevelopPanel: React.FC<DevelopPanelProps> = ({ state, onChange, asShot, disabled }) => {
  const neutral = isNeutralDevelop(state, asShot?.temperatureK ?? null);
  const update = (patch: Partial<RawDevelopState>) => onChange(normalizeDevelopState({ ...state, ...patch }));
  const updateWb = (patch: Partial<RawDevelopState['wb']>) =>
    onChange(normalizeDevelopState({ ...state, wb: { ...state.wb, ...patch } }));

  const switchMode = (mode: RawDevelopState['wb']['mode']) => {
    if (mode === state.wb.mode) return;
    if (mode === 'custom') {
      updateWb({
        mode,
        temperatureK: asShot?.temperatureK ?? state.wb.temperatureK,
        tint: asShot?.tint ?? state.wb.tint,
      });
    } else {
      updateWb({ mode });
    }
  };

  return (
    <section data-testid="develop-panel" className="space-y-3">
      <div className="flex items-center gap-1.5 border-b border-[color:var(--ui-border-1b212c)] pb-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--ui-text-amber-400)]/90">
        <Sparkles className="w-3.5 h-3.5" />
        <span className="flex-1">RAW Develop</span>
        <button
          type="button"
          onClick={() => onChange(normalizeDevelopState(null))}
          disabled={disabled || neutral}
          data-testid="develop-reset"
          title="Reset develop to as-shot"
          className="flex items-center gap-1 whitespace-nowrap text-[10px] font-mono text-[color:var(--ui-text-amber-400)]/90 hover:text-[color:var(--ui-text-amber-300)] transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none"
        >
          <RotateCcw className="w-3 h-3" />
          Reset
        </button>
      </div>

      <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--ui-text-slate300)]">
        <Thermometer className="w-3.5 h-3.5 text-[color:var(--ui-text-slate400)]" />
        <span className="flex-1">White Balance</span>
        <div role="group" aria-label="White balance mode" className="flex rounded-md overflow-hidden border border-[color:var(--ui-border-283141)]">
          <button
            type="button"
            onClick={() => switchMode('as-shot')}
            disabled={disabled}
            aria-pressed={state.wb.mode === 'as-shot'}
            data-testid="develop-wb-as-shot"
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
              state.wb.mode === 'as-shot'
                ? 'bg-amber-600 text-white'
                : 'bg-[var(--ui-bg-171c26)] text-[color:var(--ui-text-slate300)] hover:bg-[var(--ui-bg-222a38)]'
            }`}
          >
            As-shot
          </button>
          <button
            type="button"
            onClick={() => switchMode('custom')}
            disabled={disabled}
            aria-pressed={state.wb.mode === 'custom'}
            data-testid="develop-wb-custom"
            className={`px-2 py-0.5 text-[10px] font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none ${
              state.wb.mode === 'custom'
                ? 'bg-amber-600 text-white'
                : 'bg-[var(--ui-bg-171c26)] text-[color:var(--ui-text-slate300)] hover:bg-[var(--ui-bg-222a38)]'
            }`}
          >
            Custom
          </button>
        </div>
      </div>

      {state.wb.mode === 'custom' ? (
        <div className="space-y-3 pl-5">
          <DevelopSlider
            id="develop-temperature"
            label="Temperature"
            value={state.wb.temperatureK}
            min={DEVELOP_LIMITS.temperatureK.min}
            max={DEVELOP_LIMITS.temperatureK.max}
            step={50}
            display={`${Math.round(state.wb.temperatureK)}K`}
            disabled={disabled}
            onChange={(temperatureK) => updateWb({ temperatureK })}
          />
          <DevelopSlider
            id="develop-tint"
            label="Tint"
            value={state.wb.tint}
            min={DEVELOP_LIMITS.tint.min}
            max={DEVELOP_LIMITS.tint.max}
            step={1}
            display={signed(state.wb.tint, 0)}
            disabled={disabled}
            onChange={(tint) => updateWb({ tint })}
          />
        </div>
      ) : (
        <p className="pl-5 text-[10px] text-[color:var(--ui-text-slate400)] font-mono" data-testid="develop-as-shot-label">
          Camera WB{asShot ? ` · ${Math.round(asShot.temperatureK)}K` : ''}
        </p>
      )}

      <div className="flex items-center gap-1.5 text-[11px] text-[color:var(--ui-text-slate300)]">
        <Sun className="w-3.5 h-3.5 text-[color:var(--ui-text-slate400)]" />
        <span className="flex-1">Exposure</span>
      </div>
      <DevelopSlider
        id="develop-exposure"
        label="Develop exposure"
        value={state.exposureEV}
        min={DEVELOP_LIMITS.exposureEV.min}
        max={DEVELOP_LIMITS.exposureEV.max}
        step={0.1}
        display={`${signed(state.exposureEV)} EV`}
        disabled={disabled}
        onChange={(exposureEV) => update({ exposureEV })}
      />

      <DevelopSlider
        id="develop-highlight"
        label="Highlight recovery"
        value={state.highlightRecovery}
        min={DEVELOP_LIMITS.highlightRecovery.min}
        max={DEVELOP_LIMITS.highlightRecovery.max}
        step={0.05}
        display={`${Math.round(state.highlightRecovery * 100)}%`}
        disabled={disabled}
        onChange={(highlightRecovery) => update({ highlightRecovery })}
      />
    </section>
  );
};
