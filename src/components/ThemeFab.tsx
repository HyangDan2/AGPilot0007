import {useEffect} from 'react';
import {useUIStore} from '../stores/uiStore';

/**
 * Floating Light/Dark toggle pinned to the bottom-right corner.
 * Mirrors the shared `hd2-theme` choice used by every HD2Lab surface.
 */
export function ThemeFab() {
  const theme=useUIStore(s=>s.theme);
  const setTheme=useUIStore(s=>s.setTheme);
  const rightCollapsed=useUIStore(s=>s.rightCollapsed);
  // The button sits left of the adjustment panel so it never covers a slider.
  useEffect(()=>{document.documentElement.dataset.rightPanel=rightCollapsed?'collapsed':'open';},[rightCollapsed]);
  const next=theme==='dark'?'light':'dark';
  const label=next==='dark'?'Dark':'Light';
  return (
    <button
      type="button"
      data-testid="theme-fab"
      className="theme-fab"
      onClick={()=>setTheme(next)}
      aria-label={`Switch to ${label.toLowerCase()} theme`}
      aria-pressed={theme==='dark'}
      title={`Switch to ${label.toLowerCase()} theme`}
    >
      <span className="theme-fab-icon" aria-hidden="true">{theme==='dark'?'☀️':'🌙'}</span>
      <span className="theme-fab-label">{label}</span>
    </button>
  );
}
