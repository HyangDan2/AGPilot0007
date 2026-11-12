import { getEffectiveCamera, supportsCameraEffects } from '../src/films/cameraEffects';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
vi.mock('idb-keyval',()=>({get:vi.fn(async()=>[]),set:vi.fn(async()=>undefined)}));
import { DEFAULT_CAMERA, isValidStampDate, normalizeCamera } from '../src/types/camera';
import { formatStampDate, stampLayout } from '../src/engine/overlay/dateStamp';
import { parseCaptureDate } from '../src/engine/image/captureDate';
import { useEditorStore } from '../src/stores/editorStore';
import { validateRecipeJSON } from '../src/stores/recipeStore';
import { parseCubeLut } from '../src/engine/color/lutLoader';
import { FILM_LIST, FILM_PROFILES } from '../src/films/registry';
import type { DecodedImage } from '../src/engine/image/decoder';

beforeEach(()=>useEditorStore.setState(useEditorStore.getInitialState(),true));
describe('Retro film and independent date imprint',()=>{
 it('registers a valid 33-cube without adding a tenth individual card',()=>{
  expect(FILM_LIST).toHaveLength(9);expect(FILM_PROFILES['FS-010'].name).toBe('RETRO 90');
  const lut=parseCubeLut(readFileSync('public/luts/FS-010_RETRO90.cube','utf8'));
  expect(lut.size).toBe(33);expect(lut.floatData.length).toBe(33**3*3);
  expect([...lut.floatData].every(v=>Number.isFinite(v)&&v>=0&&v<=1)).toBe(true);
  expect([...lut.floatData.slice(0,3)]).toEqual([0,0,0]);
 });
 it('validates calendar dates without rolling impossible days into another month',()=>{
  expect(isValidStampDate('2024-02-29')).toBe(true);expect(isValidStampDate('2023-02-29')).toBe(false);
  for(const value of ['2016-13-01','2016-04-31','0000-01-01','not a date','2016-3-8'])expect(isValidStampDate(value)).toBe(false);
  expect(parseCaptureDate('2016:03:08 23:59:59')).toBe('2016-03-08');expect(parseCaptureDate('2016:02:31 12:00:00')).toBeUndefined();
  expect(parseCaptureDate(undefined)).toBeUndefined();
 });
 it('formats every supported date style and keeps layout proportional across resolutions',()=>{
  const stamp={...DEFAULT_CAMERA.dateStamp,date:'2016-03-08',enabled:true};
  expect(formatStampDate(stamp)).toBe("'16 3 8");expect(formatStampDate({...stamp,format:'padded'})).toBe('16 03 08');expect(formatStampDate({...stamp,format:'full'})).toBe('2016 03 08');
  const a=stampLayout(1000,750,stamp),b=stampLayout(4000,3000,stamp);
  expect(b.x/4).toBeCloseTo(a.x,0);expect(b.y/4).toBeCloseTo(a.y,0);expect(b.digitHeight).toBe(a.digitHeight*4);
  expect(stampLayout(1000,750,{...stamp,position:'bottom-left'}).x).toBeLessThan(a.x);
 });
 it('applies the whole look, keeps dates across film changes, and restores all state on undo',()=>{
  const store=useEditorStore;
  store.getState().applyOldSchool();store.getState().updateDateStamp({date:'2016-03-08',enabled:true});
  expect(store.getState().adjustments.exposure).toBe(-.35);expect(store.getState().camera.optics.glow).toBe(12);
  store.getState().setFilm('FS-009');expect(store.getState().camera.dateStamp.enabled).toBe(true);expect(getEffectiveCamera(store.getState().activeFilmId,store.getState().camera).optics.glow).toBe(0);
  store.getState().undo();expect(store.getState().activeFilmId).toBe('FS-010');expect(store.getState().camera.optics.glow).toBe(12);
  store.getState().updateDateStamp({position:'bottom-left'});store.getState().undo();expect(store.getState().camera.dateStamp.position).toBe('bottom-right');store.getState().redo();expect(store.getState().camera.dateStamp.position).toBe('bottom-left');
  store.getState().resetAdjustments();expect(store.getState().camera.dateStamp.enabled).toBe(true);
  store.getState().resetCamera();expect(store.getState().camera.dateStamp.enabled).toBe(false);store.getState().undo();expect(store.getState().camera.dateStamp.enabled).toBe(true);
 });
 it('round-trips version 2 camera recipes and safely migrates legacy recipes',async()=>{
  const store=useEditorStore;store.getState().applyOldSchool();store.getState().updateDateStamp({date:'2016-03-08',enabled:true,format:'full',position:'bottom-left',glow:70,color:'#fa7020'});
  const saved=await store.getState().saveCurrentAsRecipe('Retro');const parsed=validateRecipeJSON(JSON.stringify(saved));
  expect(parsed.schemaVersion).toBe(2);expect(parsed.camera).toEqual(store.getState().camera);
  store.getState().resetCamera();store.getState().applyRecipe(parsed);expect(store.getState().camera).toEqual(saved.camera);
  const old=validateRecipeJSON(JSON.stringify({name:'Legacy',baseFilmId:'FS-001',schemaVersion:1}));expect(old.camera).toEqual(DEFAULT_CAMERA);
  store.getState().applyRecipe(old);expect(store.getState().camera.dateStamp.enabled).toBe(false);
  expect(()=>validateRecipeJSON(JSON.stringify({...saved,camera:{dateStamp:{enabled:true,date:'2016-02-31'}}}))).toThrow(/date/);
  expect(()=>validateRecipeJSON(JSON.stringify({...saved,schemaVersion:3}))).toThrow(/version/);
 });
 it('does not carry the previous photo EXIF date into a photo with no EXIF',()=>{
  const store=useEditorStore;store.getState().applyOldSchool();store.getState().updateDateStamp({date:'2016-03-08',enabled:true,source:'exif'});
  store.getState().setImage({captureDateStatus:'missing',sourceUrl:'test'} as DecodedImage);
  expect(store.getState().camera.dateStamp.enabled).toBe(false);expect(store.getState().camera.dateStamp.date).toBe('');expect(store.getState().canUndo).toBe(false);
 });
 it('clamps imported controls and rejects unsafe colors without altering defaults',()=>{
  const value=normalizeCamera({dateStamp:{...DEFAULT_CAMERA.dateStamp,size:999,color:'url(evil)',glow:NaN},optics:{glow:-10,halation:101,softness:Infinity,quality:'high'}});
  expect(value.dateStamp.size).toBe(6);expect(value.dateStamp.color).toBe(DEFAULT_CAMERA.dateStamp.color);expect(value.optics).toEqual({glow:0,halation:100,softness:0,quality:'high'});expect(DEFAULT_CAMERA.dateStamp.size).toBe(3);
 });
});

 describe('Camera effect capability boundaries',()=>{
  it('disables every custom effect for the nine films and all Margarine bases',()=>{
   const camera=normalizeCamera();camera.dateStamp={...camera.dateStamp,enabled:true,date:'2016-03-08'};camera.optics={glow:100,halation:100,softness:100,quality:'high'};
   for(const profile of FILM_LIST){expect(supportsCameraEffects(profile.id)).toBe(false);expect(getEffectiveCamera(profile.id,camera)).toEqual(DEFAULT_CAMERA);}
   expect(getEffectiveCamera(undefined,camera)).toEqual(DEFAULT_CAMERA);
   expect(getEffectiveCamera('FS-010',camera)).toEqual(camera);
  });
  it('preserves customized optics and dates while closing the UI across filter switches',()=>{
   const store=useEditorStore;store.getState().applyOldSchool();store.getState().updateDateStamp({date:'2016-03-08',enabled:true});store.getState().updateOptics({glow:47});store.getState().toggleCameraEffects();
   expect(store.getState().isCameraEffectsOpen).toBe(true);store.getState().setFilm('FS-009');expect(store.getState().isCameraEffectsOpen).toBe(false);
   expect(getEffectiveCamera('FS-009',store.getState().camera).dateStamp.enabled).toBe(false);expect(store.getState().camera.optics.glow).toBe(47);
   store.getState().applyMargarine('cream-daylight');expect(getEffectiveCamera(store.getState().activeFilmId,store.getState().camera)).toEqual(DEFAULT_CAMERA);
   store.getState().applyOldSchool();expect(store.getState().camera.optics.glow).toBe(47);expect(store.getState().camera.dateStamp.date).toBe('2016-03-08');expect(store.getState().isCameraEffectsOpen).toBe(false);
  });
  it('keeps imported unsupported camera settings inert and rejects unsupported UI actions',()=>{
   const store=useEditorStore;const initial=store.getState().camera;store.getState().updateDateStamp({date:'2016-03-08',enabled:true});store.getState().updateOptics({glow:80});store.getState().toggleCameraEffects();expect(store.getState().camera).toEqual(initial);expect(store.getState().isCameraEffectsOpen).toBe(false);
   const recipe=validateRecipeJSON(JSON.stringify({name:'Old custom',baseFilmId:'FS-001',schemaVersion:2,camera:{dateStamp:{...DEFAULT_CAMERA.dateStamp,enabled:true,date:'2016-03-08'},optics:{glow:100,halation:100,softness:100}}}));
   store.getState().applyRecipe(recipe);expect(getEffectiveCamera(store.getState().activeFilmId,store.getState().camera)).toEqual(DEFAULT_CAMERA);
  });
 });
