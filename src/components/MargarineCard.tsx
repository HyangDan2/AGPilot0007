import { useEditorStore } from '../stores/editorStore';
import { getMargarinePreset } from '../presets/margarine';
import { Layers } from 'lucide-react';

export function MargarineCard({ compact = false }: { compact?: boolean }) {
  const { activePresetId, lastPresetId, selectMargarine } = useEditorStore();
  const preset = getMargarinePreset(activePresetId || lastPresetId);
  return <button type="button" onClick={selectMargarine} data-testid="margarine-card"
    aria-pressed={!!activePresetId} aria-label={`MARGARINE${activePresetId ? ', choose a preset' : ''}`}
    className={`${compact ? 'shrink-0 px-3 py-1.5' : 'w-full p-3'} rounded-lg border text-left transition-colors ${activePresetId ? 'bg-amber-600/20 border-amber-500 text-amber-300' : 'bg-[#141822] border-[#222938] text-slate-300 hover:bg-[#181d2a]'}`}>
    <span className="flex items-center gap-2"><Layers className="w-4 h-4 text-amber-400 shrink-0" /><span className="text-xs font-bold">MARGARINE</span></span>
    <span className="block text-[10px] mt-1 text-slate-400">{activePresetId ? preset?.name : 'Original soft tones'}</span>
  </button>;
}
