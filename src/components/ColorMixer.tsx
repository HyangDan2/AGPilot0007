import {useEffect} from 'react';
import {Palette,X,Crosshair,Pipette,Trash2} from 'lucide-react';
import {useEditorStore} from '../stores/editorStore';
import {ColorMixerSettings,HSLShift,MIXER_AXES,MIXER_COLORS,MixerAxis,MixerColor,normalizeColorMixer,zeroShift} from '../types/colorMixer';
import {hslToRgb} from '../engine/color/colorMixer';
import {ResetValueButton} from './ResetValueButton';

export const MIXER_SWATCHES=['#ef4444','#fb923c','#fde047','#4ade80','#22d3ee','#60a5fa','#a78bfa','#f472b6'];
const name=(v:string)=>v[0].toUpperCase()+v.slice(1);
const selectClass='min-w-0 rounded border border-slate-600 bg-[#10141d] p-1.5 text-xs text-slate-200';
function editMixer(edit:(draft:ColorMixerSettings)=>void,commit=true){const state=useEditorStore.getState(),draft=normalizeColorMixer(state.colorMixer);edit(draft);state.setColorMixer(draft,commit);}
function commitMixer(){const s=useEditorStore.getState();s.setColorMixer(s.colorMixer);}

export function ColorMixerButton({onOpen}:{onOpen?:()=>void}){
 const {isColorMixerOpen,toggleColorMixer}=useEditorStore();
 return <button type="button" data-testid="color-mixer-toggle" aria-label="Color Mixer" title="Color Mixer" aria-expanded={isColorMixerOpen} aria-controls="color-mixer-panel" onClick={()=>{toggleColorMixer();onOpen?.();}} className={`shrink-0 rounded-md border p-1.5 ${isColorMixerOpen?'border-amber-500 bg-amber-500/15 text-amber-300':'border-[#303641] text-amber-400 hover:bg-amber-500/10'}`}><Palette aria-hidden="true" className="w-4 h-4"/></button>;
}
export function MixerToolbar(){
 const {isColorMixerOpen,colorMixer,mixerTab,mixerColor,mixerPointId,setMixerUI}=useEditorStore();
 if(!isColorMixerOpen)return null;
 return <div data-testid="mixer-toolbar" role="group" aria-label="Color Mixer swatches" className="flex items-center justify-center gap-1 rounded-xl border border-slate-500/60 bg-[#11151e]/95 p-2 shadow-lg">
 {mixerTab==='mixer'?MIXER_COLORS.map((c,i)=><button type="button" key={c} aria-label={`${name(c)} color`} title={name(c)} aria-pressed={mixerColor===c} onClick={()=>setMixerUI({mixerColor:c})} className={`w-6 h-7 shrink-0 rounded-full border-2 ${mixerColor===c?'border-white':'border-transparent'}`}><span className="mx-auto grid w-5 h-5 place-items-center rounded-full text-[9px] font-bold text-black" style={{background:MIXER_SWATCHES[i]}}>{c[0].toUpperCase()}</span></button>):<>
 {colorMixer.points.map((p,i)=><button type="button" key={p.id} aria-label={`Select ${p.name}`} title={p.name} aria-pressed={p.id===(mixerPointId||colorMixer.points[0]?.id)} onClick={()=>setMixerUI({mixerPointId:p.id})} className={`w-6 h-7 shrink-0 rounded-full border-2 ${p.id===(mixerPointId||colorMixer.points[0]?.id)?'border-white':'border-transparent'}`}><span className="mx-auto grid w-5 h-5 place-items-center rounded-full text-[9px] font-bold text-black" style={{background:`rgb(${hslToRgb(p.color).map(v=>Math.round(v*255)).join(',')})`}}>{i+1}</span></button>)}
 {!colorMixer.points.length&&<span className="text-[10px] text-slate-300">스포이트로 사진의 색을 선택하세요</span>}
 </>}
 </div>;
}
function MixerSlider({label,value,onChange,min=-100,max=100,defaultValue=0,hueColors}:{hueColors?:string[];label:string;value:number;onChange:(v:number,commit:boolean)=>void;min?:number;max?:number;defaultValue?:number}){
 return <div className="space-y-1"><div className="flex items-center justify-between gap-2 text-[11px]"><span>{label}</span><ResetValueButton aria-label={`Reset ${label} to default`} onClick={()=>onChange(defaultValue,true)} className="p-0 font-mono text-amber-400">{Math.round(value*10)/10}</ResetValueButton></div><input type="range" aria-label={label} min={min} max={max} step="1" value={value} onChange={e=>onChange(Number(e.target.value),false)} onPointerUp={commitMixer} onPointerCancel={commitMixer} onKeyUp={commitMixer} onBlur={commitMixer} style={hueColors?{background:`linear-gradient(to right,${hueColors.join(",")})`}:undefined} className="w-full accent-amber-500"/></div>;
}
function ShiftNumbers({prefix,shift,onChange}:{prefix:string;shift:HSLShift;onChange:(a:MixerAxis,v:number)=>void}){
 return <details className="text-[10px] text-slate-300"><summary className="cursor-pointer">정밀 숫자 입력</summary><div className="mt-2 grid grid-cols-3 gap-2">{MIXER_AXES.map(a=><label key={a} className="min-w-0 space-y-1"><span>{name(a)}</span><input type="number" aria-label={`${prefix} ${name(a)} value`} min="-100" max="100" step="1" value={shift[a]} onChange={e=>{if(e.target.value!=='')onChange(a,Number(e.target.value));}} className="w-full rounded border border-slate-600 bg-[#10141d] p-1"/></label>)}</div></details>;
}
export function ColorMixerPanel(){
 const s=useEditorStore(),{isColorMixerOpen,colorMixer,mixerTab,mixerView,mixerAxis,mixerColor,mixerTool,mixerVisualize,mixerPointId,mixerMessage,setMixerUI}=s;
 useEffect(()=>{if(!isColorMixerOpen)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){const state=useEditorStore.getState();if(state.mixerTool!=='none')state.setMixerUI({mixerTool:'none',mixerMessage:''});else state.toggleColorMixer();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[isColorMixerOpen]);
 if(!isColorMixerOpen)return null;
 const point=colorMixer.points.find(p=>p.id===mixerPointId)||colorMixer.points[0];
 const bandChange=(c:MixerColor,a:MixerAxis,v:number,commit=true)=>editMixer(d=>{d.bands[c][a]=v;},commit);
 const pointChange=(edit:(p:NonNullable<typeof point>)=>void,commit=true)=>{if(!point)return;editMixer(d=>{const p=d.points.find(p=>p.id===point.id);if(p)edit(p);},commit);};
 const slider=(c:MixerColor,a:MixerAxis)=><MixerSlider key={`${c}-${a}`} label={`${name(c)} ${name(a)}`} value={colorMixer.bands[c][a]} hueColors={a==='hue'?[MIXER_SWATCHES[(MIXER_COLORS.indexOf(c)+7)%8],MIXER_SWATCHES[MIXER_COLORS.indexOf(c)],MIXER_SWATCHES[(MIXER_COLORS.indexOf(c)+1)%8]]:undefined} onChange={(v,commit)=>bandChange(c,a,v,commit)}/>;
 return <section id="color-mixer-panel" data-testid="color-mixer-panel" data-photo-overlay aria-label="Color Mixer settings" className={`absolute right-3 z-20 w-[min(300px,calc(100%-24px))] max-h-[calc(100%-24px)] overflow-y-auto overscroll-contain rounded-xl border border-slate-500/70 bg-[#121722]/95 text-xs text-slate-200 shadow-2xl ${mixerTool==='none'?'bottom-3':'top-3'}`} onPointerDown={e=>e.stopPropagation()} onPointerMove={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
 <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-slate-700 bg-[#121722] p-3"><h3 className="font-semibold text-amber-400">Color Mixer</h3><button type="button" aria-label="Close color mixer" onClick={s.toggleColorMixer} className="p-1"><X className="w-4 h-4"/></button></div>
 {mixerTool!=='none'?<div className="space-y-2 p-3"><p>{mixerTool==='eyedropper'?'사진의 색을 탭하세요':`사진을 누르고 위아래로 드래그 · ${name(mixerAxis)}`}</p>{mixerMessage&&<p role="status" className="text-amber-300">{mixerMessage}</p>}<button type="button" onClick={()=>setMixerUI({mixerTool:'none',mixerMessage:''})} className="rounded border border-slate-600 px-2 py-1">Done sampling</button></div>:<div className="space-y-3 p-3">
 <label className="flex items-center justify-between"><span>Enable Color Mixer</span><input type="checkbox" aria-label="Enable Color Mixer" checked={colorMixer.enabled} onChange={e=>editMixer(d=>{d.enabled=e.target.checked;})} className="accent-amber-500"/></label>
 <div className="grid grid-cols-2 gap-1 rounded bg-[#0b0e14] p-1">{(['mixer','point'] as const).map(t=><button type="button" key={t} aria-pressed={mixerTab===t} onClick={()=>setMixerUI({mixerTab:t,mixerVisualize:false,mixerTool:'none',mixerMessage:''})} className={`rounded p-1.5 ${mixerTab===t?'bg-amber-600 text-white':'text-slate-300'}`}>{t==='mixer'?'Mixer':'Point Color'}</button>)}</div>
 {mixerTab==='mixer'?<>
 <label className="flex items-center justify-between gap-2"><span>View</span><select aria-label="Mixer view" value={mixerView} onChange={e=>setMixerUI({mixerView:e.target.value as typeof mixerView})} className={selectClass}><option value="color">Color · 색상별</option><option value="component">HSL · 항목별</option><option value="all">All · 전체</option></select></label>
 <div className="flex items-center justify-between gap-2"><select aria-label="Target adjustment component" value={mixerAxis} onChange={e=>setMixerUI({mixerAxis:e.target.value as MixerAxis})} className={selectClass}>{MIXER_AXES.map(a=><option key={a} value={a}>{name(a)}</option>)}</select><button type="button" aria-label="Targeted Adjustment" onClick={()=>setMixerUI({mixerTool:'target',mixerMessage:'',mixerVisualize:false})} className="flex items-center gap-1 rounded border border-slate-600 p-1.5"><Crosshair className="w-3.5 h-3.5"/>사진 직접 조정</button></div>
 {mixerView==='color'?<><p className="font-semibold" style={{color:MIXER_SWATCHES[MIXER_COLORS.indexOf(mixerColor)]}}>{name(mixerColor)}</p><p className="text-[10px] text-slate-400">Hue − {name(MIXER_COLORS[(MIXER_COLORS.indexOf(mixerColor)+7)%8])} / + {name(MIXER_COLORS[(MIXER_COLORS.indexOf(mixerColor)+1)%8])} 방향</p>{MIXER_AXES.map(a=>slider(mixerColor,a))}<ShiftNumbers prefix={name(mixerColor)} shift={colorMixer.bands[mixerColor]} onChange={(a,v)=>bandChange(mixerColor,a,v)}/></>:mixerView==='component'?MIXER_COLORS.map(c=>slider(c,mixerAxis)):MIXER_COLORS.map(c=><div key={c} className="space-y-2 border-t border-slate-700 pt-2"><p className="font-semibold">{name(c)}</p>{MIXER_AXES.map(a=>slider(c,a))}</div>)}
 <button type="button" onClick={()=>editMixer(d=>{d.bands[mixerColor]=zeroShift();})} className="text-amber-400">Reset selected color</button>
 </>:<>
 <button type="button" aria-label="Pick point color" disabled={colorMixer.points.length>=8} onClick={()=>setMixerUI({mixerTool:'eyedropper',mixerVisualize:false,mixerMessage:''})} className="flex w-full items-center justify-center gap-2 rounded border border-slate-600 p-2 disabled:opacity-40"><Pipette className="w-4 h-4"/>사진에서 색 선택 ({colorMixer.points.length}/8)</button>
 {mixerMessage&&<p role="status" className="text-amber-300">{mixerMessage}</p>}
 {point?<>
 <label className="block space-y-1"><span>Selected color</span><input aria-label="Point color name" value={point.name} maxLength={40} onChange={e=>pointChange(p=>{p.name=e.target.value;})} className={`w-full ${selectClass}`}/></label>
 <label className="flex items-center justify-between"><span>Enable selected point color</span><input type="checkbox" aria-label="Enable selected point color" checked={point.enabled} onChange={e=>pointChange(p=>{p.enabled=e.target.checked;})} className="accent-amber-500"/></label>
 {MIXER_AXES.map(a=><MixerSlider key={a} label={`Point ${name(a)}`} value={point.shift[a]} onChange={(v,commit)=>pointChange(p=>{p.shift[a]=v;},commit)}/>)}
 <ShiftNumbers prefix="Point" shift={point.shift} onChange={(a,v)=>pointChange(p=>{p.shift[a]=v;})}/>
 <details className="space-y-2 border-t border-slate-700 pt-2" open><summary className="cursor-pointer text-slate-300">Range & Feather</summary>{MIXER_AXES.map(a=><MixerSlider key={a} label={`${name(a)} Range`} value={point.range[a]} min={1} max={a==='hue'?180:100} defaultValue={a==='hue'?25:35} onChange={(v,commit)=>pointChange(p=>{p.range[a]=v;},commit)}/>)}<MixerSlider label="Range Feather" value={point.feather} min={1} max={100} defaultValue={50} onChange={(v,commit)=>pointChange(p=>{p.feather=v;},commit)}/></details>
 <label className="flex items-center justify-between"><span>Visualize Range</span><input type="checkbox" aria-label="Visualize Range" checked={mixerVisualize} onChange={e=>setMixerUI({mixerVisualize:e.target.checked,mixerPointId:point.id})} className="accent-amber-500"/></label>
 <div className="flex items-center justify-between"><button type="button" onClick={()=>pointChange(p=>{p.shift=zeroShift();})} className="text-amber-400">Reset selected point</button><button type="button" aria-label="Delete selected point color" onClick={()=>{editMixer(d=>{d.points=d.points.filter(p=>p.id!==point.id);});setMixerUI({mixerPointId:null,mixerVisualize:false});}} className="p-1"><Trash2 className="w-4 h-4"/></button></div>
 </>:<p className="text-slate-400">스포이트로 고른 색의 Hue·Saturation·Luminance와 적용 범위를 조절합니다.</p>}
 </>}
 <div className="space-y-2 border-t border-slate-700 pt-2"><p className="text-[10px] text-slate-400">숫자를 누르면 해당 값만 초기화 · 같은 색은 사진 전체에서 함께 바뀝니다.</p><button type="button" onClick={s.resetColorMixer} className="text-amber-400">Reset entire Color Mixer</button></div>
 </div>}
 </section>;
}
