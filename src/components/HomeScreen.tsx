import { getMargarinePreset } from '../presets/margarine';
import React, { useRef, useState } from 'react';
import {
  Upload,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Cpu,
  Image as ImageIcon,
  CheckCircle2,
  Layers,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { FILM_LIST, FILM_PROFILES } from '../films/registry';
import { decodeImageFile } from '../engine/image/decoder';
import { getAssetUrl } from '../utils/assets';
import { FilmId } from '../types/film';

export const HomeScreen: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);

  const {
    image,
    activeFilmId,
    activePresetId,
    adjustments,
    setFilm,
    setImage,
    setView,
  } = useEditorStore();

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    try {
      const decoded = await decodeImageFile(files[0]);
      setImage(decoded);
    } catch (err) {
      alert(`Error loading image: ${err}`);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    handleFiles(e.dataTransfer.files);
  };

  const loadSample = async (samplePath: string, name: string, targetFilmId?: FilmId) => {
    try {
      setIsLoadingSample(true);
      const fullUrl = getAssetUrl(samplePath);
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const decoded = await decodeImageFile(blob, name);
      if (targetFilmId) {
        setFilm(targetFilmId);
      }
      setImage(decoded);
    } catch (err) {
      alert(`Error loading sample: ${err}`);
    } finally {
      setIsLoadingSample(false);
    }
  };

  const baseFilm = FILM_PROFILES[activeFilmId];
  const preset = getMargarinePreset(activePresetId);
  const currentFilm = preset ? { ...baseFilm, name: preset.name, style: 'MARGARINE', id: 'MARGARINE' } : baseFilm;

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`flex-1 overflow-y-auto px-4 py-8 sm:py-12 bg-[#07090c] text-slate-100 select-none transition-colors ${
        isDragOver ? 'bg-[#0f1522] border-2 border-dashed border-[#ff824f]' : ''
      }`}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFiles(e.target.files)}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />

      <div className="max-w-4xl w-full mx-auto space-y-8">
        {/* Hero Section */}
        <div className="text-center space-y-3">
          <div className="w-16 h-16 rounded-2xl bg-[#141822] border border-[#273244] shadow-md flex items-center justify-center mx-auto mb-2">
            <svg
              className="w-9 h-9 text-[#ff824f]"
              viewBox="0 0 64 64"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-label="HD2Lab Brand Mark"
            >
              <path
                d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z"
                stroke="currentColor"
                strokeWidth="4"
                strokeLinejoin="round"
              />
            </svg>
          </div>

          <div className="flex items-center justify-center space-x-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
              Film Studio
            </h1>
            <span className="text-[11px] font-mono tracking-wider text-[#ff824f] bg-[#ff824f]/10 border border-[#ff824f]/30 px-2 py-0.5 rounded font-semibold">
              HD2Lab
            </span>
          </div>

          <p className="text-sm text-slate-300 max-w-xl mx-auto font-medium">
            The Northern Palette — Precision Photographic Color Development Engine
          </p>
          <p className="text-xs text-slate-400 max-w-2xl mx-auto leading-relaxed">
            Nine original film signatures engineered with WebGL2 3D LUTs and authentic characteristic curves.
            Perform precision analog color development 100% locally in your browser.
          </p>
        </div>

        {/* Active Session Notification / Continue Editing (Visible when image is loaded) */}
        {image && (
          <div className="p-4 sm:p-5 rounded-2xl bg-gradient-to-r from-[#171d28] via-[#1a2232] to-[#171d28] border border-amber-500/50 shadow-2xl relative overflow-hidden">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-4 min-w-0">
                <div className="w-14 h-14 rounded-xl overflow-hidden bg-black/50 border border-[#344055] flex-shrink-0 flex items-center justify-center shadow-inner relative">
                  {image.previewCanvas ? (
                    <img
                      src={image.previewCanvas.toDataURL('image/jpeg', 0.8)}
                      alt={image.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <ImageIcon className="w-6 h-6 text-slate-500" />
                  )}
                  <span className="absolute bottom-0 right-0 w-3 h-3 bg-emerald-500 rounded-full border-2 border-[#121620]" />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 font-bold flex items-center gap-1">
                      <Sparkles className="w-3 h-3" /> Active Session
                    </span>
                    <span className="text-[10px] font-mono text-slate-400">
                      • {image.originalWidth} × {image.originalHeight} px
                    </span>
                  </div>
                  <div className="text-sm font-bold text-slate-100 truncate">
                    {image.name}
                  </div>
                  <div className="text-xs text-slate-300 flex items-center gap-2 mt-0.5 font-mono">
                    <span>
                      Profile: <strong className="text-amber-300 font-sans">{currentFilm?.name}</strong>
                    </span>
                    <span className="text-slate-500">|</span>
                    <span>Strength: {adjustments.filmStrength}%</span>
                  </div>
                </div>
              </div>

              <button
                onClick={() => setView('editor')}
                data-testid="continue-editing-btn"
                className="flex-shrink-0 flex items-center justify-center space-x-2 py-3 px-6 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider shadow-lg shadow-amber-950/40 transition-all cursor-pointer hover:scale-[1.02] active:scale-[0.98]"
              >
                <span>Continue Editing</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Upload & Sample Quick Launch Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Box 1: Open Photo */}
          <div className="p-6 rounded-2xl bg-[#11141b] border border-[#202735] hover:border-[#2f3b4e] transition-all flex flex-col justify-between space-y-4 shadow-xl">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
                <Upload className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-slate-100">Open Photograph</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Choose a high-resolution photo from your device. All decoding and color development
                execute strictly within browser memory.
              </p>
            </div>

            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-md shadow-amber-950/30 cursor-pointer"
            >
              <Upload className="w-4 h-4" />
              <span>Select Photo (JPG, PNG, WebP)</span>
            </button>
          </div>

          {/* Box 2: Calibration Targets & Reference Samples */}
          <div className="p-6 rounded-2xl bg-[#11141b] border border-[#202735] hover:border-[#2f3b4e] transition-all flex flex-col justify-between space-y-4 shadow-xl">
            <div className="space-y-2">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
                <ImageIcon className="w-5 h-5" />
              </div>
              <h2 className="text-base font-bold text-slate-100">Calibration Samples</h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                Instantly test film color transformations and tonal response using standard photographic test subjects.
              </p>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <button
                disabled={isLoadingSample}
                onClick={() => loadSample('samples/film_test_portrait.jpg', 'HD2Lab_Film_Portrait.jpg')}
                className="p-2.5 rounded-xl bg-[#171c26] hover:bg-[#222a38] text-slate-200 border border-[#283141] hover:border-amber-500/40 text-xs font-semibold flex flex-col items-center text-center transition-all cursor-pointer"
              >
                <span className="font-sans">Portrait</span>
                <span className="text-[9px] font-mono text-amber-400 mt-0.5">35mm Film</span>
              </button>
              <button
                disabled={isLoadingSample}
                onClick={() => loadSample('samples/color_chart.png', 'HD2Lab_Color_Target.png')}
                className="p-2.5 rounded-xl bg-[#171c26] hover:bg-[#222a38] text-slate-200 border border-[#283141] hover:border-amber-500/40 text-xs font-semibold flex flex-col items-center text-center transition-all cursor-pointer"
              >
                <span className="font-sans">Color Target</span>
                <span className="text-[9px] font-mono text-slate-400 mt-0.5">24-Patch</span>
              </button>
              <button
                disabled={isLoadingSample}
                onClick={() => loadSample('samples/landscape_test.png', 'HD2Lab_Landscape_Gamut.png')}
                className="p-2.5 rounded-xl bg-[#171c26] hover:bg-[#222a38] text-slate-200 border border-[#283141] hover:border-amber-500/40 text-xs font-semibold flex flex-col items-center text-center transition-all cursor-pointer"
              >
                <span className="font-sans">Landscape</span>
                <span className="text-[9px] font-mono text-slate-400 mt-0.5">Gamut</span>
              </button>
            </div>
          </div>
        </div>

        {/* Film Signatures Showcase (All 9 Profiles) */}
        <div className="space-y-4 pt-2">
          <div className="flex items-center justify-between border-b border-[#1f2634] pb-3">
            <div>
              <h2 className="text-sm font-bold text-slate-100 uppercase tracking-wider flex items-center gap-2">
                <Layers className="w-4 h-4 text-[#ff824f]" />
                Original Film Signatures (9)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Authentic color models calibrated with 33³ 3D LUTs and tonal response curves
              </p>
            </div>
            <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-[#171c26] text-slate-400 border border-[#283141]">
              Collection
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
            {FILM_LIST.map((profile) => {
              const thumbUrl = getAssetUrl(`thumbnails/${profile.id}.jpg`);
              const isCurrent = image && activeFilmId === profile.id && !activePresetId;

              return (
                <div
                  key={profile.id}
                  onClick={() => {
                    if (image) {
                      setFilm(profile.id);
                      setView('editor');
                    } else {
                      loadSample('samples/film_test_portrait.jpg', 'HD2Lab_Film_Portrait.jpg', profile.id);
                    }
                  }}
                  className={`p-3 rounded-xl border text-left transition-all cursor-pointer group ${
                    isCurrent
                      ? 'bg-[#181f2c] border-amber-500/70 shadow-lg'
                      : 'bg-[#12151d] border-[#1f2634] hover:bg-[#161c28] hover:border-[#2f394c]'
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-14 h-10 rounded-md overflow-hidden bg-[#181d26] border border-[#273244] flex-shrink-0 relative flex items-center justify-center">
                      <span className="text-[8px] font-mono text-slate-500 select-none">FS</span>
                      <img
                        src={thumbUrl}
                        alt={profile.name}
                        className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
                        loading="lazy"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center space-x-1.5">
                        <span className="text-[9px] font-mono font-bold px-1 py-0.2 rounded bg-[#1c2331] text-amber-400 border border-[#283346]">
                          {profile.id}
                        </span>
                        <span className="text-xs font-bold text-slate-100 group-hover:text-amber-300 transition-colors truncate">
                          {profile.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-slate-400 truncate mt-0.5">
                        {profile.style}
                      </div>
                    </div>
                  </div>

                  <p className="text-[10px] text-slate-400 mt-2 line-clamp-2 leading-relaxed">
                    {profile.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        {/* Technical Guarantee & Security Badges */}
        <div className="pt-6 border-t border-[#1a202c] grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-xs text-slate-400">
          <div className="p-3 rounded-xl bg-[#0f1218] border border-[#1d232f] flex items-center justify-center space-x-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />
            <span className="font-mono text-[11px]">100% Local (Zero Server Upload)</span>
          </div>
          <div className="p-3 rounded-xl bg-[#0f1218] border border-[#1d232f] flex items-center justify-center space-x-2">
            <Cpu className="w-4 h-4 text-amber-400 flex-shrink-0" />
            <span className="font-mono text-[11px]">WebGL2 3D LUT Acceleration</span>
          </div>
          <div className="p-3 rounded-xl bg-[#0f1218] border border-[#1d232f] flex items-center justify-center space-x-2">
            <CheckCircle2 className="w-4 h-4 text-sky-400 flex-shrink-0" />
            <span className="font-mono text-[11px]">PWA & Offline Operational</span>
          </div>
        </div>
      </div>
    </div>
  );
};
