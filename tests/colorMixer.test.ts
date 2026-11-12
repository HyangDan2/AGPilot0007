import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('idb-keyval',()=>({get:vi.fn(async()=>[]),set:vi.fn(async()=>undefined)}));
import {defaultColorMixer,normalizeColorMixer,validateColorMixer,MIXER_COLORS} from '../src/types/colorMixer';
import {rgbToHsl,hslToRgb,mixerBandWeights,pointColorWeight,pointFromColor,applyColorMixer} from '../src/engine/color/colorMixer';
import {useEditorStore as store} from '../src/stores/editorStore';
import {validateRecipeJSON} from '../src/stores/recipeStore';
beforeEach(()=>store.setState(store.getInitialState(),true));
describe('Color Mixer math and persistence',()=>{
 it('round-trips primary, skin, gray and boundary colors',()=>{
  for(const rgb of [[1,0,0],[0,1,0],[0,0,1],[.7,.4,.2],[.5,.5,.5],[0,0,0],[1,1,1]] as [number,number,number][]){const out=hslToRgb(rgbToHsl(rgb));out.forEach((v,i)=>expect(v).toBeCloseTo(rgb[i],6));}
 });
 it('smoothly partitions all hues including the red wrap boundary',()=>{
  for(let i=0;i<=360;i++){const w=mixerBandWeights(i/360);expect(w.reduce((a,b)=>a+b,0)).toBeCloseTo(1);expect(w.every(v=>v>=0&&v<=1)).toBe(true);}
  const left=mixerBandWeights(.999999),right=mixerBandWeights(.000001);expect(left[0]).toBeCloseTo(right[0],5);
 });
 it('adjusts selected H/S/L without tinting neutral or unrelated color ranges',()=>{
  const mixer=defaultColorMixer();mixer.bands.red={hue:100,saturation:-50,luminance:50};
  const red=applyColorMixer([.8,.1,.1],mixer),green=applyColorMixer([.1,.8,.1],mixer);
  expect(rgbToHsl(red)[0]).toBeGreaterThan(.05);expect(rgbToHsl(red)[1]).toBeLessThan(rgbToHsl([.8,.1,.1])[1]);expect(rgbToHsl(red)[2]).toBeGreaterThan(.45);
  green.forEach((v,i)=>expect(v).toBeCloseTo([.1,.8,.1][i],6));expect(applyColorMixer([.4,.4,.4],mixer)).toEqual([.4,.4,.4]);
  mixer.enabled=false;expect(applyColorMixer([.8,.1,.1],mixer)).toEqual([.8,.1,.1]);
 });
 it('selects point-color ranges with circular hue and soft feathering',()=>{
  const point=pointFromColor([1,0,0],0);expect(pointColorWeight([.99,1,.5],point)).toBeGreaterThan(.9);expect(pointColorWeight([.5,1,.5],point)).toBe(0);
  point.range.hue=60;point.feather=100;const a=pointColorWeight([.05,1,.5],point),b=pointColorWeight([.1,1,.5],point);expect(a).toBeGreaterThan(b);expect(b).toBeGreaterThan(0);
 });
 it('bounds overlapping shifts and keeps all sampled outputs finite and in gamut',()=>{
  const mixer=defaultColorMixer();for(const c of MIXER_COLORS)mixer.bands[c]={hue:100,saturation:100,luminance:-100};mixer.points=Array.from({length:8},(_,i)=>({...pointFromColor([1,0,0],i),shift:{hue:-100,saturation:-100,luminance:100}}));
  for(let i=0;i<100;i++){const rgb=hslToRgb([i/100,.8,.4]);expect(applyColorMixer(rgb,mixer).every(v=>Number.isFinite(v)&&v>=0&&v<=1)).toBe(true);}
 });
 it('records a drag as one step, preserves it across edits/films, and resets independently',()=>{
  const next=defaultColorMixer();next.bands.blue.luminance=-30;store.getState().setColorMixer(next,false);next.bands.blue.luminance=-40;store.getState().setColorMixer(next,false);expect(store.getState().history).toHaveLength(1);store.getState().setColorMixer(next);expect(store.getState().history).toHaveLength(2);
  store.getState().undo();expect(store.getState().colorMixer).toEqual(defaultColorMixer());store.getState().redo();expect(store.getState().colorMixer.bands.blue.luminance).toBe(-40);
  store.getState().setAdjustment('saturation',22);store.getState().setFilm('FS-009');store.getState().resetColorMixer();expect(store.getState().adjustments.saturation).toBe(22);store.getState().undo();expect(store.getState().colorMixer.bands.blue.luminance).toBe(-40);store.getState().resetAdjustments();expect(store.getState().colorMixer).toEqual(defaultColorMixer());
 });
 it('migrates recipes1–4 and round-trips bands/point colors in version5',async()=>{
  for(const schemaVersion of [1,2,3,4])expect(validateRecipeJSON(JSON.stringify({name:'Old',baseFilmId:'FS-001',schemaVersion})).colorMixer).toEqual(defaultColorMixer());
  const mixer=defaultColorMixer();mixer.bands.green.hue=25;mixer.points=[pointFromColor([.2,.4,.8],0)];mixer.points[0].shift.luminance=40;store.getState().setColorMixer(mixer);const recipe=await store.getState().saveCurrentAsRecipe('Mixer');expect(recipe.schemaVersion).toBe(6);const parsed=validateRecipeJSON(JSON.stringify(recipe));expect(parsed.colorMixer).toEqual(mixer);store.getState().resetColorMixer();store.getState().applyRecipe(parsed);expect(store.getState().colorMixer).toEqual(mixer);
 });
 it('validates reordered objects and rejects corrupt or excessive samples',()=>{
  const mixer=defaultColorMixer();const p=pointFromColor([1,0,0],0);mixer.points=[{...p,shift:{luminance:0,saturation:0,hue:0}}];expect(()=>validateColorMixer(mixer)).not.toThrow();
  expect(()=>validateColorMixer({...mixer,points:Array(9).fill(p)})).toThrow();expect(()=>validateColorMixer({...mixer,points:[p,p]})).toThrow();expect(()=>validateColorMixer({...mixer,points:[{...p,color:[NaN,0,0]}]})).toThrow();expect(normalizeColorMixer({bands:{red:{hue:999,saturation:NaN,luminance:0}} as any}).bands.red.hue).toBe(100);
 });
 it('closes competing tools and clears transient sampling/range state',()=>{
  store.getState().toggleToneCurve();store.getState().toggleColorMixer();expect(store.getState().isToneCurveOpen).toBe(false);store.getState().setMixerUI({mixerTool:'eyedropper',mixerVisualize:true});store.getState().toggleCameraEffects();expect(store.getState().isColorMixerOpen).toBe(false);expect(store.getState().mixerTool).toBe('none');expect(store.getState().mixerVisualize).toBe(false);
 });
});
