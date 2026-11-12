import { getCameraEffects, supportsCameraEffects } from '../films/cameraEffects';
import { FILM_PROFILES } from '../films/registry';
import { Camera } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { isValidStampDate, localCalendarDate, DateStampSettings } from '../types/camera';
import { ResetValueButton } from './ResetValueButton';

export function CameraEffectsButton({ controls }: { controls: string }) {
  const { activeFilmId, isCameraEffectsOpen, toggleCameraEffects } = useEditorStore();
  if (!supportsCameraEffects(activeFilmId)) return null;
  return <button type="button" data-testid="camera-effects-toggle" aria-label="Camera Effects" title="Camera Effects"
    aria-expanded={isCameraEffectsOpen} aria-controls={controls} onClick={toggleCameraEffects}
    className={`shrink-0 p-1.5 rounded-md border transition-colors ${isCameraEffectsOpen ? 'border-amber-500 bg-amber-500/15 text-amber-300' : 'border-[#303641] text-amber-400 hover:bg-amber-500/10'}`}>
    <Camera className="w-4 h-4" aria-hidden="true" />
  </button>;
}

export function CameraEffects({ id }: { id: string }) {
  const { camera, image, updateDateStamp, updateOptics, resetCamera, activeFilmId, isCameraEffectsOpen }=useEditorStore();
  const effects=getCameraEffects(activeFilmId);
  if (!effects.length || !isCameraEffectsOpen) return null;
  const stamp=camera.dateStamp;
  const inputClass='w-full min-w-0 rounded border border-[#303641] bg-[#0b0e14] px-2 py-1.5 text-xs text-slate-200';
  return <section id={id} aria-label="Camera Effects settings" className="rounded-lg border border-[#293141] bg-[#121722] text-xs" data-testid="camera-effects">
    <h3 className="p-3 text-amber-400 font-semibold">{FILM_PROFILES[activeFilmId].name} · Camera Effects</h3>
    <div className="px-3 pb-3 space-y-3">

      {effects.includes('dateStamp') && <>
      <label className="flex items-center justify-between gap-2"><span>Date Imprint</span><input type="checkbox" aria-label="Date Imprint" checked={stamp.enabled} disabled={!isValidStampDate(stamp.date)} onChange={e=>updateDateStamp({enabled:e.target.checked})} className="accent-amber-500 w-4 h-4"/></label>
      <label className="block space-y-1"><span>Imprint Date</span><input type="date" aria-label="Imprint Date" min="0001-01-01" max="9999-12-31" value={stamp.date} onChange={e=>updateDateStamp({date:e.target.value,source:'manual'})} className={inputClass}/></label>
      <div className="flex gap-2"><button type="button" onClick={()=>updateDateStamp({date:localCalendarDate(),source:'today'})} className="flex-1 rounded border border-[#303641] p-1.5">Today</button><button type="button" disabled={!image?.captureDate} onClick={()=>{if(image?.captureDate)updateDateStamp({date:image.captureDate,source:'exif'});}} className="flex-1 rounded border border-[#303641] p-1.5 disabled:opacity-40">Use EXIF Date</button></div>
      <p className="text-[10px] text-slate-400">{image?.captureDate?`EXIF: ${image.captureDate}`:image?.captureDateStatus==='unreadable'?'EXIF date could not be read. Choose a date.':'No EXIF capture date. Choose a date.'}{!stamp.date?' Select a date to enable imprint.':''}</p>
      <label className="block space-y-1"><span>Date Format</span><select aria-label="Date Format" value={stamp.format} onChange={e=>updateDateStamp({format:e.target.value as DateStampSettings['format']})} className={inputClass}><option value="compact">'16 3 8</option><option value="padded">16 03 08</option><option value="full">2016 03 08</option></select></label>
      <label className="block space-y-1"><span>Date Position</span><select aria-label="Date Position" value={stamp.position} onChange={e=>updateDateStamp({position:e.target.value as DateStampSettings['position']})} className={inputClass}><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option></select></label>
      {([{key:'size',label:'Date Size',min:1,max:6,step:.1,defaultValue:3},{key:'glow',label:'Date Glow',min:0,max:100,step:1,defaultValue:35},{key:'opacity',label:'Date Opacity',min:0,max:100,step:1,defaultValue:85}] as const).map(def=><div key={def.key} className="space-y-1"><div className="flex justify-between"><span>{def.label}</span><ResetValueButton aria-label={`Reset ${def.label} to default`} onClick={()=>updateDateStamp({[def.key]:def.defaultValue})} className="p-0 rounded-sm text-amber-400 font-mono">{stamp[def.key]}%</ResetValueButton></div><input type="range" aria-label={def.label} min={def.min} max={def.max} step={def.step} value={stamp[def.key]} onChange={e=>updateDateStamp({[def.key]:Number(e.target.value)})} className="w-full accent-amber-500"/></div>)}
      <label className="flex justify-between items-center"><span>Date Color</span><input type="color" aria-label="Date Color" value={stamp.color} onChange={e=>updateDateStamp({color:e.target.value})} className="w-9 h-6 bg-transparent"/></label>
      </>}
      {effects.some(effect => effect !== 'dateStamp') && <div className="pt-2 border-t border-[#293141] space-y-3">
        {([{key:'glow',label:'Highlight Glow'},{key:'halation',label:'Halation'},{key:'softness',label:'Softness'}] as const).filter(def=>effects.includes(def.key)).map(def=><div key={def.key} className="space-y-1"><div className="flex justify-between"><span>{def.label}</span><ResetValueButton aria-label={`Reset ${def.label} to default`} onClick={()=>updateOptics({[def.key]:0})} className="p-0 rounded-sm text-amber-400 font-mono">{camera.optics[def.key]}</ResetValueButton></div><input type="range" aria-label={def.label} min="0" max="100" value={camera.optics[def.key]} onChange={e=>updateOptics({[def.key]:Number(e.target.value)})} className="w-full accent-amber-500"/></div>)}
        <label className="block space-y-1"><span>Optical Quality</span><select aria-label="Optical Quality" value={camera.optics.quality} onChange={e=>updateOptics({quality:e.target.value==='high'?'high':'standard'})} className={inputClass}><option value="standard">Standard · lighter rendering</option><option value="high">High · smoother sampling</option></select></label>
      </div>}
      <button type="button" onClick={resetCamera} className="text-amber-400 hover:text-amber-300">Reset Camera Effects</button>
    </div>
  </section>;
}
