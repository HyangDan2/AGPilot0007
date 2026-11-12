import { CameraEffects } from './CameraEffects';
import { ResetValueButton, RESET_VALUE_HINT } from './ResetValueButton';
import React from 'react';
import { useEditorStore } from '../stores/editorStore';
import { ADJUSTMENT_DEFINITIONS, AdjustmentCategory, CATEGORY_LABELS } from '../types/adjustments';
import { Sun, Contrast, Droplets, Sparkles, Sliders, X, ChevronDown } from 'lucide-react';

const CATEGORY_ICONS: Record<AdjustmentCategory, React.ReactNode> = {
  film: <Sliders className="w-3.5 h-3.5" />,
  light: <Sun className="w-3.5 h-3.5" />,
  color: <Droplets className="w-3.5 h-3.5" />,
  texture: <Sparkles className="w-3.5 h-3.5" />,
};

interface AdjustmentPanelProps {
  onClose?: () => void;
}

export const AdjustmentPanel: React.FC<AdjustmentPanelProps> = ({ onClose }) => {
  const { adjustments, setAdjustment, resetAdjustments } = useEditorStore();

  const categories: AdjustmentCategory[] = ['light', 'color', 'texture'];

  return (
    <aside className="w-[310px] bg-[#0d0f14] border-l border-[#1e232d] flex flex-col h-full flex-shrink-0 select-none overflow-hidden">
      {/* Header */}
      <div data-testid="adjustment-panel-header" onClick={e => { if (onClose && !(e.target as HTMLElement).closest('button')) onClose(); }} className={`p-3.5 border-b border-[#1c222c] flex items-center justify-between flex-shrink-0 ${onClose ? 'cursor-pointer' : ''}`}>
        <div className="flex items-center space-x-2">
          <Contrast className="w-4 h-4 text-amber-400" />
          <h2 aria-label="Manual Adjustments" className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            {onClose ? <button type="button" onClick={onClose} aria-label="Collapse adjustments" title="Collapse adjustments" className="flex items-center gap-2 text-left uppercase tracking-wider hover:text-white cursor-pointer">Manual Adjustments<ChevronDown aria-hidden="true" className="w-4 h-4 text-amber-400" /></button> : 'Manual Adjustments'}
          </h2>
        </div>
        <div className="flex items-center space-x-2">
          <button
            onClick={resetAdjustments}
            className="text-[10px] text-amber-400/90 hover:text-amber-300 font-mono transition-colors cursor-pointer"
          >
            Reset All
          </button>
          {onClose && (
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[#1a202b] text-slate-400 hover:text-white transition-colors"
              title="Close panel"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Adjustments Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 min-h-0">
        <p className="text-[10px] text-slate-400">{RESET_VALUE_HINT}</p>
        <CameraEffects />
        {categories.map((cat) => {
          const items = ADJUSTMENT_DEFINITIONS.filter((d) => d.category === cat);
          return (
            <section key={cat} className="space-y-3.5">
              <div className="flex items-center space-x-1.5 text-xs font-semibold text-amber-400/90 uppercase tracking-wider pb-1 border-b border-[#1b212c]">
                {CATEGORY_ICONS[cat]}
                <span>{CATEGORY_LABELS[cat]}</span>
              </div>

              <div className="space-y-3">
                {items.map((def) => {
                  const val = adjustments[def.key];
                  return (
                    <div key={def.key} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span
                          className="text-slate-300 font-medium"
                        >
                          {def.label}
                        </span>
                        <ResetValueButton
                          type="button"
                          onClick={() => setAdjustment(def.key, def.defaultValue)}
                          aria-label={`Reset ${def.label} to default`}
                          className="p-0 rounded-sm font-mono text-[11px] text-slate-400 hover:bg-amber-500/10 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer touch-manipulation transition-colors"
                        >
                          {val > 0 && def.defaultValue === 0 ? `+${val}` : val}
                          {def.unit}
                        </ResetValueButton>
                      </div>
                      <input
                        type="range"
                        aria-label={def.label}
                        data-testid={`slider-${def.key}`}
                        min={def.min}
                        max={def.max}
                        step={def.step}
                        value={val}
                        onChange={(e) =>
                          setAdjustment(def.key, parseFloat(e.target.value))
                        }
                        className="w-full accent-amber-500 cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </aside>
  );
};
