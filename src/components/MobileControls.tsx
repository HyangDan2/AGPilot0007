import React, { useState } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { FILM_LIST, FILM_PROFILES } from '../films/registry';
import { ADJUSTMENT_DEFINITIONS, AdjustmentCategory } from '../types/adjustments';
import { Sliders, Sun, Droplets, Sparkles, ChevronUp, ChevronDown, RotateCcw } from 'lucide-react';
import { getAssetUrl } from '../utils/assets';

const CATEGORY_ICONS: Record<AdjustmentCategory, React.ReactNode> = {
  film: <Sliders className="w-3.5 h-3.5" />,
  light: <Sun className="w-3.5 h-3.5" />,
  color: <Droplets className="w-3.5 h-3.5" />,
  texture: <Sparkles className="w-3.5 h-3.5" />,
};

export const MobileControls: React.FC = () => {
  const {
    activeFilmId,
    setFilm,
    adjustments,
    setAdjustment,
    resetAdjustments,
  } = useEditorStore();

  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<AdjustmentCategory>('light');

  const categories: AdjustmentCategory[] = ['film', 'light', 'color', 'texture'];
  const activeItems = ADJUSTMENT_DEFINITIONS.filter((d) => d.category === activeTab);
  const currentProfile = FILM_PROFILES[activeFilmId];

  return (
    <div className="flex flex-col bg-[#0e1117] border-t border-[#1d232f] z-30 flex-shrink-0 select-none pb-[env(safe-area-inset-bottom)] shadow-2xl">
      {/* Horizontal Film Carousel */}
      <div className="py-2 px-2.5 overflow-x-auto flex space-x-2 border-b border-[#1a202c] scrollbar-none">
        {FILM_LIST.map((profile) => {
          const isSelected = activeFilmId === profile.id;
          const thumbUrl = getAssetUrl(`thumbnails/${profile.id}.jpg`);

          return (
            <button
              key={profile.id}
              onClick={() => setFilm(profile.id)}
              className={`flex-shrink-0 flex items-center space-x-2 p-1.5 pr-2.5 rounded-lg border text-left transition-all ${
                isSelected
                  ? 'bg-amber-600/20 border-amber-500/80 text-amber-300 ring-1 ring-amber-500/50'
                  : 'bg-[#141822] border-[#222938] text-slate-300 hover:bg-[#181d2a]'
              }`}
            >
              <div className="w-9 h-7 rounded overflow-hidden bg-[#181d26] border border-[#2b3548] flex-shrink-0 relative flex items-center justify-center">
                <span className="text-[8px] font-mono text-slate-500 select-none">FS</span>
                <img
                  src={thumbUrl}
                  alt={profile.name}
                  className="absolute inset-0 w-full h-full object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.currentTarget as HTMLElement).style.display = 'none';
                  }}
                />
              </div>
              <div className="min-w-0">
                <div className="flex items-center space-x-1">
                  <span className="text-[9px] font-mono font-bold text-amber-400">
                    {profile.id}
                  </span>
                  <span className="text-xs font-bold truncate">{profile.name}</span>
                </div>
                <div className="text-[9px] text-slate-400 truncate max-w-[80px]">
                  {profile.style}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Expand/Collapse Toggle Handle */}
      <div className="flex items-center justify-between px-3 py-2 bg-[#121620] border-b border-[#1b212d]">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex-1 flex items-center justify-center space-x-1.5 text-xs font-semibold text-slate-300 hover:text-white"
        >
          <Sliders className="w-3.5 h-3.5 text-amber-400" />
          <span>Adjustments ({currentProfile?.name})</span>
          {isOpen ? <ChevronDown className="w-4 h-4 text-amber-400" /> : <ChevronUp className="w-4 h-4 text-amber-400" />}
        </button>

        {isOpen && (
          <button
            onClick={resetAdjustments}
            className="p-1 text-slate-400 hover:text-white"
            title="Reset"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Expandable Adjustment Drawer (Max 45% viewport height) */}
      {isOpen && (
        <div className="p-3 bg-[#11141c] space-y-3 max-h-[42dvh] overflow-y-auto">
          {/* Subtabs for all categories */}
          <div className="grid grid-cols-4 gap-1 bg-[#171c26] p-1 rounded-lg border border-[#232b3b] text-xs">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveTab(cat)}
                className={`py-1.5 rounded-md flex items-center justify-center space-x-1 font-medium transition-all ${
                  activeTab === cat
                    ? 'bg-amber-600 text-white font-semibold shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {CATEGORY_ICONS[cat]}
                <span className="capitalize">{cat}</span>
              </button>
            ))}
          </div>

          {/* Sliders in active category */}
          <div className="space-y-3.5 pt-1">
            {activeItems.map((def) => {
              const val = adjustments[def.key];
              return (
                <div key={def.key} className="space-y-1.5">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-slate-200 font-medium">{def.label}</span>
                    <button
                      type="button"
                      onClick={() => setAdjustment(def.key, def.defaultValue)}
                      aria-label={`Reset ${def.label} to default`}
                      title={`Reset ${def.label} to default (${def.defaultValue}${def.unit})`}
                      className="p-0 rounded-sm text-amber-400 font-mono font-semibold hover:bg-amber-500/10 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer touch-manipulation transition-colors"
                    >
                      {val > 0 && def.defaultValue === 0 ? `+${val}` : val}
                      {def.unit}
                    </button>
                  </div>
                  <input
                    type="range"
                    aria-label={def.label}
                    data-testid={`slider-${def.key}`}
                    min={def.min}
                    max={def.max}
                    step={def.step}
                    value={val}
                    onChange={(e) => setAdjustment(def.key, parseFloat(e.target.value))}
                    className="w-full accent-amber-500 h-6 cursor-pointer touch-pan-x"
                  />
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
