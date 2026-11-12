import { useEffect, useRef } from 'react';
import { Camera, ChevronRight, Check, X } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';

export function FilterSetCard({ compact=false }: {compact?:boolean}) {
  const { activeFilmId, openFilterSet }=useEditorStore();
  const selected=activeFilmId==='FS-010';
  return <button type="button" data-testid="filter-set-card" aria-label="Filter Set" aria-pressed={selected} onClick={openFilterSet}
    className={`${compact?'shrink-0 px-3 py-1.5':'w-full p-3'} rounded-lg border text-left transition-colors ${selected?'bg-amber-600/20 border-amber-500 text-amber-300':'bg-[#141822] border-[#222938] text-slate-300 hover:bg-[#181d2a]'}`}>
    <span className="flex items-center gap-2"><Camera className="w-4 h-4 text-amber-400 shrink-0"/><span className="text-xs font-bold">FILTER SET</span><ChevronRight className="w-3 h-3"/></span>
    <span className="block text-[10px] mt-1 text-slate-400">{selected?'Old School Film':'Explore camera looks'}</span>
  </button>;
}
export function FilterSetModal() {
  const {isFilterSetOpen,closeFilterSet,activeFilmId,applyOldSchool}=useEditorStore();
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{if(isFilterSetOpen)ref.current?.showModal();else ref.current?.close();},[isFilterSetOpen]);
  return <dialog ref={ref} aria-labelledby="filter-set-title" onCancel={closeFilterSet}
    onClick={e=>{if(e.target!==e.currentTarget)return;const b=e.currentTarget.getBoundingClientRect();if(e.clientX<b.left||e.clientX>b.right||e.clientY<b.top||e.clientY>b.bottom)closeFilterSet();}}
    className="margarine-dialog m-auto p-0 w-[calc(100%-2rem)] max-w-xl max-h-[85dvh] overflow-y-auto rounded-2xl border border-[#303641] bg-[#11141b] text-slate-200 shadow-2xl">
    <header className="flex justify-between items-center px-5 py-4 border-b border-[#262c36]"><div><h2 id="filter-set-title" className="font-bold">Filter Set</h2><p className="text-xs text-slate-400 mt-1">Camera-inspired collections</p></div><button type="button" onClick={closeFilterSet} aria-label="Close Filter Set" className="p-2 rounded hover:bg-white/10"><X className="w-5 h-5"/></button></header>
    <div className="p-5"><button type="button" aria-pressed={activeFilmId==='FS-010'} onClick={applyOldSchool} className={`w-full flex gap-4 items-center p-4 rounded-xl border text-left hover:border-amber-400 ${activeFilmId==='FS-010'?'border-amber-500 bg-amber-600/10':'border-[#303641] bg-[#181c24]'}`}>
      <span className="text-xl font-mono text-amber-400">01</span><span className="flex-1"><span className="block text-sm font-semibold">Old School Film</span><span className="block text-xs text-amber-300 mt-1">RETRO 90 · Night Amber</span><span className="block text-xs text-slate-400 mt-2">Deep shadows, warm lamps and soft film grain.</span></span>{activeFilmId==='FS-010'&&<Check className="w-4 h-4 text-amber-400 shrink-0"/>}
    </button><p className="text-xs text-slate-400 mt-4">Add an optional date imprint in Camera Effects.</p></div>
  </dialog>;
}
