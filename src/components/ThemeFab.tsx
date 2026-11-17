import {useEffect} from 'react';
import {useUIStore} from '../stores/uiStore';

/**
 * Floating Light/Dark toggle pinned to the bottom-right corner.
 * One monochrome sun/moon SVG — the same mark Web-HQ draws — with no text label.
 * Mirrors the shared `hd2-theme` choice used by every HD2Lab surface.
 */
export function ThemeFab() {
  const theme=useUIStore(s=>s.theme);
  const setTheme=useUIStore(s=>s.setTheme);
  const rightCollapsed=useUIStore(s=>s.rightCollapsed);
  // The button sits left of the adjustment panel so it never covers a slider.
  useEffect(()=>{document.documentElement.dataset.rightPanel=rightCollapsed?'collapsed':'open';},[rightCollapsed]);
  const next=theme==='dark'?'light':'dark';
  const label=next==='dark'?'Switch to dark theme':'Switch to light theme';
  return (
    <button
      type="button"
      data-testid="theme-fab"
      className="theme-fab"
      onClick={()=>setTheme(next)}
      aria-label={label}
      aria-pressed={theme==='dark'}
      title={label}
    >
      <svg className="theme-ic" data-icon="sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.1"/>
        <path d="M12 2.7v2.3M12 19v2.3M2.7 12h2.3M19 12h2.3M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6"/>
      </svg>
      <svg className="theme-ic" data-icon="moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20.4 14.4A8.6 8.6 0 0 1 9.6 3.6a8.6 8.6 0 1 0 10.8 10.8z"/>
      </svg>
    </button>
  );
}
