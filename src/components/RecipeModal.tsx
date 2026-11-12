import { getMargarinePreset } from '../presets/margarine';
import React, { useState, useRef } from 'react';
import { useEditorStore } from '../stores/editorStore';
import { FILM_PROFILES } from '../films/registry';
import { X, Bookmark, Plus, Copy, Trash2, Edit3, Download, Upload, Check } from 'lucide-react';
import { CustomRecipe } from '../types/film';

interface RecipeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const RecipeModal: React.FC<RecipeModalProps> = ({ isOpen, onClose }) => {
  const {
    recipes,
    saveCurrentAsRecipe,
    deleteRecipe,
    renameRecipe,
    duplicateRecipe,
    applyRecipe,
    importRecipe,
    activeFilmId,
    activePresetId,
  } = useEditorStore();

  const [newRecipeName, setNewRecipeName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [feedbackMsg, setFeedbackMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRecipeName.trim()) return;
    try {
      await saveCurrentAsRecipe(newRecipeName);
      setNewRecipeName('');
      setFeedbackMsg({ text: 'Recipe saved successfully!' });
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err) {
      setFeedbackMsg({ text: `Failed to save: ${err}`, error: true });
    }
  };

  const handleApply = (recipe: CustomRecipe) => {
    applyRecipe(recipe);
    setFeedbackMsg({ text: `Applied recipe "${recipe.name}"` });
    setTimeout(() => {
      setFeedbackMsg(null);
      onClose();
    }, 600);
  };

  const handleExport = (recipe: CustomRecipe) => {
    const jsonStr = JSON.stringify(recipe, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${recipe.name.replace(/\s+/g, '_')}_recipe.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const imported = await importRecipe(text);
      setFeedbackMsg({ text: `Successfully imported "${imported.name}"` });
      setTimeout(() => setFeedbackMsg(null), 3000);
    } catch (err: any) {
      setFeedbackMsg({ text: `Import failed: ${err.message || err}`, error: true });
    } finally {
      // Allow selecting the same file again after an import or a failed attempt.
      e.target.value = '';
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div role="dialog" aria-modal="true" aria-labelledby="recipe-manager-title" className="bg-[#12161f] border border-[#232b3b] rounded-2xl w-full max-w-xl shadow-2xl flex flex-col h-[min(640px,85dvh)] overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#202737] flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-2">
            <Bookmark className="w-5 h-5 text-amber-400" />
            <h2 id="recipe-manager-title" className="text-base font-bold text-slate-100">Film Recipe Manager</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Close recipe manager"
            className="p-1 rounded-lg hover:bg-[#1a202c] text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback alert */}
          <div
            role="status"
            className={`h-10 shrink-0 px-5 py-2 gap-2 text-xs font-medium flex items-center justify-between ${
              !feedbackMsg ? '' : feedbackMsg.error ? 'bg-red-950/80 text-red-300' : 'bg-emerald-950/80 text-emerald-300'
            }`}
          >
            <span className="min-w-0 truncate" title={feedbackMsg?.text}>{feedbackMsg?.text}</span>
            {feedbackMsg && <button aria-label="Dismiss recipe notification" className="shrink-0" onClick={() => setFeedbackMsg(null)}>
              <X className="w-3.5 h-3.5" />
            </button>}
          </div>

        {/* Save Current adjustments as new recipe */}
        <form onSubmit={handleSave} className="p-4 bg-[#161b26] border-b border-[#202737] flex gap-2 shrink-0">
          <input
            type="text"
            placeholder={`Save current ${getMargarinePreset(activePresetId)?.name || FILM_PROFILES[activeFilmId]?.name} adjustments as...`}
            value={newRecipeName}
            onChange={(e) => setNewRecipeName(e.target.value)}
            className="flex-1 min-w-0 bg-[#0e1118] border border-[#252f42] rounded-lg px-3 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-amber-500"
          />
          <button
            type="submit"
            disabled={!newRecipeName.trim()}
            className="px-3.5 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white font-semibold text-xs flex items-center gap-1 transition-all"
          >
            <Plus className="w-4 h-4" /> Save
          </button>
        </form>

        {/* Recipe List */}
        <div data-testid="recipe-list" className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 space-y-2.5">
          {recipes.length === 0 ? (
            <div className="text-center py-10 text-slate-500 text-xs">
              No saved recipes yet. Fine-tune any film look and save your recipe above!
            </div>
          ) : (
            recipes.map((rcp) => {
              const film = FILM_PROFILES[rcp.baseFilmId];
              const isEditing = editingId === rcp.id;

              return (
                <div
                  key={rcp.id}
                  className="bg-[#171c26] border border-[#232b3a] rounded-xl p-3 flex flex-col items-stretch gap-2 sm:flex-row sm:items-center sm:justify-between hover:border-[#2d384c] transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input
                          type="text"
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="bg-[#0e1118] border border-amber-500 rounded px-2 py-1 text-xs text-slate-200 w-full"
                          autoFocus
                        />
                        <button
                          onClick={async () => {
                            if (editingName.trim()) {
                              await renameRecipe(rcp.id, editingName);
                            }
                            setEditingId(null);
                          }}
                          className="p-1 rounded bg-amber-600 text-white hover:bg-amber-500"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div className="flex items-center space-x-2">
                          <span title={rcp.name} className="font-semibold text-xs text-slate-200 truncate">
                            {rcp.name}
                          </span>
                          <span className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#202735] text-amber-400 border border-[#2d3748]">
                            {getMargarinePreset(rcp.presetId) ? 'MARGARINE' : film?.name || rcp.baseFilmId}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-400 font-mono mt-0.5">
                          Exp: {rcp.adjustments.exposure}EV • Sat: {rcp.adjustments.saturation} • Grn: {rcp.adjustments.grain}
                        </div>
                      </>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center space-x-1">
                    <button
                      onClick={() => handleApply(rcp)}
                      className="px-2.5 py-1 rounded bg-amber-600/20 text-amber-400 hover:bg-amber-600 hover:text-white text-xs font-semibold transition-all border border-amber-500/30"
                    >
                      Apply
                    </button>
                    <button
                      onClick={() => {
                        setEditingId(rcp.id);
                        setEditingName(rcp.name);
                      }}
                      className="p-1.5 rounded hover:bg-[#222a38] text-slate-400 hover:text-slate-200"
                      title="Rename"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => duplicateRecipe(rcp.id)}
                      className="p-1.5 rounded hover:bg-[#222a38] text-slate-400 hover:text-slate-200"
                      title="Duplicate"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleExport(rcp)}
                      className="p-1.5 rounded hover:bg-[#222a38] text-slate-400 hover:text-slate-200"
                      title="Export JSON"
                    >
                      <Download className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => deleteRecipe(rcp.id)}
                      className="p-1.5 rounded hover:bg-red-950/60 text-slate-400 hover:text-red-400"
                      title="Delete"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer: Import JSON */}
        <div className="px-5 py-3 bg-[#10131b] border-t border-[#1f2634] flex flex-wrap gap-2 items-center justify-between text-xs shrink-0">
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleImportFile}
            accept=".json,application/json"
            className="hidden"
          />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 text-slate-300 hover:text-amber-400 font-medium transition-colors"
          >
            <Upload className="w-3.5 h-3.5" />
            <span>Import Recipe (.json)</span>
          </button>
          <span className="text-[10px] text-slate-400 font-mono">
            IndexedDB Offline Storage
          </span>
        </div>
      </div>
    </div>
  );
};
