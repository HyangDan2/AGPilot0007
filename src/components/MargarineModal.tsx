import { useEffect, useRef, useState } from 'react';
import { X, Check } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { MARGARINE_PRESETS } from '../presets/margarine';

export function MargarineModal() {
  const { isMargarineOpen, closeMargarine, activePresetId, applyMargarine } = useEditorStore();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('All');
  const matches = (p: typeof MARGARINE_PRESETS[number]) => (category === 'All' || p.category === category) && p.name.toLowerCase().includes(query.trim().toLowerCase());
  useEffect(() => {
    const dialog = dialogRef.current;
    if (isMargarineOpen) { setQuery(''); setCategory('All'); dialog?.showModal(); }
    else dialog?.close();
  }, [isMargarineOpen]);
  return <dialog ref={dialogRef} aria-labelledby="margarine-title" onCancel={closeMargarine}
    onClick={event => {
      if (event.target !== event.currentTarget) return;
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) closeMargarine();
    }}
    className="margarine-dialog m-auto p-0 w-[calc(100%-2rem)] max-w-xl max-h-[85dvh] rounded-2xl border border-[color:var(--ui-border-303641)] bg-[var(--ui-bg-11141b)] text-[color:var(--ui-text-slate200)] shadow-2xl">
    <div className="flex flex-col max-h-[85dvh]">
      <header className="flex items-center justify-between px-5 py-4 border-b border-[color:var(--ui-border-262c36)] shrink-0">
        <div><h2 id="margarine-title" className="font-bold">MARGARINE</h2><p className="text-xs text-[color:var(--ui-text-slate400)] mt-1">Choose your soft tone</p></div>
        <button onClick={closeMargarine} aria-label="Close Margarine presets" className="p-2 rounded hover:bg-white/10"><X className="w-5 h-5" /></button>
      </header>
      <div className="px-5 pt-4 shrink-0"><input autoFocus aria-label="Search Margarine presets" placeholder="Search looks…" value={query} onChange={e => setQuery(e.target.value)} className="w-full rounded-lg border border-[color:var(--ui-border-303641)] bg-[var(--ui-bg-0b0e14)] px-3 py-2 text-sm" /></div>
      <div className="px-5 pt-3 shrink-0 flex items-center justify-between gap-2 text-xs text-[color:var(--ui-text-slate400)]">
        <span>{MARGARINE_PRESETS.filter(matches).length} looks</span>
        <select aria-label="Filter Margarine category" value={category} onChange={e => setCategory(e.target.value)} className="bg-[var(--ui-bg-181c24)] border border-[color:var(--ui-border-303641)] rounded px-2 py-1">
          {['All', ...new Set(MARGARINE_PRESETS.map(p => p.category))].map(c => <option key={c}>{c}</option>)}
        </select>
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain p-5 space-y-3">
        {MARGARINE_PRESETS.filter(matches).map(preset => {
          const index = MARGARINE_PRESETS.indexOf(preset) + 1;
          return <button key={preset.id} type="button" aria-pressed={activePresetId === preset.id}
            onClick={() => { applyMargarine(preset.id); closeMargarine(); }}
            className={`w-full flex gap-3 items-center p-3 rounded-xl border text-left hover:border-amber-400 ${activePresetId === preset.id ? 'border-amber-500 bg-amber-600/10' : 'border-[color:var(--ui-border-303641)] bg-[var(--ui-bg-181c24)]'}`}>
            <span className="text-lg font-mono text-[color:var(--ui-text-amber-400)] w-6">{index}</span>
            <div className="min-w-0 flex-1"><span className="font-semibold text-sm">{preset.name}</span><span className="block text-xs text-[color:var(--ui-text-slate400)] mt-1">{`${preset.category} · ${preset.adjustments.temperature > 5 ? 'warm' : preset.adjustments.temperature < -5 ? 'cool' : 'balanced'} tone`}</span></div>
            {activePresetId === preset.id && <Check className="w-4 h-4 text-[color:var(--ui-text-amber-400)] shrink-0" />}
          </button>;
        })}
        {!MARGARINE_PRESETS.some(matches) && <p className="text-sm text-[color:var(--ui-text-slate400)]">No matching looks.</p>}
      </div>
    </div>
  </dialog>;
}
