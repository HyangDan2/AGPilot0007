import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('idb-keyval',()=>({get:vi.fn(async()=>[]),set:vi.fn(async()=>undefined)}));
import {defaultCurves,normalizeCurves,moveCurvePoint,CURVE_MIN_GAP} from '../src/types/curves';
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
 it('rejects duplicate, out-of-range, NaN and oversized curve inputs',()=>{
  for(const red of [[[0,0],[0,1],[1,1]],[[-.2,0],[1,1]],[[0,NaN],[1,1]],Array.from({length:17},(_,i)=>[i/16,i/16])]) expect(normalizeCurves({red: red as [number,number][]})).toEqual(defaultCurves());
  expect(()=>validateRecipeJSON(JSON.stringify({name:'Bad',baseFilmId:'FS-001',schemaVersion:3,curves:{red:[[0,0],[0,1],[1,1]]}}))).toThrow(/curve/);
 });
 it('records a whole drag as one undo step and resets channels independently',()=>{
  store.getState().setCurve('red',[[0,0],[.5,.6],[1,1]],false);store.getState().setCurve('red',[[0,0],[.5,.8],[1,1]],false);expect(store.getState().history).toHaveLength(1);
  store.getState().setCurve('red',store.getState().curves.red);expect(store.getState().history).toHaveLength(2);
  store.getState().undo();expect(store.getState().curves).toEqual(defaultCurves());store.getState().redo();expect(store.getState().curves.red[1][1]).toBe(.8);
  store.getState().setCurve('blue',[[0,.1],[1,1]]);store.getState().setCurveChannel('red');store.getState().resetCurves();expect(store.getState().curves.red).toEqual(defaultCurves().red);expect(store.getState().curves.blue[0][1]).toBe(.1);
  store.getState().resetCurves(true);expect(store.getState().curves).toEqual(defaultCurves());store.getState().undo();expect(store.getState().curves.blue[0][1]).toBe(.1);
 });
 it('round-trips v4 curves and endpoints, preserves camera and migrates v1/v2/v3',async()=>{
  store.getState().setCurve('white',[[.15,.1],[.85,.9]]);store.getState().setAdjustment('blacks',-20);store.getState().setAdjustment('whites',15);
  const saved=await store.getState().saveCurrentAsRecipe('Curve');const parsed=validateRecipeJSON(JSON.stringify(saved));expect(parsed.curves).toEqual(saved.curves);expect(parsed.schemaVersion).toBe(4);
  store.getState().resetAdjustments();expect(store.getState().curves).toEqual(defaultCurves());store.getState().applyRecipe(parsed);expect(store.getState().curves).toEqual(saved.curves);expect(store.getState().adjustments.whites).toBe(15);
  store.getState().setFilm('FS-009');store.getState().applyMargarine('cream-daylight');expect(store.getState().curves).toEqual(saved.curves);
  for(const schemaVersion of [1,2,3]){const old=validateRecipeJSON(JSON.stringify({name:'Old',baseFilmId:'FS-001',schemaVersion}));expect(old.curves).toEqual(defaultCurves());expect(old.adjustments.blacks).toBe(0);}
 });
 it('counts RGB and luminance distributions, excluding transparent pixels',()=>{
  const bins=histogramFromPixels(new Uint8ClampedArray([255,0,0,255,0,255,0,255,0,0,255,0]));
  expect(bins.map(c=>c.reduce((a,b)=>a+b,0))).toEqual([2,2,2,2]);expect(bins[1][63]).toBe(1);expect(bins[3][0]).toBe(2);
 });
});

describe('Movable curve endpoints',()=>{
 it('keeps partial diagonal curves enabled and extends both output plateaus',()=>{
  const curves=defaultCurves();curves.white=[[.2,.2],[.8,.8]];
  expect(normalizeCurves(curves)).toEqual(curves);
  const texture=buildCurveTexture(curves);expect(texture.enabled).toBe(true);
  expect(texture.data[0]).toBeCloseTo(.2);expect(texture.data[(CURVE_SAMPLES-1)*4]).toBeCloseTo(.8);
  expect(texture.data[100*4]).toBeCloseTo(.2);expect(texture.data[950*4]).toBeCloseTo(.8);
  curves.white=[[.2,0],[.8,1]];const clipped=buildCurveTexture(curves);
  expect(clipped.data[100*4]).toBe(0);expect(clipped.data[950*4]).toBe(1);
 });
 it('moves endpoints in both axes without crossing neighbors or leaving the domain',()=>{
  const points:[number,number][]=[[0,0],[.5,.5],[1,1]];
  const left=moveCurvePoint(points,0,.2,.1);expect(left[0]).toEqual([.2,.1]);
  const right=moveCurvePoint(left,2,.8,.9);expect(right[2]).toEqual([.8,.9]);
  expect(moveCurvePoint(right,0,2,-2)[0]).toEqual([.5-CURVE_MIN_GAP,0]);
  expect(moveCurvePoint(right,2,-2,2)[2]).toEqual([.5+CURVE_MIN_GAP,1]);
  expect(points).toEqual([[0,0],[.5,.5],[1,1]]);
  expect(normalizeCurves({red:moveCurvePoint(right,0,2,0)}).red[0][0]).toBe(.5-CURVE_MIN_GAP);
 });
 it('restores endpoint coordinates through undo/redo, reset and recipe round-trip',async()=>{
  store.getState().setCurve('red',[[.2,.05],[.8,.95]]);
  store.getState().undo();expect(store.getState().curves.red).toEqual([[0,0],[1,1]]);
  store.getState().redo();expect(store.getState().curves.red).toEqual([[.2,.05],[.8,.95]]);
  store.getState().setCurveChannel('red');store.getState().resetCurves();expect(store.getState().curves.red).toEqual([[0,0],[1,1]]);
  store.getState().undo();const saved=await store.getState().saveCurrentAsRecipe('Endpoints');
  const parsed=validateRecipeJSON(JSON.stringify(saved));expect(parsed.schemaVersion).toBe(4);expect(parsed.curves!.red).toEqual([[.2,.05],[.8,.95]]);
 });
});

 it('changes channel and selected endpoint together before the next numeric edit',()=>{
  store.setState(store.getInitialState(),true);
  store.getState().setCurvePointIndex(1);
  const transitions:{channel:string;index:number}[]=[];
  const unsub=store.subscribe(s=>transitions.push({channel:s.curveChannel,index:s.curvePointIndex}));
  store.getState().setCurveChannel('blue');unsub();
  expect(transitions).toEqual([{channel:'blue',index:0}]);
  const state=store.getState();state.setCurve(state.curveChannel,moveCurvePoint(state.curves.blue,state.curvePointIndex,0,30/255));
  expect(store.getState().curves.blue).toEqual([[0,30/255],[1,1]]);
 });
