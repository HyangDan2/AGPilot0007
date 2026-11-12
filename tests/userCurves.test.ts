import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('idb-keyval',()=>({get:vi.fn(async()=>[]),set:vi.fn(async()=>undefined)}));
import {defaultCurves,normalizeCurves} from '../src/types/curves';
import {buildCurveTexture,histogramFromPixels,CURVE_SAMPLES} from '../src/engine/color/userCurves';
import {useEditorStore as store} from '../src/stores/editorStore';
import {validateRecipeJSON} from '../src/stores/recipeStore';
beforeEach(()=>store.setState(store.getInitialState(),true));
describe('User tone curves',()=>{
 it('bypasses identity and samples independent non-monotonic channels without invalid values',()=>{
  const identity=buildCurveTexture();expect(identity.enabled).toBe(false);
  const curves=defaultCurves();curves.red=[[0,.1],[.3,.8],[.7,.2],[1,.9]];
  const result=buildCurveTexture(curves);expect(result.enabled).toBe(true);expect(result.data).toHaveLength(CURVE_SAMPLES*4);
  expect([...result.data].every(v=>Number.isFinite(v)&&v>=0&&v<=1)).toBe(true);
  expect(result.data[1]).toBeCloseTo(.1);expect(result.data.at(-3)).toBeCloseTo(.9);
  expect(result.data[512*4]).toBeCloseTo(512/1023);
 });
 it('rejects duplicate, missing endpoint, NaN and oversized curve inputs',()=>{
  for(const red of [[[0,0],[0,1],[1,1]],[[.2,0],[1,1]],[[0,NaN],[1,1]],Array.from({length:17},(_,i)=>[i/16,i/16])]) expect(normalizeCurves({red: red as [number,number][]})).toEqual(defaultCurves());
  expect(()=>validateRecipeJSON(JSON.stringify({name:'Bad',baseFilmId:'FS-001',schemaVersion:3,curves:{red:[[0,0],[0,1],[1,1]]}}))).toThrow(/curve/);
 });
 it('records a whole drag as one undo step and resets channels independently',()=>{
  store.getState().setCurve('red',[[0,0],[.5,.6],[1,1]],false);store.getState().setCurve('red',[[0,0],[.5,.8],[1,1]],false);expect(store.getState().history).toHaveLength(1);
  store.getState().setCurve('red',store.getState().curves.red);expect(store.getState().history).toHaveLength(2);
  store.getState().undo();expect(store.getState().curves).toEqual(defaultCurves());store.getState().redo();expect(store.getState().curves.red[1][1]).toBe(.8);
  store.getState().setCurve('blue',[[0,.1],[1,1]]);store.getState().setCurveChannel('red');store.getState().resetCurves();expect(store.getState().curves.red).toEqual(defaultCurves().red);expect(store.getState().curves.blue[0][1]).toBe(.1);
  store.getState().resetCurves(true);expect(store.getState().curves).toEqual(defaultCurves());store.getState().undo();expect(store.getState().curves.blue[0][1]).toBe(.1);
 });
 it('round-trips v3 curves and endpoints, preserves camera and migrates v1/v2',async()=>{
  store.getState().setCurve('white',[[0,.1],[1,.9]]);store.getState().setAdjustment('blacks',-20);store.getState().setAdjustment('whites',15);
  const saved=await store.getState().saveCurrentAsRecipe('Curve');const parsed=validateRecipeJSON(JSON.stringify(saved));expect(parsed.curves).toEqual(saved.curves);expect(parsed.schemaVersion).toBe(3);
  store.getState().resetAdjustments();expect(store.getState().curves).toEqual(defaultCurves());store.getState().applyRecipe(parsed);expect(store.getState().curves).toEqual(saved.curves);expect(store.getState().adjustments.whites).toBe(15);
  store.getState().setFilm('FS-009');store.getState().applyMargarine('cream-daylight');expect(store.getState().curves).toEqual(saved.curves);
  for(const schemaVersion of [1,2]){const old=validateRecipeJSON(JSON.stringify({name:'Old',baseFilmId:'FS-001',schemaVersion}));expect(old.curves).toEqual(defaultCurves());expect(old.adjustments.blacks).toBe(0);}
 });
 it('counts RGB and luminance distributions, excluding transparent pixels',()=>{
  const bins=histogramFromPixels(new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,0]));
  expect(bins.map(c=>c.reduce((a,b)=>a+b,0))).toEqual([2,2,2,2]);expect(bins[1][63]).toBe(1);expect(bins[3][0]).toBe(2);
 });
});
