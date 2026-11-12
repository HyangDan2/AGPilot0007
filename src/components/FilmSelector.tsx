import { ExplorerPreview } from './Workspace';
import { CurveToolbar } from './ToneCurve';
import { FilterSetCard } from './FilterSet';
import { ResetValueButton, RESET_VALUE_HINT } from './ResetValueButton';
import React from 'react';
import { MargarineCard } from './MargarineCard';
import { FILM_LIST } from '../films/registry';
import { useEditorStore } from '../stores/editorStore';
import { Sliders, Sparkles } from 'lucide-react';
import { getAssetUrl } from '../utils/assets';
import { DEFAULT_ADJUSTMENTS } from '../types/film';

export const FilmSelector: React.FC = () => {
  const { activeFilmId, activePresetId, setFilm, adjustments, setAdjustment } = useEditorStore();

  return (
    <aside className="w-[270px] bg-[var(--ui-bg-0d0f14)] border-r border-[color:var(--ui-border-1e232d)] flex flex-col h-full flex-shrink-0 select-none overflow-hidden">
      <ExplorerPreview />
      {/* Header */}
      <div className="p-3.5 border-b border-[color:var(--ui-border-1c222c)] flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[color:var(--ui-text-slate200)]">
            Film Profiles
          </h2>
          <p className="text-[10px] text-[color:var(--ui-text-slate400)] font-mono">HD2Lab Original Collection (9)</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-[color:var(--ui-text-amber-400)] border border-amber-500/20 font-mono">
          33³ LUT
        </span>
      </div>

      {/* Film Strength Slider */}
      <div className="px-3.5 py-2.5 bg-[var(--ui-bg-12161e)] border-b border-[color:var(--ui-border-1c222c)] flex-shrink-0">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-[color:var(--ui-text-slate300)] font-medium flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-[color:var(--ui-text-amber-400)]" /> Film Strength
          </span>
          <ResetValueButton
            type="button"
            onClick={() => setAdjustment('filmStrength', DEFAULT_ADJUSTMENTS.filmStrength)}
            aria-label="Reset Film Strength to default"
            className="p-0 rounded-sm text-[color:var(--ui-text-amber-400)] font-mono text-xs font-semibold hover:bg-amber-500/10 hover:text-[color:var(--ui-text-amber-300)] focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer touch-manipulation transition-colors"
          >
            {adjustments.filmStrength}%
          </ResetValueButton>
        </div>
        <input
          type="range"
          aria-label="Film Strength"
          data-testid="slider-filmStrength"
          min={0}
          max={100}
          value={adjustments.filmStrength}
          onChange={(e) => setAdjustment('filmStrength', parseInt(e.target.value, 10))}
          className="w-full accent-amber-500"
        />
      </div>

      <p className="px-3.5 py-2 text-[10px] text-[color:var(--ui-text-slate400)]">{RESET_VALUE_HINT}</p>
      {/* Film Profile Cards List */}
      <div data-testid="filter-area" className="relative flex-1 min-h-0">
      <div className="absolute z-30 top-3 inset-x-3 xl:hidden"><CurveToolbar /></div>
      <div className="h-full overflow-y-auto p-2.5 space-y-2">
        {FILM_LIST.map((profile) => {
          const isSelected = activeFilmId === profile.id && !activePresetId;
          const thumbUrl = getAssetUrl(`thumbnails/${profile.id}.jpg`);

          return (
            <button
              key={profile.id}
              onClick={() => setFilm(profile.id)}
              className={`w-full text-left p-2.5 rounded-xl cursor-pointer transition-all border ${
                isSelected
                  ? 'bg-[var(--ui-bg-181e28)] border-amber-500/70 shadow-lg shadow-amber-950/20 ring-1 ring-amber-500/40'
                  : 'bg-[var(--ui-bg-121620)]/80 border-[color:var(--ui-border-222836)] hover:bg-[var(--ui-bg-161c28)] hover:border-[color:var(--ui-border-2e374a)]'
              }`}
            >
              {/* Top row: Thumbnail & Metadata */}
              <div className="flex items-center space-x-2.5">
                {/* Real Film Thumbnail */}
                <div className="w-14 h-10 rounded-md overflow-hidden bg-[var(--ui-bg-181d26)] border border-[color:var(--ui-border-263042)] flex-shrink-0 shadow-inner relative flex items-center justify-center">
                  <span className="text-[9px] font-mono text-[color:var(--ui-text-slate500)] select-none">FS</span>
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

                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-1.5 truncate">
                      <span className="text-[10px] font-mono font-bold px-1 py-0.2 rounded bg-[var(--ui-bg-1e2636)] text-[color:var(--ui-text-amber-400)] border border-[color:var(--ui-border-2b364a)]">
                        {profile.id}
                      </span>
                      <span className={`text-xs font-bold tracking-wide truncate ${isSelected ? 'text-[color:var(--ui-text-amber-300)]' : 'text-[color:var(--ui-text-slate100)]'}`}>
                        {profile.name}
                      </span>
                    </div>
                    {isSelected && (
                      <Sparkles className="w-3.5 h-3.5 text-[color:var(--ui-text-amber-400)] animate-pulse flex-shrink-0 ml-1" />
                    )}
                  </div>
                  <div className="text-[10px] font-medium text-[color:var(--ui-text-slate400)] truncate mt-0.5">
                    {profile.style}
                  </div>
                </div>
              </div>

              {/* Technical Description */}
              <p className="text-[10px] text-[color:var(--ui-text-slate400)] mt-2 line-clamp-2 leading-relaxed">
                {profile.description}
              </p>
            </button>
          );
        })}
        <MargarineCard />
        <FilterSetCard />
      </div>
      </div>
    </aside>
  );
};
