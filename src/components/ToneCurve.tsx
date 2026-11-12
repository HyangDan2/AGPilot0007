import { useEffect, useRef, useState } from 'react';
import { Spline, RotateCcw, X, Trash2 } from 'lucide-react';
import { useEditorStore } from '../stores/editorStore';
import { CURVE_CHANNELS, CurvePoint, moveCurvePoint } from '../types/curves';
import { createMonotoneSpline } from '../engine/color/toneCurve';

const colors = ['#f1f5f9','#f87171','#4ade80','#60a5fa'];
export function ToneCurveButton({onOpen}: {onOpen?:()=>void}) {
  const {isToneCurveOpen,toggleToneCurve}=useEditorStore();
  return <button type="button" data-testid="tone-curve-toggle" aria-label="Tone Curve" title="Tone Curve" aria-expanded={isToneCurveOpen} aria-controls="tone-curve-overlay" onClick={()=>{toggleToneCurve();onOpen?.();}}
    className={`shrink-0 p-1.5 rounded-md border ${isToneCurveOpen?'border-amber-500 bg-amber-500/15 text-amber-300':'border-[#303641] text-amber-400 hover:bg-amber-500/10'}`}><Spline aria-hidden="true" className="w-4 h-4"/></button>;
}
export function CurveToolbar() {
  const {isToneCurveOpen,curveChannel,setCurveChannel,resetCurves}=useEditorStore();
  if(!isToneCurveOpen)return null;
  return <div data-testid="curve-toolbar" className="flex shrink-0 items-center justify-center gap-2 px-3 py-2 rounded-xl border border-slate-500/60 bg-[#11151e]/95 shadow-lg" role="group" aria-label="Tone curve channels">
    {CURVE_CHANNELS.map((c,i)=><button type="button" key={c} title={c==='white'?'White · RGB 전체':c} aria-label={`${c} curve`} aria-pressed={curveChannel===c} onClick={()=>setCurveChannel(c)} className={`w-8 h-8 rounded-full grid place-items-center border-2 ${curveChannel===c?'border-amber-400 bg-slate-700':'border-transparent hover:border-slate-500'}`}><span style={{backgroundColor:colors[i],color:'#10121a'}} className="w-5 h-5 rounded-full text-[10px] font-bold grid place-items-center">{c[0].toUpperCase()}</span></button>)}
    <button type="button" title={`${curveChannel} 커브 초기화`} aria-label="Reset selected curve" onClick={()=>resetCurves()} className="p-2 text-amber-400 rounded hover:bg-slate-800"><RotateCcw aria-hidden="true" className="w-4 h-4"/></button>
  </div>;
}
export function ToneCurveOverlay({size=280,controlWidth=280}: {size?:number;controlWidth?:number}) {
  const {isToneCurveOpen,curveChannel,curves,setCurve,resetCurves,toggleToneCurve}=useEditorStore();
  const [selected,setSelected]=useState(0);
  const drag=useRef<number|null>(null);
  const points=curves[curveChannel];
  const index=Math.min(selected,points.length-1), point=points[index];
  useEffect(()=>{setSelected(0);},[curveChannel]);
  useEffect(()=>{if(!isToneCurveOpen)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){useEditorStore.getState().toggleToneCurve();}};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[isToneCurveOpen]);
  if(!isToneCurveOpen)return null;
  const color=colors[CURVE_CHANNELS.indexOf(curveChannel)];
  const spline=createMonotoneSpline(points);
  const path=Array.from({length:257},(_,i)=>`${i?'L':'M'}${i},${256-spline(i/256)*256}`).join(' ');
  const change=(i:number,x:number,y:number,commit:boolean)=>{
    const state=useEditorStore.getState();
    state.setCurve(state.curveChannel,moveCurvePoint(state.curves[state.curveChannel],i,x,y),commit);
  };
  const finish=()=>{if(drag.current===null)return;drag.current=null;const state=useEditorStore.getState();state.setCurve(state.curveChannel,state.curves[state.curveChannel]);};
  const remove=()=>{if(index===0||index===points.length-1)return;setCurve(curveChannel,points.filter((_,i)=>i!==index));setSelected(Math.max(0,index-1));};
  return <section id="tone-curve-overlay" data-testid="tone-curve-overlay" data-photo-overlay aria-label="Tone Curve editor" style={{width:controlWidth,height:size}} className="absolute z-20 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-slate-100 bg-transparent [text-shadow:0_1px_3px_#000]"
    onPointerDown={e=>e.stopPropagation()} onPointerMove={e=>e.stopPropagation()} onPointerUp={e=>e.stopPropagation()} onWheel={e=>e.stopPropagation()}>
    <div className="absolute bottom-full inset-x-0 flex items-center justify-between py-1 text-xs"><span>Tone Curve · {curveChannel==='white'?'RGB':curveChannel.toUpperCase()}</span><button type="button" aria-label="Close tone curve" title="Close tone curve" onClick={toggleToneCurve} className="p-1"><X className="w-4 h-4"/></button></div>
    <svg data-testid="curve-graph" role="group" aria-label="Tone curve graph" viewBox="-8 -8 272 272" style={{width:size,height:size}} className="block mx-auto touch-none select-none drop-shadow-[0_1px_1px_#000]" onPointerDown={e=>{
      e.preventDefault();const rect=e.currentTarget.getBoundingClientRect();const x=Math.max(0,Math.min(1,((e.clientX-rect.left)/rect.width*272-8)/256)),y=Math.max(0,Math.min(1,1-((e.clientY-rect.top)/rect.height*272-8)/256));
      let i=-1, distance=Math.max(.065,12*272/(rect.width*256));
      points.forEach((p,j)=>{const d=Math.hypot(p[0]-x,p[1]-y);if(d<distance){distance=d;i=j;}});
      if(i<0){if(points.length>=16)return;const ps=[...points,[x,y] as CurvePoint].sort((a,b)=>a[0]-b[0]);i=ps.findIndex(p=>p[0]===x);if(i===0||i===ps.length-1||ps.some((p,j)=>j>0&&p[0]-ps[j-1][0]<1/255))return;setCurve(curveChannel,ps,false);}
      drag.current=i;setSelected(i);e.currentTarget.setPointerCapture(e.pointerId);
    }} onPointerMove={e=>{if(drag.current===null)return;const rect=e.currentTarget.getBoundingClientRect();change(drag.current,((e.clientX-rect.left)/rect.width*272-8)/256,1-((e.clientY-rect.top)/rect.height*272-8)/256,false);}} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
      <rect width="256" height="256" fill="none"/>
      {[0,64,128,192,256].map(v=><g key={v} stroke="#e2e8f0" strokeOpacity=".55" strokeWidth="1"><path d={`M ${v} 0 V 256 M 0 ${v} H 256`}/></g>)}
      <path d="M0 256 L256 0" stroke="#94a3b8" strokeDasharray="4 5" opacity=".4"/>
      <path data-testid="curve-line" d={path} fill="none" stroke={color} strokeWidth="2"/>
      {points.map(([x,y],i)=><circle key={i} role="button" tabIndex={0} aria-label={`Curve point ${i+1}`} cx={x*256} cy={256-y*256} r={i===index?6:4.5} fill={i===index?color:'#10141d'} stroke={color} strokeWidth="2" onFocus={()=>setSelected(i)} onKeyDown={e=>{if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();remove();}else if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();const step=(e.shiftKey?10:1)/255;change(i,x+(e.key==='ArrowRight'?step:e.key==='ArrowLeft'?-step:0),y+(e.key==='ArrowUp'?step:e.key==='ArrowDown'?-step:0),true);}}}/>)}
    </svg>
    <div className="absolute top-full inset-x-0 pt-1 space-y-1"><div className="flex items-center justify-between gap-2 text-[11px]">
      {(['Input','Output'] as const).map((label,c)=><label key={label} className="flex items-center gap-1">{label}<input aria-label={`Curve ${label}`} type="number" min="0" max="255" step="1" value={Math.round(point[c]*255)} onChange={e=>{if(e.target.value==='')return;change(index,c===0?Number(e.target.value)/255:point[0],c===1?Number(e.target.value)/255:point[1],true);}} className="w-12 p-1 rounded bg-[#10141d] border border-slate-600 disabled:opacity-50"/></label>)}
      <button type="button" aria-label="Delete curve point" title="점 삭제" disabled={index===0||index===points.length-1} onClick={remove} className="p-1 disabled:opacity-30"><Trash2 className="w-4 h-4"/></button>
    </div><div className="flex justify-between items-center text-[10px]"><span className="text-slate-200">탭으로 점 추가 · 드래그로 조정</span><button type="button" onClick={()=>resetCurves(true)} className="text-amber-400">전체 커브 초기화</button></div></div>
  </section>;
}
export function Histogram({bins}:{bins:number[][]|null}) {
  return <div data-testid="histogram" data-photo-overlay aria-label="Preview histogram: luminance, red, green, blue" className="pointer-events-none absolute top-3 left-3 z-10 w-32 sm:w-44 rounded-lg border border-slate-600/60 bg-[#10141d]/75 px-2 py-1.5 backdrop-blur-sm">
    <div className="flex justify-between text-[9px] mb-1 text-slate-300"><span>Preview</span><span>{['W','R','G','B'].map((v,i)=><span key={v} style={{color:colors[i]}} className="ml-1">{v}</span>)}</span></div>
    <svg viewBox="0 0 128 48" className="w-full" role="img" aria-label="RGB tonal distribution">{bins?.map((values,c)=>{const max=Math.max(1,...(bins||[]).flat());return <path key={c} d={`M0 48 ${values.map((v,i)=>`L${i*128/63} ${48-44*Math.sqrt(v/max)}`).join(' ')} L128 48 Z`} fill={colors[c]} fillOpacity={c===0?.12:.15} stroke={colors[c]} strokeWidth=".7"/>;})}</svg>
  </div>;
}
