import React, { useRef, useState } from 'react';
import { Upload, ShieldCheck, Cpu, ArrowRight, Sparkles, Image as ImageIcon } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { decodeImageFile } from '../engine/image/decoder';
import { getAssetUrl } from '../utils/assets';
import { FILM_PROFILES } from '../films/registry';

export const ImageDropzone: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const { image, activeFilmId, setView, setImage } = useEditorStore();

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

  const loadSample = async (samplePath: string, name: string) => {
    try {
      const fullUrl = getAssetUrl(samplePath);
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const decoded = await decodeImageFile(blob, name);
      setImage(decoded);
    } catch (err) {
      alert(`Error loading sample: ${err}`);
    }
  };

  const currentFilm = FILM_PROFILES[activeFilmId];

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setIsDragOver(true);
      }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      className={`flex-1 flex flex-col items-center justify-center p-6 bg-[#07090c] transition-colors select-none ${
        isDragOver ? 'bg-[#0f141f] border-2 border-dashed border-[#ff824f]' : ''
      }`}
    >
      <input
        type="file"
        ref={fileInputRef}
        onChange={(e) => handleFiles(e.target.files)}
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
      />

      <div className="max-w-md w-full bg-[#11141b] border border-[#202735] rounded-2xl p-8 text-center shadow-2xl">
        <div className="w-16 h-16 rounded-2xl bg-[#141822] border border-[#273244] shadow-md flex items-center justify-center mx-auto mb-5">
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

        <div className="flex items-center justify-center space-x-2 mb-2">
          <h1 className="text-xl font-bold text-slate-100">Film Studio</h1>
          <span className="text-[10px] font-mono tracking-wider text-[#ff824f] bg-[#ff824f]/10 border border-[#ff824f]/30 px-1.5 py-0.5 rounded font-semibold">
            HD2Lab
          </span>
        </div>

        <p className="text-xs text-slate-400 mb-6 leading-relaxed">
          HD2Lab Browser-based Photographic Color Simulation Engine.
          Select or drag-and-drop a photo to begin color development.
        </p>

        {/* Continue Editing if session is active */}
        {image && (
          <div className="mb-5 p-3.5 rounded-xl bg-[#171d28] border border-amber-500/50 text-left">
            <div className="flex items-center space-x-3 mb-3">
              <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/40 border border-[#323d52] flex-shrink-0 flex items-center justify-center">
                {image.previewCanvas ? (
                  <img
                    src={image.previewCanvas.toDataURL('image/jpeg', 0.7)}
                    alt="Active Session"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <ImageIcon className="w-4 h-4 text-slate-500" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-mono uppercase text-amber-400 font-bold flex items-center gap-1">
                  <Sparkles className="w-3 h-3" /> Active Session
                </div>
                <div className="text-xs font-semibold text-slate-200 truncate">
                  {image.name}
                </div>
                <div className="text-[10px] text-slate-400 truncate">
                  Profile: {currentFilm?.name}
                </div>
              </div>
            </div>
            <button
              onClick={() => setView('editor')}
              data-testid="continue-editing-btn"
              className="w-full flex items-center justify-center space-x-2 py-2.5 px-4 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-bold text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer"
            >
              <span>Continue Editing</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full flex items-center justify-center space-x-2 py-3 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs tracking-wider uppercase transition-all shadow-md shadow-amber-950/30 cursor-pointer mb-6"
        >
          <Upload className="w-4 h-4" />
          <span>Select Photo (JPG, PNG, WebP)</span>
        </button>

        {/* Or load test targets */}
        <div className="border-t border-[#1d232f] pt-5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-slate-400 block mb-3">
            Or load calibration sample
          </span>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => loadSample('samples/film_test_portrait.jpg', 'HD2Lab_Film_Portrait.jpg')}
              className="px-2 py-2 rounded-lg bg-[#181d26] hover:bg-[#222937] border border-[#273042] text-xs text-slate-300 font-medium transition-colors cursor-pointer"
            >
              Portrait
            </button>
            <button
              onClick={() => loadSample('samples/color_chart.png', 'HD2Lab_Color_Target.png')}
              className="px-2 py-2 rounded-lg bg-[#181d26] hover:bg-[#222937] border border-[#273042] text-xs text-slate-300 font-medium transition-colors cursor-pointer"
            >
              Color Target
            </button>
            <button
              onClick={() => loadSample('samples/landscape_test.png', 'HD2Lab_Landscape_Gamut.png')}
              className="px-2 py-2 rounded-lg bg-[#181d26] hover:bg-[#222937] border border-[#273042] text-xs text-slate-300 font-medium transition-colors cursor-pointer"
            >
              Landscape
            </button>
          </div>
        </div>

        {/* Technical Guarantee Badge */}
        <div className="mt-6 pt-4 border-t border-[#1b202a] flex items-center justify-center space-x-4 text-[10px] text-slate-400 font-mono">
          <span className="flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" /> 100% Local (Zero Upload)
          </span>
          <span className="flex items-center gap-1">
            <Cpu className="w-3.5 h-3.5 text-amber-400" /> WebGL2 GPU Powered
          </span>
        </div>
      </div>
    </div>
  );
};
