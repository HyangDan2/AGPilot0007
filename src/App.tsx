import {useUIStore} from './stores/uiStore';
import {ColorMixerButton} from './components/ColorMixer';
import {ToneCurveButton} from './components/ToneCurve';
import {CameraEffectsButton} from './components/CameraEffects';
import { WorkspaceStrip } from './components/Workspace';
import { FilterSetModal } from './components/FilterSet';
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
import { MargarineModal } from './components/MargarineModal';
import { Sliders, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

export const App: React.FC = () => {
  const {leftCollapsed,rightCollapsed,toggleLeft,toggleRight}=useUIStore();
  const [isRecipeModalOpen, setIsRecipeModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isTabletAdjustmentsOpen, setIsTabletAdjustmentsOpen] = useState(false);

  const { loadRecipes, image, currentView } = useEditorStore();

  useEffect(() => {
    loadRecipes();
  }, [loadRecipes]);

  useEffect(()=>{const media=window.matchMedia('(min-width: 1280px)');const change=()=>{if(media.matches)setIsTabletAdjustmentsOpen(false);};media.addEventListener('change',change);return()=>media.removeEventListener('change',change);},[]);

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
    <div className="flex flex-col h-[100dvh] w-full overflow-hidden bg-[var(--ui-bg-07090d)] text-[color:var(--ui-text-e2e8f0)]">
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
          <div data-testid="left-sidebar" className="hidden md:flex flex-shrink-0 relative">
            <div className={leftCollapsed?'xl:hidden':''}><FilmSelector /></div>
            {!leftCollapsed&&<button type="button" aria-label="Collapse left sidebar" title="Collapse Film Profiles" onClick={toggleLeft} className="hidden xl:grid absolute right-0 top-1/2 z-10 -translate-y-1/2 place-items-center rounded-l border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-121722)] px-0.5 py-3 text-[color:var(--ui-text-slate200)]"><ChevronLeft className="h-4 w-4"/></button>}
            {leftCollapsed&&<aside aria-label="Collapsed film sidebar" className="hidden xl:flex w-9 flex-col items-center border-r border-[color:var(--ui-border-slate700)] bg-[var(--ui-bg-0d0f14)] py-3"><button type="button" aria-label="Expand left sidebar" title="Show Film Profiles" onClick={toggleLeft} className="rounded border border-[color:var(--ui-border-slate600)] p-1 text-[color:var(--ui-text-slate200)]"><ChevronRight className="h-4 w-4"/></button></aside>}
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
                      : 'bg-[var(--ui-bg-141822)]/90 text-[color:var(--ui-text-slate200)] border-[color:var(--ui-border-2b3548)] hover:bg-[var(--ui-bg-1a202c)]'
                  }`}
                >
                  <Sliders className="w-3.5 h-3.5 text-[color:var(--ui-text-amber-400)]" />
                  <span>Adjustments</span>
                  {isTabletAdjustmentsOpen ? <ChevronDown aria-hidden="true" className="w-3.5 h-3.5" /> : <ChevronUp aria-hidden="true" className="w-3.5 h-3.5" />}
                </button>
              </div>
            )}
          </div>

          {/* Right: Manual Adjustments (Desktop fixed, Tablet slide-over) */}
          <div
            data-testid="right-sidebar"
            className={`relative flex-shrink-0 ${
              isTabletAdjustmentsOpen
                ? 'fixed inset-y-0 right-0 z-40 shadow-2xl flex md:flex'
                : 'hidden xl:flex'
            }`}
          >
            <div className={rightCollapsed?'xl:hidden h-full':'h-full'}><AdjustmentPanel
              onClose={isTabletAdjustmentsOpen ? () => setIsTabletAdjustmentsOpen(false) : undefined}
            /></div>
            {!rightCollapsed&&<button type="button" aria-label="Collapse right sidebar" title="Collapse Adjustments" onClick={toggleRight} className="hidden xl:grid absolute left-0 top-1/2 z-10 -translate-y-1/2 place-items-center rounded-r border border-[color:var(--ui-border-slate600)] bg-[var(--ui-bg-121722)] px-0.5 py-3 text-[color:var(--ui-text-slate200)]"><ChevronRight className="h-4 w-4"/></button>}
            {rightCollapsed&&<aside aria-label="Collapsed adjustment sidebar" className="hidden xl:flex w-10 flex-col items-center gap-2 border-l border-[color:var(--ui-border-slate700)] bg-[var(--ui-bg-0d0f14)] py-3"><button type="button" aria-label="Expand right sidebar" title="Show Adjustments" onClick={toggleRight} className="rounded border border-[color:var(--ui-border-slate600)] p-1 text-[color:var(--ui-text-slate200)]"><ChevronLeft className="h-4 w-4"/></button><ColorMixerButton/><ToneCurveButton/><CameraEffectsButton/></aside>}
          </div>
        </div>

        <WorkspaceStrip />

        {/* Mobile Drawer Controls (Mobile Only < 768px) */}
        <div className="md:hidden flex-shrink-0">
          <MobileControls />
        </div>
      </div>

      {/* Modals */}
      <MargarineModal />
      <FilterSetModal />
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
