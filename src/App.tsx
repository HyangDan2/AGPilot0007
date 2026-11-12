import React, { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { HomeScreen } from './components/HomeScreen';
import { FilmSelector } from './components/FilmSelector';
import { Viewport } from './components/Viewport';
import { AdjustmentPanel } from './components/AdjustmentPanel';
import { MobileControls } from './components/MobileControls';
import { RecipeModal } from './components/RecipeModal';
import { ExportModal } from './components/ExportModal';
import { useEditorStore } from './stores/editorStore';
import { Sliders, X } from 'lucide-react';

export const App: React.FC = () => {
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isTabletAdjustmentsOpen, setIsTabletAdjustmentsOpen] = useState(false);

  const { loadRecipes, image, currentView } = useEditorStore();

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  // Global keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Y)
  // Strictly avoid intercepting shortcuts when inputs or textareas are focused
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl instanceof HTMLInputElement ||
        activeEl instanceof HTMLTextAreaElement ||
        (activeEl && activeEl.getAttribute('contenteditable') === 'true')
      ) {
        return;
      }

      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        if (e.shiftKey) {
          e.preventDefault();
          useEditorStore.getState().redo();
        } else {
          e.preventDefault();
          useEditorStore.getState().undo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
        e.preventDefault();
        useEditorStore.getState().redo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  return (
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-[#07090d] text-[#e2e8f0]">
      {/* Top Header */}
      <Header
        onOpenRecipes={() => setIsRecipeModalOpen(true)}
        onOpenExport={() => setIsExportModalOpen(true)}
      />

      {/* View 1: Home Screen View */}
      {currentView === 'home' && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0 min-w-0">
          <HomeScreen />
        </div>
      )}

      {/* View 2: Editor Workspace View */}
      <div className={`flex-1 overflow-hidden min-h-0 min-w-0 flex-col ${currentView === 'editor' ? 'flex' : 'hidden'}`}>
        <div className="flex-1 flex overflow-hidden relative min-h-0 min-w-0">
          {/* Left: Film Profiles (Visible on Desktop & Tablet >= 768px) */}
          <div className="hidden md:flex flex-shrink-0">
            <FilmSelector />
          </div>

          {/* Center: Image Viewport */}
          <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
            <Viewport />

            {/* Tablet Floating Adjustment Toggle Button (768px - 1199px) */}
            {image && (
              <div className="hidden md:block xl:hidden absolute top-3 right-3 z-20">
                <button
                  onClick={() => setIsTabletAdjustmentsOpen(!isTabletAdjustmentsOpen)}
                  className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full text-xs font-semibold backdrop-blur-md shadow-lg border transition-all ${
                    isTabletAdjustmentsOpen
                      ? 'bg-amber-600 text-white border-amber-500'
                      : 'bg-[#141822]/90 text-slate-200 border-[#2b3548] hover:bg-[#1a202c]'
                  }`}
                >
                  {isTabletAdjustmentsOpen ? <X className="w-3.5 h-3.5" /> : <Sliders className="w-3.5 h-3.5 text-amber-400" />}
                  <span>Adjustments</span>
                </button>
              </div>
            )}
          </div>

          {/* Right: Manual Adjustments (Desktop fixed, Tablet slide-over) */}
          <div
            className={`flex-shrink-0 ${
              isTabletAdjustmentsOpen
                ? 'fixed inset-y-0 right-0 z-40 shadow-2xl flex md:flex'
                : 'hidden xl:flex'
            }`}
          >
            <AdjustmentPanel
              onClose={isTabletAdjustmentsOpen ? () => setIsTabletAdjustmentsOpen(false) : undefined}
            />
          </div>
        </div>

        {/* Mobile Drawer Controls (Mobile Only < 768px) */}
        <div className="md:hidden flex-shrink-0">
          <MobileControls />
        </div>
      </div>

      {/* Modals */}
      <RecipeModal
        isOpen={isRecipeModalOpen}
        onClose={() => setIsRecipeModalOpen(false)}
      />

      <ExportModal
        isOpen={isExportModalOpen}
        onClose={() => setIsExportModalOpen(false)}
      />
    </div>
  );
};

export default App;
