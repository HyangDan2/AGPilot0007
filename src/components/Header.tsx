import {useUIStore,openPhotoChooser} from '../stores/uiStore';
import {OpenModal} from './Workspace';
import React, { useRef, useState, useEffect } from 'react';
import {
  Sun,
  Moon,
  Upload,
  Download,
  Bookmark,
  RotateCcw,
  Undo2,
  Redo2,
  Image as ImageIcon,
  MoreVertical,
  X,
  Globe,
  AppWindow,
  ExternalLink,
} from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { decodeImageFile } from '../engine/image/decoder';
import { getAssetUrl } from '../utils/assets';

interface HeaderProps {
  onOpenRecipes: () => void;
  onOpenExport: () => void;
}

export const Header: React.FC<HeaderProps> = ({ onOpenRecipes, onOpenExport }) => {
  const {isOpenDialog,setOpenDialog:setIsOpenDialog,theme,setTheme}=useUIStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const {
    image,
    setImage,
    undo,
    redo,
    canUndo,
    canRedo,
    resetAdjustments,
    setView,
  } = useEditorStore();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value='';
    try {
      const decoded = await decodeImageFile(file);
      setImage(decoded);
      setView('editor');
      setIsMenuOpen(false);
    } catch (err) {
      alert(`Error loading image: ${err}`);
    }
  };

  const loadSample = async (sampleRelPath: string, name: string) => {
    try {
      const fullUrl = getAssetUrl(sampleRelPath);
      const res = await fetch(fullUrl);
      const blob = await res.blob();
      const decoded = await decodeImageFile(blob, name);
      setImage(decoded);
      setView('editor');
      setIsMenuOpen(false);
    } catch (err) {
      alert(`Error loading sample: ${err}`);
    }
  };

  // Close menu on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsMenuOpen(false);
      }
    };
    if (isMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  // Handle Escape key to close menu and restore focus
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isMenuOpen) {
        e.preventDefault();
        setIsMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isMenuOpen]);

  return (
    <header className="h-14 bg-[var(--ui-bg-0f1218)] border-b border-[color:var(--ui-border-1f2532)] px-3 sm:px-4 flex items-center justify-between z-30 flex-shrink-0 select-none relative">
      {/* Brand & Title — Interactive Logo/Home Navigation */}
      <button
        type="button"
        onClick={() => setView('home')}
        aria-label="Go to Film Studio home"
        title="Go to Film Studio home"
        className="flex items-center space-x-2.5 p-1 -m-1 rounded-xl text-left transition-all hover:bg-[var(--ui-bg-161a22)] focus:outline-none focus:ring-2 focus:ring-[#ff824f]/60 cursor-pointer group"
      >
        <div className="w-8 h-8 rounded-lg bg-[var(--ui-bg-161a22)] group-hover:bg-[var(--ui-bg-1e2430)] border border-[color:var(--ui-border-293242)] group-hover:border-[color:var(--ui-border-ff824f)]/50 flex items-center justify-center shadow-sm flex-shrink-0 transition-colors">
          <svg
            className="w-5 h-5 text-[color:var(--ui-text-ff824f)]"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            aria-label="HD2Lab Logo"
          >
            <path
              d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z"
              stroke="currentColor"
              strokeWidth="4.5"
              strokeLinejoin="round"
            />
          </svg>
        </div>
        <div className="flex flex-col">
          <div className="flex items-center space-x-1.5 sm:space-x-2">
            <span className="font-bold tracking-tight text-xs sm:text-sm text-[color:var(--ui-text-slate100)] group-hover:text-[color:var(--ui-text-slate100)] transition-colors">
              Film Studio
            </span>
            <span className="text-[9px] sm:text-[10px] font-mono tracking-wider text-[color:var(--ui-text-ff824f)] bg-[#ff824f]/10 border border-[color:var(--ui-border-ff824f)]/30 px-1.5 py-0.5 rounded font-semibold">
              HD2Lab
            </span>
          </div>
          <span className="text-[10px] text-[color:var(--ui-text-slate400)] font-mono tracking-tight hidden lg:inline">
            Precision Color Development Engine
          </span>
        </div>
      </button>

      {/* Center Actions: Sample images quick switcher (Desktop/Tablet) */}
      <div className="hidden md:flex items-center space-x-2">
        <span className="text-xs text-[color:var(--ui-text-slate400)] font-medium mr-1 flex items-center gap-1">
          <ImageIcon className="w-3.5 h-3.5" /> Samples:
        </span>
        <button
          onClick={() => loadSample('samples/film_test_portrait.jpg', 'HD2Lab_Film_Portrait.jpg')}
          className="text-xs px-2.5 py-1.5 rounded-md bg-[var(--ui-bg-171c26)] hover:bg-[var(--ui-bg-222a38)] text-[color:var(--ui-text-slate300)] border border-[color:var(--ui-border-283141)] transition-colors cursor-pointer"
          title="Outdoor Photographic Film Reference"
        >
          Portrait
        </button>
        <button
          onClick={() => loadSample('samples/color_chart.png', 'HD2Lab_Color_Target.png')}
          className="text-xs px-2.5 py-1.5 rounded-md bg-[var(--ui-bg-171c26)] hover:bg-[var(--ui-bg-222a38)] text-[color:var(--ui-text-slate300)] border border-[color:var(--ui-border-283141)] transition-colors cursor-pointer"
          title="Color Calibration Chart"
        >
          Color Target
        </button>
        <button
          onClick={() => loadSample('samples/landscape_test.png', 'HD2Lab_Landscape_Gamut.png')}
          className="text-xs px-2.5 py-1.5 rounded-md bg-[var(--ui-bg-171c26)] hover:bg-[var(--ui-bg-222a38)] text-[color:var(--ui-text-slate300)] border border-[color:var(--ui-border-283141)] transition-colors cursor-pointer"
          title="Foliage & Sky Gamut"
        >
          Landscape
        </button>
      </div>

      {/* Right Actions */}
      <div className="flex items-center space-x-1.5 sm:space-x-2">
        {/* Desktop History & Reset */}
        <div className="hidden md:flex items-center space-x-1">
          <button
            onClick={undo}
            disabled={!canUndo}
            className="p-2 rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] hover:bg-[var(--ui-bg-1a202c)] transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            title="Undo (Ctrl+Z)"
            aria-label="Undo"
          >
            <Undo2 className="w-4 h-4" />
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className="p-2 rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] hover:bg-[var(--ui-bg-1a202c)] transition-colors disabled:opacity-30 disabled:pointer-events-none cursor-pointer"
            title="Redo (Ctrl+Y)"
            aria-label="Redo"
          >
            <Redo2 className="w-4 h-4" />
          </button>
          <button
            onClick={resetAdjustments}
            className="p-2 rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] hover:bg-[var(--ui-bg-1a202c)] transition-colors cursor-pointer"
            title="Reset Adjustments"
            aria-label="Reset Adjustments"
          >
            <RotateCcw className="w-4 h-4" />
          </button>

          <div className="w-[1px] h-5 bg-[var(--ui-bg-252b37)] mx-1" />

          {/* Recipes */}
          <button
            onClick={onOpenRecipes}
            className="flex items-center space-x-1 px-3 py-2 rounded-lg text-xs font-medium text-[color:var(--ui-text-slate200)] bg-[var(--ui-bg-161a22)] hover:bg-[var(--ui-bg-202734)] border border-[color:var(--ui-border-273040)] transition-colors cursor-pointer"
          >
            <Bookmark className="w-3.5 h-3.5 text-[color:var(--ui-text-amber-400)]" />
            <span>Recipes</span>
          </button>
        </div>

        {isOpenDialog&&<OpenModal onClose={()=>setIsOpenDialog(false)} onPhoto={()=>fileInputRef.current?.click()}/>}
        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileUpload}
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
        />

        <button type="button" data-testid="theme-toggle" aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'} title={theme==='dark'?'Light theme':'Dark theme'} onClick={()=>setTheme(theme==='dark'?'light':'dark')} className="hidden sm:grid min-h-[36px] min-w-[32px] place-items-center rounded-lg border border-[color:var(--ui-border-slate600)] text-[color:var(--ui-text-slate300)] hover:bg-[var(--ui-bg-slate800)]">{theme==='dark'?<Sun className="h-4 w-4"/>:<Moon className="h-4 w-4"/>}</button>
        {/* Open Button (Visible on all viewports) */}
        <button
          onClick={() => openPhotoChooser(()=>fileInputRef.current?.click())}
          aria-label="Open photo"
          title="Open photo"
          className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center space-x-1.5 px-3 py-2 rounded-lg text-xs font-semibold text-[color:var(--ui-text-slate200)] bg-[var(--ui-bg-181e28)] hover:bg-[var(--ui-bg-222b3a)] border border-[color:var(--ui-border-2d3748)] transition-colors cursor-pointer"
        >
          <Upload className="w-4 h-4" />
          <span className="hidden sm:inline">Open</span>
        </button>

        {/* Export Button (Visible on all viewports) */}
        <button
          onClick={onOpenExport}
          disabled={!image}
          aria-label="Export photo"
          title="Export photo"
          className="min-h-[44px] min-w-[44px] sm:min-w-0 sm:min-h-0 flex items-center justify-center space-x-1.5 px-3.5 py-2 rounded-lg text-xs font-semibold text-white bg-amber-600 hover:bg-amber-500 shadow-sm transition-all disabled:opacity-40 disabled:pointer-events-none cursor-pointer"
        >
          <Download className="w-4 h-4" />
          <span>Export</span>
        </button>

        {/* Three-Dot Menu Toggle — Accessible across Desktop, Tablet, and Mobile */}
        <div className="relative" ref={menuRef}>
          <button
            ref={menuButtonRef}
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="More options"
            aria-haspopup="true"
            aria-expanded={isMenuOpen}
            id="main-nav-menu-button"
            title="More options and navigation"
            className="min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] hover:bg-[var(--ui-bg-1a202c)] border border-[color:var(--ui-border-242c3c)] focus:outline-none focus:ring-2 focus:ring-[#ff824f]/60 transition-colors cursor-pointer"
          >
            {isMenuOpen ? <X className="w-4 h-4" /> : <MoreVertical className="w-4 h-4" />}
          </button>

          {/* Persistent Dropdown Menu */}
          {isMenuOpen && (
            <div
              role="menu"
              aria-labelledby="main-nav-menu-button"
              className="absolute right-0 top-11 sm:top-12 w-64 bg-[var(--ui-bg-131720)] border border-[color:var(--ui-border-283244)] rounded-xl shadow-2xl p-2 z-50 space-y-1 select-none"
            >
              <button type="button" role="menuitem" data-testid="theme-menu-toggle" aria-label={theme==='dark'?'Switch to light theme':'Switch to dark theme'} onClick={()=>{setTheme(theme==='dark'?'light':'dark');setIsMenuOpen(false);}} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[color:var(--ui-text-slate200)] hover:bg-[var(--ui-bg-slate800)]">{theme==='dark'?<Sun className="h-4 w-4"/>:<Moon className="h-4 w-4"/>}{theme==='dark'?'Light theme':'Dark theme'}</button>
              {/* Workspace Group */}
              <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[color:var(--ui-text-slate400)]">
                Workspace
              </div>

              <button
                onClick={() => {
                  onOpenRecipes();
                  setIsMenuOpen(false);
                }}
                className="w-full flex items-center space-x-2 px-3 py-2 rounded-lg text-xs font-medium text-[color:var(--ui-text-slate200)] hover:bg-[var(--ui-bg-1e2533)] hover:text-[color:var(--ui-text-amber-400)] transition-colors cursor-pointer"
              >
                <Bookmark className="w-4 h-4 text-[color:var(--ui-text-amber-400)]" />
                <span>Film Recipes</span>
              </button>

              {/* Mobile/Tablet History controls */}
              <div className="md:hidden">
                <div className="border-t border-[color:var(--ui-border-202735)] my-1" />
                <div className="flex items-center justify-around py-1">
                  <button
                    onClick={undo}
                    disabled={!canUndo}
                    className="p-2 rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] disabled:opacity-30 cursor-pointer"
                    title="Undo"
                    aria-label="Undo"
                  >
                    <Undo2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={redo}
                    disabled={!canRedo}
                    className="p-2 rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] disabled:opacity-30 cursor-pointer"
                    title="Redo"
                    aria-label="Redo"
                  >
                    <Redo2 className="w-4 h-4" />
                  </button>
                  <button
                    onClick={resetAdjustments}
                    className="p-2 rounded-lg text-[color:var(--ui-text-slate300)] hover:text-[color:var(--ui-text-slate100)] cursor-pointer"
                    title="Reset Adjustments"
                    aria-label="Reset Adjustments"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Sample Images in Menu */}
              <div className="border-t border-[color:var(--ui-border-202735)] my-1" />
              <div className="px-2.5 py-1 text-[10px] font-mono text-[color:var(--ui-text-slate400)] uppercase tracking-wider">
                Sample Images
              </div>
              <button
                onClick={() => loadSample('samples/film_test_portrait.jpg', 'HD2Lab_Film_Portrait.jpg')}
                className="w-full text-left px-3 py-1.5 rounded-md text-xs text-[color:var(--ui-text-slate300)] hover:bg-[var(--ui-bg-1e2533)] hover:text-[color:var(--ui-text-slate100)] flex items-center justify-between transition-colors cursor-pointer"
              >
                <span>Portrait (Film Reference)</span>
                <span className="text-[10px] font-mono text-[color:var(--ui-text-slate500)]">35mm</span>
              </button>
              <button
                onClick={() => loadSample('samples/color_chart.png', 'HD2Lab_Color_Target.png')}
                className="w-full text-left px-3 py-1.5 rounded-md text-xs text-[color:var(--ui-text-slate300)] hover:bg-[var(--ui-bg-1e2533)] hover:text-[color:var(--ui-text-slate100)] flex items-center justify-between transition-colors cursor-pointer"
              >
                <span>Color Target</span>
                <span className="text-[10px] font-mono text-[color:var(--ui-text-slate500)]">24-patch</span>
              </button>
              <button
                onClick={() => loadSample('samples/landscape_test.png', 'HD2Lab_Landscape_Gamut.png')}
                className="w-full text-left px-3 py-1.5 rounded-md text-xs text-[color:var(--ui-text-slate300)] hover:bg-[var(--ui-bg-1e2533)] hover:text-[color:var(--ui-text-slate100)] flex items-center justify-between transition-colors cursor-pointer"
              >
                <span>Landscape Gamut</span>
                <span className="text-[10px] font-mono text-[color:var(--ui-text-slate500)]">Wide</span>
              </button>

              {/* External Navigation Group */}
              <div className="border-t border-[color:var(--ui-border-202735)] my-1.5" />
              <div className="px-2.5 py-1 text-[10px] font-mono uppercase tracking-wider text-[color:var(--ui-text-slate400)]">
                Navigation
              </div>

              {/* HD2Lab Web-HQ Link */}
              <a
                href="https://hyangdan2.github.io/"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setIsMenuOpen(false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-[color:var(--ui-text-slate200)] hover:bg-[var(--ui-bg-1e2533)] hover:text-[color:var(--ui-text-ff824f)] transition-colors group cursor-pointer"
              >
                <div className="flex items-center space-x-2.5">
                  <Globe className="w-4 h-4 text-[color:var(--ui-text-ff824f)]" />
                  <div className="flex flex-col text-left">
                    <span className="font-semibold text-[color:var(--ui-text-slate200)] group-hover:text-[color:var(--ui-text-ff824f)]">HD2Lab Web-HQ</span>
                    <span className="text-[10px] text-[color:var(--ui-text-slate400)] font-mono">Main Portal</span>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-[color:var(--ui-text-slate500)] group-hover:text-[color:var(--ui-text-ff824f)] flex-shrink-0" />
              </a>

              {/* ApplicationHub Link */}
              <a
                href="https://hyangdan2.github.io/ApplicationHub/"
                target="_blank"
                rel="noopener noreferrer"
                role="menuitem"
                onClick={() => setIsMenuOpen(false)}
                className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-xs font-medium text-[color:var(--ui-text-slate200)] hover:bg-[var(--ui-bg-1e2533)] hover:text-[color:var(--ui-text-ff824f)] transition-colors group cursor-pointer"
              >
                <div className="flex items-center space-x-2.5">
                  <AppWindow className="w-4 h-4 text-[color:var(--ui-text-ff824f)]" />
                  <div className="flex flex-col text-left">
                    <span className="font-semibold text-[color:var(--ui-text-slate200)] group-hover:text-[color:var(--ui-text-ff824f)]">ApplicationHub</span>
                    <span className="text-[10px] text-[color:var(--ui-text-slate400)] font-mono">Web App Collection</span>
                  </div>
                </div>
                <ExternalLink className="w-3.5 h-3.5 text-[color:var(--ui-text-slate500)] group-hover:text-[color:var(--ui-text-ff824f)] flex-shrink-0" />
              </a>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};
