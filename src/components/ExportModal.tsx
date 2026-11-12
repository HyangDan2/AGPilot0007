import { getMargarinePreset } from '../presets/margarine';
import React, { useState, useEffect, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { prepareExportImage, triggerSafeDownload } from '../engine/export/imageExporter';
import { loadCubeLut } from '../engine/color/lutLoader';
import { FILM_PROFILES } from '../films/registry';
import { PreparedExport, ExportFormat } from '../types/export';
import { isFileShareSupported, sharePreparedFile, isIOS, isAndroid } from '../utils/nativeShare';
import {
  X,
  Download,
  Share2,
  Eye,
  RotateCcw,
  CheckCircle,
  AlertCircle,
  Loader2,
  Smartphone,
} from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const { image, activeFilmId, activePresetId, adjustments, camera } = useEditorStore();

  const [stage, setStage] = useState<'config' | 'preparing' | 'ready'>('config');
  const [format, setFormat] = useState<ExportFormat>('image/jpeg');
  const [quality, setQuality] = useState<number>(0.92);
  const [scalePreset, setScalePreset] = useState<number>(1.0); // 1.0, 0.75, 0.5
  const [progress, setProgress] = useState<{ value: number; stage: string }>({
    value: 0,
    stage: '',
  });
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [statusFeedback, setStatusFeedback] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [showFullPreview, setShowFullPreview] = useState<boolean>(false);

  // Keep a ref to prepared for clean memory revoking on unmount
  const preparedRef = useRef<PreparedExport | null>(null);
  preparedRef.current = prepared;

  const shareSupported = isFileShareSupported();
  const iosPlatform = isIOS();
  const androidPlatform = isAndroid();

  // Clean up object URLs when modal unmounts
  useEffect(() => {
    return () => {
      if (preparedRef.current?.objectUrl) {
        URL.revokeObjectURL(preparedRef.current.objectUrl);
      }
    };
  }, []);

  // Keyboard navigation (Escape key handling)
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showFullPreview) {
          setShowFullPreview(false);
        } else if (stage !== 'preparing') {
          handleClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, showFullPreview, stage]);

  const handleClose = () => {
    if (stage === 'preparing') return;
    if (prepared?.objectUrl) {
      URL.revokeObjectURL(prepared.objectUrl);
    }
    setPrepared(null);
    setStage('config');
    setErrorMessage(null);
    setStatusFeedback(null);
    setShowFullPreview(false);
    onClose();
  };

  const handlePrepareAgain = () => {
    if (prepared?.objectUrl) {
      URL.revokeObjectURL(prepared.objectUrl);
    }
    setPrepared(null);
    setStage('config');
    setErrorMessage(null);
    setStatusFeedback(null);
  };

  const handlePrepare = async () => {
    if (!image) return;
    setStage('preparing');
    setErrorMessage(null);
    setStatusFeedback(null);
    setProgress({ value: 10, stage: 'Preparing color pipeline...' });

    try {
      const profile = FILM_PROFILES[activeFilmId];
      const lut = await loadCubeLut(profile.lutFile);

      const result = await prepareExportImage(
        image,
        lut,
        adjustments,
        {
          format,
          quality: format === 'image/jpeg' ? quality : 1.0,
          scale: scalePreset,
        },
        (p, currentStage) => {
          setProgress({ value: p, stage: currentStage });
        },
        camera,
        activeFilmId
      );

      // Clean up previous prepared objectUrl if existing
      if (prepared?.objectUrl) {
        URL.revokeObjectURL(prepared.objectUrl);
      }

      setPrepared(result);
      setStage('ready');
    } catch (err: any) {
      console.error('Preparation failed:', err);
      setErrorMessage(err.message || 'Photo preparation failed. Please verify GPU memory limits.');
      setStage('config');
    }
  };

  const handleNativeShare = async () => {
    if (!prepared) return;
    setStatusFeedback(null);
    setErrorMessage(null);

    // Direct invocation without preceding awaits to preserve transient user activation
    const res = await sharePreparedFile(prepared.file, {
      title: prepared.filename,
      text: `Photo developed with HD2Lab Film Studio (${getMargarinePreset(activePresetId)?.name || FILM_PROFILES[activeFilmId].name})`,
    });

    if (res.success) {
      setStatusFeedback('Shared successfully!');
    } else if (res.cancelled) {
      // User cancelled share sheet - silent, natural user choice
    } else if (res.error) {
      setErrorMessage(res.error);
    }
  };

  const handleDownload = () => {
    if (!prepared) return;
    setStatusFeedback('Download started!');
    setErrorMessage(null);
    triggerSafeDownload(prepared.blob, prepared.filename);
  };

  if (!isOpen || !image) return null;

  const baseFilm = FILM_PROFILES[activeFilmId];
  const preset = getMargarinePreset(activePresetId);
  const currentFilm = preset ? { ...baseFilm, name: preset.name, style: 'MARGARINE', id: 'MARGARINE' } : baseFilm;
  const origW = image.originalWidth;
  const origH = image.originalHeight;
  const targetW = Math.round(origW * scalePreset);
  const targetH = Math.round(origH * scalePreset);
  const megapixels = ((targetW * targetH) / 1_000_000).toFixed(1);

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4">
        <div className="bg-[#12161f] border border-[#232b3b] rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
          {/* Header */}
          <div className="px-5 py-4 border-b border-[#202737] flex items-center justify-between shrink-0">
            <div className="flex items-center space-x-2.5">
              <Download className="w-5 h-5 text-amber-400" />
              <div>
                <h2 className="text-base font-bold text-slate-100 flex items-center gap-2">
                  <span>Export Final Image</span>
                  <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                    {stage === 'ready' ? 'Stage B: Save & Share' : 'Stage A: Prepare'}
                  </span>
                </h2>
              </div>
            </div>
            {stage !== 'preparing' && (
              <button
                onClick={handleClose}
                aria-label="Close export dialog"
                className="p-1.5 rounded-lg hover:bg-[#1a202c] text-slate-400 hover:text-white transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* Modal Body */}
          <div className="p-5 space-y-4 overflow-y-auto text-xs text-slate-300">
            {/* STAGE A: Configuration */}
            {stage === 'config' && (
              <>
                {/* Active Film & Source Specs */}
                <div className="bg-[#171c26] p-3 rounded-xl border border-[#232a39] space-y-1.5 font-mono">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Selected Film:</span>
                    <span className="text-amber-400 font-semibold">{currentFilm.name} ({currentFilm.id})</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Target Resolution:</span>
                    <span className="text-slate-200">
                      {targetW} × {targetH} px ({megapixels} MP)
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Color Contract:</span>
                    <span className="text-slate-200">sRGB (IEC 61966-2-1)</span>
                  </div>
                </div>

                {/* Resolution Preset */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200">Output Resolution</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Full (100%)', scale: 1.0, sub: `${origW}×${origH}` },
                      { label: 'High (75%)', scale: 0.75, sub: `${Math.round(origW * 0.75)}×${Math.round(origH * 0.75)}` },
                      { label: 'Social (50%)', scale: 0.5, sub: `${Math.round(origW * 0.5)}×${Math.round(origH * 0.5)}` },
                    ].map((preset) => (
                      <button
                        key={preset.scale}
                        type="button"
                        onClick={() => setScalePreset(preset.scale)}
                        className={`py-2 px-2 rounded-lg border text-center transition-all ${
                          scalePreset === preset.scale
                            ? 'bg-amber-600/20 border-amber-500 text-amber-300 font-bold'
                            : 'bg-[#181d26] border-[#262f3f] text-slate-400 hover:text-slate-200'
                        }`}
                      >
                        <div className="text-xs">{preset.label}</div>
                        <div className="text-[10px] text-slate-500 font-mono mt-0.5">{preset.sub}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Format selection */}
                <div className="space-y-1.5">
                  <label className="font-semibold text-slate-200">Output Format</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setFormat('image/jpeg')}
                      className={`py-2 px-3 rounded-lg border text-center font-medium transition-all ${
                        format === 'image/jpeg'
                          ? 'bg-amber-600/20 border-amber-500 text-amber-300 font-bold'
                          : 'bg-[#181d26] border-[#262f3f] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      JPEG (Compact)
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormat('image/png')}
                      className={`py-2 px-3 rounded-lg border text-center font-medium transition-all ${
                        format === 'image/png'
                          ? 'bg-amber-600/20 border-amber-500 text-amber-300 font-bold'
                          : 'bg-[#181d26] border-[#262f3f] text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      PNG (Lossless)
                    </button>
                  </div>
                </div>

                {/* JPEG Quality Slider */}
                {format === 'image/jpeg' && (
                  <div className="space-y-1.5">
                    <div className="flex justify-between font-semibold">
                      <span className="text-slate-200">JPEG Quality</span>
                      <span className="text-amber-400 font-mono">{Math.round(quality * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min={0.5}
                      max={1.0}
                      step={0.01}
                      value={quality}
                      onChange={(e) => setQuality(parseFloat(e.target.value))}
                      className="w-full accent-amber-500 cursor-pointer"
                    />
                    <div className="flex justify-between text-[10px] text-slate-400">
                      <span>Standard (80%)</span>
                      <span>High (92%)</span>
                      <span>Maximum (100%)</span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* STAGE A: Preparing Progress */}
            {stage === 'preparing' && (
              <div className="py-8 space-y-4">
                <div className="flex flex-col items-center justify-center space-y-3 text-center">
                  <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
                  <div>
                    <h3 className="text-sm font-semibold text-slate-100">Developing Photograph...</h3>
                    <p className="text-xs text-slate-400 mt-1">{progress.stage}</p>
                  </div>
                </div>
                <div className="space-y-1.5 max-w-sm mx-auto">
                  <div className="flex justify-between text-[11px] text-slate-400">
                    <span>Rendering pipeline</span>
                    <span className="font-mono">{progress.value}%</span>
                  </div>
                  <div className="w-full h-2.5 bg-[#191e28] rounded-full overflow-hidden border border-[#232a39]">
                    <div
                      className="h-full bg-gradient-to-r from-amber-600 to-amber-400 transition-all duration-200 rounded-full"
                      style={{ width: `${progress.value}%` }}
                    />
                  </div>
                </div>
              </div>
            )}

            {/* STAGE B: Ready to Save or Share */}
            {stage === 'ready' && prepared && (
              <div className="space-y-4">
                {/* Prepared Preview Card */}
                <div className="relative bg-[#171c26] rounded-xl border border-[#232a39] p-3 flex gap-3.5 items-center">
                  <div
                    onClick={() => setShowFullPreview(true)}
                    className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-lg overflow-hidden border border-[#2a3447] bg-black/50 shrink-0 cursor-pointer group"
                    title="Click to preview full image"
                  >
                    <img
                      src={prepared.objectUrl}
                      alt={prepared.filename}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <Eye className="w-5 h-5 text-white drop-shadow" />
                    </div>
                  </div>

                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 text-emerald-400 text-xs font-semibold">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>Photo Prepared in Memory</span>
                    </div>
                    <div className="text-xs font-mono text-slate-200 truncate" title={prepared.filename}>
                      {prepared.filename}
                    </div>
                    <div className="flex flex-wrap gap-1.5 text-[10px] text-slate-400 font-mono">
                      <span className="bg-[#202737] px-2 py-0.5 rounded border border-[#2b354a]">
                        {prepared.width} × {prepared.height} px
                      </span>
                      <span className="bg-[#202737] px-2 py-0.5 rounded border border-[#2b354a]">
                        {prepared.format === 'image/jpeg' ? 'JPEG' : 'PNG'}
                      </span>
                      <span className="bg-[#202737] px-2 py-0.5 rounded border border-[#2b354a] text-amber-300 font-semibold">
                        {prepared.formattedSize}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 pt-0.5">
                      Choose an action below. The prepared image will not need to re-render.
                    </p>
                  </div>
                </div>

                {/* Primary Action Buttons */}
                <div className="space-y-2 pt-1">
                  {/* Save to Photos / Share */}
                  {shareSupported ? (
                    <button
                      type="button"
                      onClick={handleNativeShare}
                      className="w-full py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-amber-950/40 cursor-pointer active:scale-[0.99]"
                    >
                      <Share2 className="w-4 h-4" />
                      <span>Save to Photos / Share</span>
                    </button>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-[#171c26] border border-[#232b3b] flex items-center justify-between text-slate-400">
                      <div className="flex items-center gap-2">
                        <Share2 className="w-4 h-4 text-slate-500" />
                        <span className="text-xs">Native Share unavailable in this browser</span>
                      </div>
                      <span className="text-[10px] text-slate-500">Use Download below</span>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-2">
                    {/* Download File */}
                    <button
                      type="button"
                      onClick={handleDownload}
                      className="py-2.5 px-3 rounded-xl bg-[#1d2433] hover:bg-[#252e40] border border-[#2f3b52] hover:border-slate-500 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
                    >
                      <Download className="w-4 h-4 text-amber-400" />
                      <span>Download File</span>
                    </button>

                    {/* Preview Image */}
                    <button
                      type="button"
                      onClick={() => setShowFullPreview(true)}
                      className="py-2.5 px-3 rounded-xl bg-[#1d2433] hover:bg-[#252e40] border border-[#2f3b52] hover:border-slate-500 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2 transition-all cursor-pointer active:scale-[0.99]"
                    >
                      <Eye className="w-4 h-4 text-sky-400" />
                      <span>Preview Image</span>
                    </button>
                  </div>
                </div>

                {/* Mobile / Device Hints */}
                <div className="bg-[#151a24] rounded-xl border border-[#202737] p-3 text-[11px] text-slate-400 space-y-1">
                  <div className="flex items-center gap-1.5 text-slate-300 font-semibold">
                    <Smartphone className="w-3.5 h-3.5 text-amber-400" />
                    <span>Device Saving Instructions</span>
                  </div>
                  {iosPlatform ? (
                    <p className="text-slate-400 leading-relaxed">
                      <strong className="text-slate-200">iOS Safari:</strong> Tap <span className="text-amber-300">Save to Photos / Share</span> and select <span className="text-slate-200 font-medium">"Save Image"</span> in the iOS share sheet to store directly in Apple Photos. Alternatively, open <span className="text-sky-300">Preview Image</span> and long-press the photo.
                    </p>
                  ) : androidPlatform ? (
                    <p className="text-slate-400 leading-relaxed">
                      <strong className="text-slate-200">Android Chrome:</strong> Tap <span className="text-amber-300">Save to Photos / Share</span> to send the photo directly to Google Photos, Gallery, or messaging apps.
                    </p>
                  ) : (
                    <p className="text-slate-400 leading-relaxed">
                      <strong className="text-slate-200">Desktop / Browser:</strong> Click <span className="text-amber-300">Download File</span> to save the full-resolution file to your downloads directory.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* Status Feedback Toast */}
            {statusFeedback && (
              <div className="p-3 rounded-lg bg-emerald-950/70 border border-emerald-800 text-emerald-300 flex items-center gap-2">
                <CheckCircle className="w-4 h-4 shrink-0" />
                <span className="font-semibold text-xs">{statusFeedback}</span>
              </div>
            )}

            {/* Error Message */}
            {errorMessage && (
              <div className="p-3 rounded-lg bg-red-950/70 border border-red-800 text-red-300 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span className="text-xs">{errorMessage}</span>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3.5 bg-[#0e1117] border-t border-[#1f2635] flex items-center justify-between shrink-0">
            {stage === 'ready' ? (
              <button
                type="button"
                onClick={handlePrepareAgain}
                className="px-3.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[#1a202c] transition-colors text-xs font-medium flex items-center gap-1.5 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
                <span>Prepare Again</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={handleClose}
                disabled={stage === 'preparing'}
                className="px-3.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-[#1a202c] transition-colors text-xs font-medium disabled:opacity-40 cursor-pointer"
              >
                Cancel
              </button>
            )}

            {stage === 'config' && (
              <button
                type="button"
                onClick={handlePrepare}
                className="px-5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-amber-950/30 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Prepare Photo</span>
              </button>
            )}

            {stage === 'ready' && (
              <button
                type="button"
                onClick={handleClose}
                className="px-4 py-1.5 rounded-lg bg-[#1a202c] hover:bg-[#232b3b] text-slate-200 hover:text-white text-xs font-medium transition-colors cursor-pointer"
              >
                Done
              </button>
            )}
          </div>
        </div>
      </div>

      {/* STAGE B: Fullscreen Image Preview Overlay */}
      {showFullPreview && prepared && (
        <div className="fixed inset-0 z-[60] bg-black/95 flex flex-col">
          {/* Preview Header */}
          <div className="px-3 sm:px-4 py-2.5 sm:py-3 bg-[#0e1117]/95 border-b border-[#202737] flex items-center justify-between z-10 shrink-0 gap-2">
            <div className="flex items-center space-x-2 text-slate-200 min-w-0 flex-1">
              <Eye className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="font-semibold text-xs truncate">{prepared.filename}</span>
              <span className="text-[10px] text-slate-400 font-mono hidden sm:inline shrink-0">
                ({prepared.width}×{prepared.height} px, {prepared.formattedSize})
              </span>
            </div>
            <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
              {shareSupported && (
                <button
                  type="button"
                  onClick={handleNativeShare}
                  className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Share</span>
                </button>
              )}
              <button
                type="button"
                onClick={handleDownload}
                className="px-2.5 sm:px-3 py-1.5 rounded-lg bg-[#1f2635] hover:bg-[#2a3447] text-slate-100 font-medium text-xs flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Download className="w-3.5 h-3.5 text-amber-400" />
                <span className="hidden sm:inline">Download</span>
              </button>
              <button
                type="button"
                onClick={() => setShowFullPreview(false)}
                aria-label="Close preview"
                className="p-1.5 rounded-lg bg-[#1f2635] hover:bg-[#2a3447] text-slate-300 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Full Preview Image Display */}
          <div className="flex-1 overflow-auto flex items-center justify-center p-4">
            <img
              src={prepared.objectUrl}
              alt="Full Resolution Export Preview"
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl border border-[#232b3b]"
            />
          </div>

          {/* Manual Save / Long-press Guidance Banner */}
          <div className="px-4 py-2.5 bg-[#0e1117]/95 border-t border-[#202737] text-center text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5 text-amber-400 font-semibold">
              <Smartphone className="w-3.5 h-3.5" />
              <span>Mobile Save Tip:</span>
            </span>{' '}
            <span>Long-press (tap and hold) the image above and choose <strong className="text-white">"Save to Photos"</strong> or <strong className="text-white">"Save Image"</strong>.</span>
          </div>
        </div>
      )}
    </>
  );
};
