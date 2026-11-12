import React from 'react';
import { FILM_LIST } from '../films/registry';
import { useEditorStore } from '../stores/editorStore';
import { Sliders, Sparkles } from 'lucide-react';
import { getAssetUrl } from '../utils/assets';
import { DEFAULT_ADJUSTMENTS } from '../types/film';

export const FilmSelector: React.FC = () => {
  const { activeFilmId, setFilm, adjustments, setAdjustment } = useEditorStore();

  return (
    <aside className="w-[270px] bg-[#0d0f14] border-r border-[#1e232d] flex flex-col h-full flex-shrink-0 select-none overflow-hidden">
      {/* Header */}
      <div className="p-3.5 border-b border-[#1c222c] flex items-center justify-between flex-shrink-0">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Film Profiles
          </h2>
          <p className="text-[10px] text-slate-400 font-mono">HD2Lab Original Collection (9)</p>
        </div>
        <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-mono">
          33³ LUT
        </span>
      </div>

      {/* Film Strength Slider */}
      <div className="px-3.5 py-2.5 bg-[#12161e] border-b border-[#1c222c] flex-shrink-0">
        <div className="flex items-center justify-between text-xs mb-1.5">
          <span className="text-slate-300 font-medium flex items-center gap-1.5">
            <Sliders className="w-3.5 h-3.5 text-amber-400" /> Film Strength
          </span>
          <button
            type="button"
            onClick={() => setAdjustment('filmStrength', DEFAULT_ADJUSTMENTS.filmStrength)}
            aria-label="Reset Film Strength to default"
            title="Reset Film Strength to default (100%)"
            className="p-0 rounded-sm text-amber-400 font-mono text-xs font-semibold hover:bg-amber-500/10 hover:text-amber-300 focus-visible:outline-2 focus-visible:outline-amber-400 cursor-pointer touch-manipulation transition-colors"
          >
            {adjustments.filmStrength}%
          </button>
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

      {/* Film Profile Cards List */}
      <div className="flex-1 overflow-y-auto p-2.5 space-y-2 min-h-0">
        {FILM_LIST.map((profile) => {
          const isSelected = activeFilmId === profile.id;
          const thumbUrl = getAssetUrl(`thumbnails/${profile.id}.jpg`);

          return (
            <button
              key={profile.id}
              onClick={() => setFilm(profile.id)}
              className={`w-full text-left p-2.5 rounded-xl cursor-pointer transition-all border ${
                isSelected
                  ? 'bg-[#181e28] border-amber-500/70 shadow-lg shadow-amber-950/20 ring-1 ring-amber-500/40'
                  : 'bg-[#121620]/80 border-[#222836] hover:bg-[#161c28] hover:border-[#2e374a]'
              }`}
            >
              {/* Top row: Thumbnail & Metadata */}
              <div className="flex items-center space-x-2.5">
                {/* Real Film Thumbnail */}
                <div className="w-14 h-10 rounded-md overflow-hidden bg-[#181d26] border border-[#263042] flex-shrink-0 shadow-inner relative flex items-center justify-center">
                  <span className="text-[9px] font-mono text-slate-500 select-none">FS</span>
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
                      <span className="text-[10px] font-mono font-bold px-1 py-0.2 rounded bg-[#1e2636] text-amber-400 border border-[#2b364a]">
                        {profile.id}
                      </span>
                      <span className={`text-xs font-bold tracking-wide truncate ${isSelected ? 'text-amber-300' : 'text-slate-100'}`}>
                        {profile.name}
                      </span>
                    </div>
                    {isSelected && (
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 animate-pulse flex-shrink-0 ml-1" />
                    )}
                  </div>
                  <div className="text-[10px] font-medium text-slate-400 truncate mt-0.5">
                    {profile.style}
                  </div>
                </div>
              </div>

              {/* Technical Description */}
              <p className="text-[10px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                {profile.description}
              </p>
            </button>
          );
        })}
      </div>
    </aside>
  );
};
