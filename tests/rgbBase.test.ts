import {describe,it,expect,beforeEach} from 'vitest';
import {defaultColorMixer,defaultRGBBase,normalizeColorMixer,validateColorMixer} from '../src/types/colorMixer';
import {applyRGBBase,buildRGBBaseMatrix} from '../src/engine/color/rgbBase';
import {useEditorStore as store} from '../src/stores/editorStore';
import {validateRecipeJSON} from '../src/stores/recipeStore';
describe('RGB Base',()=>{
 beforeEach(()=>store.getState().resetColorMixer());
 it('bypasses neutral and disabled values exactly',()=>{
  const b=defaultRGBBase(),rgb:[number,number,number]=[.013,.431,1.4];expect(applyRGBBase(rgb,b)).toEqual(rgb);b.primaries.blue.hue=100;b.enabled=false;expect(applyRGBBase(rgb,b)).toEqual(rgb);
 });
 it('preserves neutral gray for all primary extremes and produces bounded finite nonnegative colors',()=>{
  for(const h of [-100,100])for(const s of [-100,100]){const b=defaultRGBBase();b.primaries={red:{hue:h,saturation:s},green:{hue:-h,saturation:-s},blue:{hue:h,saturation:s}};
   for(const gray of [0,.001,.18,.5,1,2])applyRGBBase([gray,gray,gray],b).forEach(v=>expect(v).toBeCloseTo(gray,6));
   for(const rgb of [[1,0,0],[0,1,0],[0,0,1],[.12,.07,.03]] as [number,number,number][]){const out=applyRGBBase(rgb,b);expect(out.every(v=>Number.isFinite(v)&&v>=0&&v<4)).toBe(true);expect(out[0]*.2126+out[1]*.7152+out[2]*.0722).toBeCloseTo(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722,6);}
  }
 });
 it('changes mixed colors and masks shadows tint away from highlights without lifting black',()=>{
  const b=defaultRGBBase();b.primaries.blue.hue=50;expect(applyRGBBase([.3,.2,.1],b)).not.toEqual([.3,.2,.1]);b.primaries.blue.hue=0;b.shadowsTint=100;
  const dark=applyRGBBase([.04,.04,.04],b);expect(dark[0]).toBeGreaterThan(.04);expect(dark[1]).toBeLessThan(.04);expect(applyRGBBase([.5,.5,.5],b)).toEqual([.5,.5,.5]);expect(applyRGBBase([0,0,0],b)).toEqual([0,0,0]);
 });
 it('migrates v1–5, validates finite ranges and clones nested settings',()=>{
  for(const schemaVersion of [1,2,3,4,5])expect(validateRecipeJSON(JSON.stringify({name:'Old',baseFilmId:'FS-001',schemaVersion})).colorMixer!.rgbBase).toEqual(defaultRGBBase());
  const m=defaultColorMixer();m.rgbBase.primaries.red.hue=22;const copy=normalizeColorMixer(m);copy.rgbBase.primaries.red.hue=50;expect(m.rgbBase.primaries.red.hue).toBe(22);
  for(const rgbBase of [null,{shadowsTint:101},{primaries:{red:{hue:Infinity}}},{primaries:[]},{enabled:'true'}])expect(()=>validateColorMixer({...m,rgbBase})).toThrow();
  expect(Array.from(buildRGBBaseMatrix(defaultRGBBase()))).toEqual([1,0,0,0,1,0,0,0,1]);
 });
 it('roundtrips v6 and groups gestures into one undo with independent reset',async()=>{
  const initial=store.getState().colorMixer,m=normalizeColorMixer(initial);m.bands.orange.hue=15;m.rgbBase.primaries.green.saturation=30;store.getState().setColorMixer(m,false);m.rgbBase.primaries.green.saturation=60;store.getState().setColorMixer(m);
  const saved=await store.getState().saveCurrentAsRecipe('RGB Base');expect(saved.schemaVersion).toBe(6);expect(validateRecipeJSON(JSON.stringify(saved)).colorMixer).toEqual(store.getState().colorMixer);
  store.getState().undo();expect(store.getState().colorMixer).toEqual(initial);store.getState().redo();expect(store.getState().colorMixer.rgbBase.primaries.green.saturation).toBe(60);
  const reset=normalizeColorMixer(store.getState().colorMixer);reset.rgbBase=defaultRGBBase();store.getState().setColorMixer(reset);expect(store.getState().colorMixer.bands.orange.hue).toBe(15);store.getState().applyRecipe(saved);expect(store.getState().colorMixer.rgbBase.primaries.green.saturation).toBe(60);
 });
});
