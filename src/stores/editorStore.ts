import {SharpeningSettings,normalizeSharpening,DEFAULT_SHARPENING} from '../types/sharpening';
import { ColorMixerSettings, MixerUI, defaultColorMixer, normalizeColorMixer } from '../types/colorMixer';
import { ToneCurves, CurveChannel, CurvePoint, defaultCurves, normalizeCurves, identityPoints } from '../types/curves';
import { getCameraEffects, supportsCameraEffects } from '../films/cameraEffects';
import { CameraSettings, DateStampSettings, OpticalSettings, normalizeCamera } from '../types/camera';
import { RETRO90 } from '../films/retro90';
import { create } from 'zustand';
import { decodeImageFile, type DecodedImage } from '../engine/image/decoder';
import { readCaptureDate } from '../engine/image/captureDate';
import type { CpuImageBuffer, DecodedSource } from '../engine/contracts/imageBuffer';
import { FilmId, AdjustmentSettings, DEFAULT_ADJUSTMENTS, CustomRecipe } from '../types/film';
import { FILM_PROFILES } from '../films/registry';
import { loadSavedRecipes, persistRecipes, validateRecipeJSON, shouldWriteRecipeV9 } from './recipeStore';
import { IDENTITY_GEOMETRY, normalizeGeometry, type GeometryTransform } from '../engine/contracts/geometry';
import { normalizeOpticalTransform } from '../engine/optical/transform';
import type { OpticalTransform } from '../engine/contracts/optical';
import { normalizeLocalAdjustments, type LocalAdjustmentState } from '../engine/contracts/localAdjustments';
import { RECIPE_SCHEMA_V8 } from '../engine/contracts/recipeV8';
import { RECIPE_SCHEMA_V9 } from '../engine/contracts/recipeV9';

import { getMargarinePreset, MARGARINE_PRESETS } from '../presets/margarine';

const RAW_EXTENSIONS = new Set(['.cr2','.cr3','.crw','.nef','.nrw','.arw','.sr2','.srf','.raf','.rw2','.orf','.pef','.iiq','.mos','.3fr','.fff','.mrw','.srw','.x3f','.kdc','.dcr','.dcs','.erf','.mef','.mdc','.raw','.ari','.dng']);
export const RAW_FILE_ACCEPT = '.cr2,.cr3,.nef,.arw,.raf,.orf,.dng,.rw2,.pef,.srw,.x3f';

export function isRawImageFile(file: { name?: string }): boolean {
  const name = file.name ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 && RAW_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

let halfSrgbLut: Uint8Array | null = null;
function linearToSrgbByte(value: number): number {
  if (!(value > 0)) return 0;
  if (value >= 1) return 255;
  const encoded = value <= 0.0031308 ? 12.92 * value : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}
function linearLut(): Uint8Array {
  if (halfSrgbLut) return halfSrgbLut;
  const lut = new Uint8Array(65536);
  for (let bits = 0; bits < 65536; bits += 1) {
    const sign = bits & 0x8000 ? -1 : 1;
    const exponent = (bits >> 10) & 0x1f;
    const fraction = bits & 0x3ff;
    const value = exponent === 0
      ? sign * Math.pow(2, -14) * (fraction / 1024)
      : exponent === 31
        ? (fraction ? NaN : sign * Infinity)
        : sign * Math.pow(2, exponent - 15) * (1 + fraction / 1024);
    lut[bits] = linearToSrgbByte(value);
  }
  halfSrgbLut = lut;
  return lut;
}
function rawFrameToCanvas(source: CpuImageBuffer, maxEdge?: number): HTMLCanvasElement {
  const { width, height } = source;
  const scale = maxEdge ? Math.min(1, maxEdge / Math.max(width, height)) : 1;
  const outWidth = Math.max(1, Math.round(width * scale));
  const outHeight = Math.max(1, Math.round(height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = outWidth;
  canvas.height = outHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Failed to create RAW preview canvas');
  const image = ctx.createImageData(outWidth, outHeight);
  const lut = source.data instanceof Float32Array ? null : linearLut();
  const data = source.data;
  for (let y = 0; y < outHeight; y += 1) {
    const sourceY = Math.min(height - 1, Math.floor((y * height) / outHeight));
    for (let x = 0; x < outWidth; x += 1) {
      const sourceX = Math.min(width - 1, Math.floor((x * width) / outWidth));
      const src = (sourceY * width + sourceX) * 4;
      const dst = (y * outWidth + x) * 4;
      if (lut && data instanceof Uint16Array) {
        image.data[dst] = lut[data[src]];
        image.data[dst + 1] = lut[data[src + 1]];
        image.data[dst + 2] = lut[data[src + 2]];
      } else if (data instanceof Float32Array) {
        image.data[dst] = linearToSrgbByte(data[src]);
        image.data[dst + 1] = linearToSrgbByte(data[src + 1]);
        image.data[dst + 2] = linearToSrgbByte(data[src + 2]);
      }
      image.data[dst + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}
async function rawToDecodedImage(raw: DecodedSource, file: File): Promise<DecodedImage> {
  const working = raw.working as CpuImageBuffer;
  const preview = rawFrameToCanvas(working, 2048);
  // The renderer and canvas drawImage paths accept a canvas; keeping it avoids
  // encoding a 20MP+ frame to a data URL just to obtain an HTMLImageElement.
  const original = rawFrameToCanvas(working) as unknown as HTMLImageElement;
  const metadata = await readCaptureDate(file);
  return {
    ...metadata,
    sourceUrl: URL.createObjectURL(file),
    name: file.name || `${raw.source.id}.raw`,
    originalWidth: raw.source.width,
    originalHeight: raw.source.height,
    previewCanvas: preview,
    previewWidth: preview.width,
    previewHeight: preview.height,
    originalElement: original,
  };
}

export interface EditorImageLoad {
  image: DecodedImage;
  rawSource: DecodedSource | null;
}
export async function decodeEditorImage(file: File | Blob, signal?: AbortSignal): Promise<EditorImageLoad> {
  const name = (file as File).name || 'photo.jpg';
  if (!isRawImageFile({ name })) return { image: await decodeImageFile(file, name, signal), rawSource: null };
  try {
    const { decodeRawToSource } = await import('../engine/raw');
    const raw = await decodeRawToSource({ data: file, name, type: file.type, size: file.size }, { signal });
    return { image: await rawToDecodedImage(raw, file as File), rawSource: raw };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    const code = (error as { code?: string }).code;
    const label = code === 'unsupported-format'
      ? 'Unsupported RAW format'
      : code === 'corrupt-file'
        ? 'Corrupt RAW file'
        : code === 'budget-exceeded'
          ? 'RAW file exceeds the memory budget'
          : 'RAW decode failed';
    throw new Error(`${label}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export interface EditorSnapshot {
  sharpening: SharpeningSettings;
  colorMixer: ColorMixerSettings;
  curves: ToneCurves;
  camera: CameraSettings;
  adjustments: AdjustmentSettings;
  activeFilmId: FilmId;
  activePresetId: string | null;
  geometry: GeometryTransform;
  optical: OpticalTransform | null;
  localAdjustments: LocalAdjustmentState;
}

interface SnapshotSource {
  sharpening: SharpeningSettings;
  colorMixer: ColorMixerSettings;
  curves: ToneCurves;
  camera: CameraSettings;
  adjustments: AdjustmentSettings;
  activeFilmId: FilmId;
  activePresetId: string | null;
  geometry: GeometryTransform;
  optical: OpticalTransform | null;
  localAdjustments: LocalAdjustmentState;
}

function snapshotOf(state: SnapshotSource, overrides: Partial<EditorSnapshot> = {}): EditorSnapshot {
  return {
    sharpening: normalizeSharpening(state.sharpening),
    colorMixer: normalizeColorMixer(state.colorMixer),
    curves: normalizeCurves(state.curves),
    camera: normalizeCamera(state.camera),
    adjustments: { ...state.adjustments },
    activeFilmId: state.activeFilmId,
    activePresetId: state.activePresetId,
    geometry: normalizeGeometry(state.geometry),
    optical: state.optical ? normalizeOpticalTransform(state.optical) : null,
    localAdjustments: normalizeLocalAdjustments(state.localAdjustments),
    ...overrides,
  };
}

function pushSnapshot(
  state: { history: EditorSnapshot[]; historyIndex: number },
  snapshot: EditorSnapshot,
): EditorSnapshot[] | null {
  if (sameSnapshot(snapshot, state.history[state.historyIndex])) return null;
  return [...state.history.slice(0, state.historyIndex + 1), snapshot].slice(-50);
}

function sameSnapshot(a:EditorSnapshot,b:EditorSnapshot|undefined){
  if(!b)return false;
  const values=(s:EditorSnapshot)=>[s.sharpening,s.colorMixer,s.curves,s.camera,s.adjustments,s.activeFilmId,s.activePresetId,s.geometry,s.optical,s.localAdjustments];
  return JSON.stringify(values(a))===JSON.stringify(values(b));
}

export interface ParameterGroupsPatch {
  film?: { filmId: FilmId; presetId?: string | null };
  adjustments?: AdjustmentSettings;
  curves?: ToneCurves;
  camera?: CameraSettings;
  colorMixer?: ColorMixerSettings;
  sharpening?: SharpeningSettings;
  geometry?: GeometryTransform;
  optical?: OpticalTransform | null;
  localAdjustments?: LocalAdjustmentState;
}

export type AppView = 'home' | 'editor';

interface EditorState extends MixerUI {
  sharpening:SharpeningSettings;
  sharpeningMask:boolean;
  isSharpeningDragging:boolean;
  detailZoomReturn:{zoom:number;pan:{x:number;y:number}}|null;
  setSharpening:(value:SharpeningSettings,commit?:boolean)=>void;
  setSharpeningMask:(value:boolean)=>void;
  toggleDetailZoom:()=>void;
  colorMixer: ColorMixerSettings;
  toggleColorMixer: () => void;
  setMixerUI: (patch: Partial<MixerUI>) => void;
  setColorMixer: (value: ColorMixerSettings, commit?: boolean) => void;
  resetColorMixer: () => void;
  curves: ToneCurves;
  isToneCurveOpen: boolean;
  curveChannel: CurveChannel;
  curvePointIndex: number;
  setCurvePointIndex: (index: number) => void;
  toggleToneCurve: () => void;
  setCurveChannel: (channel: CurveChannel) => void;
  setCurve: (channel: CurveChannel, points: CurvePoint[], commit?: boolean) => void;
  resetCurves: (all?: boolean) => void;
  geometry: GeometryTransform;
  optical: OpticalTransform | null;
  localAdjustments: LocalAdjustmentState;
  setGeometry: (value: GeometryTransform, commit?: boolean) => void;
  setOptical: (value: OpticalTransform | null, commit?: boolean) => void;
  setLocalAdjustments: (value: LocalAdjustmentState, commit?: boolean) => void;
  resetGeometry: () => void;
  resetOptical: () => void;
  resetLocalAdjustments: () => void;
  applyParameterGroups: (patch: ParameterGroupsPatch) => void;
  camera: CameraSettings;
  hasOldSchoolSettings: boolean;
  isCameraEffectsOpen: boolean;
  toggleCameraEffects: () => void;
  isFilterSetOpen: boolean;
  openFilterSet: () => void;
  closeFilterSet: () => void;
  applyOldSchool: () => void;
  updateDateStamp: (patch: Partial<DateStampSettings>) => void;
  updateOptics: (patch: Partial<OpticalSettings>) => void;
  resetCamera: () => void;
  currentView: AppView;
  image: DecodedImage | null;
  rawSource: DecodedSource | null;
  activeFilmId: FilmId;
  adjustments: AdjustmentSettings;
  compareMode: 'none' | 'original' | 'split';
  splitPos: number;
  zoom: number;
  pan: { x: number; y: number };
  isExporting: boolean;
  exportProgress: { progress: number; stage: string };
  recipes: CustomRecipe[];
  activePresetId: string | null;
  lastPresetId: string;
  isMargarineOpen: boolean;
  selectMargarine: () => void;
  applyMargarine: (id: string) => void;
  closeMargarine: () => void;
  history: EditorSnapshot[];
  historyIndex: number;

  // Actions
  setView: (view: AppView) => void;
  setImage: (img: DecodedImage, rawSource?: DecodedSource | null) => void;
  setFilm: (filmId: FilmId) => void;
  setAdjustment: <K extends keyof AdjustmentSettings>(key: K, val: number) => void;
  resetAdjustments: () => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  setCompareMode: (mode: 'none' | 'original' | 'split') => void;
  setSplitPos: (pos: number) => void;
  setZoom: (zoom: number) => void;
  setPan: (pan: { x: number; y: number }) => void;
  setZoomAndPan: (zoom: number, pan: { x: number; y: number }) => void;
  resetZoomPan: () => void;

  // Recipe actions
  loadRecipes: () => Promise<void>;
  saveCurrentAsRecipe: (name: string) => Promise<CustomRecipe>;
  deleteRecipe: (id: string) => Promise<void>;
  renameRecipe: (id: string, newName: string) => Promise<void>;
  duplicateRecipe: (id: string) => Promise<void>;
  applyRecipe: (recipe: CustomRecipe) => void;
  importRecipe: (jsonStr: string) => Promise<CustomRecipe>;
}

export const useEditorStore = create<EditorState>((set, get) => ({
  sharpening:{...DEFAULT_SHARPENING},sharpeningMask:false,isSharpeningDragging:false,detailZoomReturn:null,
  setSharpeningMask:sharpeningMask=>set({sharpeningMask,isColorMixerOpen:false,isToneCurveOpen:false,isCameraEffectsOpen:false,mixerTool:'none',mixerVisualize:false}),
  toggleDetailZoom:()=>{const s=get();if(s.detailZoomReturn){set({...s.detailZoomReturn,detailZoomReturn:null});}else{set({detailZoomReturn:{zoom:s.zoom,pan:s.pan}});}},
  setSharpening:(value,commit=true)=>{
    const state=get(),sharpening=normalizeSharpening(value),adjustments={...state.adjustments,sharpness:0};
    if(!commit){set({sharpening,adjustments,isSharpeningDragging:true});return;}
    set({isSharpeningDragging:false});
    const snapshot=snapshotOf(state,{sharpening,adjustments});
    const history=pushSnapshot(state,snapshot);
    if(!history)return;
    set({sharpening,adjustments,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  colorMixer: defaultColorMixer(),
  isColorMixerOpen: false,
  mixerTab: 'mixer', mixerView: 'color', mixerAxis: 'hue', mixerColor: 'red', mixerPointId: null,
  mixerTool: 'none', mixerVisualize: false, mixerMessage: '',
  setMixerUI: patch => set(patch),
  toggleColorMixer: () => set({detailZoomReturn:null,sharpeningMask:false,isColorMixerOpen:!get().isColorMixerOpen,isToneCurveOpen:false,isCameraEffectsOpen:false,mixerTool:'none',mixerVisualize:false,mixerMessage:''}),
  setColorMixer: (value, commit=true) => {
    const state=get(), colorMixer=normalizeColorMixer(value);
    if(!commit){set({colorMixer});return;}
    const snapshot=snapshotOf(state,{colorMixer});
    const history=pushSnapshot(state,snapshot);
    if(!history)return;
    set({colorMixer,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  resetColorMixer: () => {get().setColorMixer(defaultColorMixer());set({mixerPointId:null,mixerVisualize:false,mixerTool:'none'});},
  curves: defaultCurves(),
  isToneCurveOpen: false,
  curveChannel: 'white',
  curvePointIndex: 0,
  setCurvePointIndex: index => set({curvePointIndex: Math.max(0,Math.min(15,Math.floor(index)))}),
  toggleToneCurve: () => set({detailZoomReturn:null,sharpeningMask:false,isToneCurveOpen: !get().isToneCurveOpen, isCameraEffectsOpen: false, isColorMixerOpen:false,mixerTool:'none',mixerVisualize:false}),
  setCurveChannel: curveChannel => set({curveChannel,curvePointIndex:0}),
  setCurve: (channel, points, commit = true) => {
    const state = get();
    const curves = normalizeCurves({...state.curves, [channel]: points});
    if (!commit) { set({curves}); return; }
    const snapshot = snapshotOf(state,{curves});
    const history = pushSnapshot(state, snapshot);
    if (!history) return;
    set({curves, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo:false});
  },
  resetCurves: (all = false) => {
    if (all) set({curves: defaultCurves()});
    get().setCurve(get().curveChannel, identityPoints());
  },
  camera: normalizeCamera(),
  geometry: IDENTITY_GEOMETRY,
  optical: null,
  localAdjustments: normalizeLocalAdjustments(undefined),
  hasOldSchoolSettings: false,
  isCameraEffectsOpen: false,
  toggleCameraEffects: () => { if (supportsCameraEffects(get().activeFilmId)) set({ detailZoomReturn:null,sharpeningMask:false,isCameraEffectsOpen: !get().isCameraEffectsOpen, isToneCurveOpen: false, isColorMixerOpen:false,mixerTool:'none',mixerVisualize:false }); },
  isFilterSetOpen: false,
  currentView: 'home',
  image: null,
  rawSource: null,
  activeFilmId: 'FS-001',
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  compareMode: 'none',
  splitPos: 0.5,
  zoom: 1.0,
  pan: { x: 0, y: 0 },
  isExporting: false,
  exportProgress: { progress: 0, stage: '' },
  recipes: [],
  activePresetId: null,
  lastPresetId: MARGARINE_PRESETS[0].id,
  isMargarineOpen: false,
  history: [snapshotOf({
    sharpening:{...DEFAULT_SHARPENING}, colorMixer:defaultColorMixer(), curves: defaultCurves(), camera: normalizeCamera(), adjustments: { ...DEFAULT_ADJUSTMENTS }, activeFilmId: 'FS-001', activePresetId: null,
    geometry: IDENTITY_GEOMETRY, optical: null, localAdjustments: normalizeLocalAdjustments(undefined),
  })],
  historyIndex: 0,
  canUndo: false,
  canRedo: false,

  selectMargarine: () => {
    if (get().activePresetId) set({ isMargarineOpen: true });
    else get().applyMargarine(get().lastPresetId);
  },
  closeMargarine: () => set({ isMargarineOpen: false }),
  applyMargarine: (id) => {
    const preset = getMargarinePreset(id);
    if (!preset) return;
    const snapshot = snapshotOf(get(),{adjustments:{...preset.adjustments},activeFilmId:preset.baseFilmId,activePresetId:id});
    const history = [...get().history.slice(0, get().historyIndex + 1), snapshot].slice(-50);
    set({ isCameraEffectsOpen: false,mixerTool:'none',mixerVisualize:false, ...snapshot, lastPresetId: id, history, historyIndex: history.length - 1, canUndo: history.length > 1, canRedo: false });
  },
  openFilterSet: () => set({ isFilterSetOpen: true, isMargarineOpen: false }),
  closeFilterSet: () => set({ isFilterSetOpen: false }),
  applyOldSchool: () => {
    const snapshot = snapshotOf(get(), {
      activeFilmId: 'FS-010',
      activePresetId: null,
      adjustments: { ...DEFAULT_ADJUSTMENTS, ...RETRO90.defaultAdjustments },
      camera: get().hasOldSchoolSettings ? normalizeCamera(get().camera) : normalizeCamera({ ...get().camera, optics: { glow: 12, halation: 8, softness: 8, quality: 'standard' } }),
    });
    const history = [...get().history.slice(0,get().historyIndex+1),snapshot].slice(-50);
    set({ ...snapshot, hasOldSchoolSettings: true, isCameraEffectsOpen: false,mixerTool:'none',mixerVisualize:false, isFilterSetOpen: false, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo: false });
  },
  updateDateStamp: (patch) => {
    const state = get();
    if (!getCameraEffects(state.activeFilmId).includes('dateStamp')) return;
    const camera = normalizeCamera({ ...state.camera, dateStamp: { ...state.camera.dateStamp, ...patch } });
    if (JSON.stringify(camera) === JSON.stringify(state.camera)) return;
    const snapshot = snapshotOf(state,{camera});
    const history = [...state.history.slice(0,state.historyIndex+1),snapshot].slice(-50);
    set({ camera, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo: false });
  },
  updateOptics: (patch) => {
    const state = get();
    if (!getCameraEffects(state.activeFilmId).some(effect => effect !== 'dateStamp')) return;
    const camera = normalizeCamera({ ...state.camera, optics: { ...state.camera.optics, ...patch } });
    if (JSON.stringify(camera) === JSON.stringify(state.camera)) return;
    const snapshot = snapshotOf(state,{camera});
    const history = [...state.history.slice(0,state.historyIndex+1),snapshot].slice(-50);
    set({ camera, history, historyIndex: history.length-1, canUndo: history.length>1, canRedo: false });
  },
  resetCamera: () => {
    const state=get();
    if (!supportsCameraEffects(state.activeFilmId)) return;
    const snapshot=snapshotOf(state,{camera:normalizeCamera()});
    const history=[...state.history.slice(0,state.historyIndex+1),snapshot].slice(-50);
    set({...snapshot,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  setGeometry: (value, commit = true) => {
    const state=get(), geometry=normalizeGeometry(value);
    if(!commit){set({geometry});return;}
    const history=pushSnapshot(state,snapshotOf(state,{geometry}));
    if(!history)return;
    set({geometry,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  setOptical: (value, commit = true) => {
    const state=get(), optical=value?normalizeOpticalTransform(value):null;
    if(!commit){set({optical});return;}
    const history=pushSnapshot(state,snapshotOf(state,{optical}));
    if(!history)return;
    set({optical,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  setLocalAdjustments: (value, commit = true) => {
    const state=get(), localAdjustments=normalizeLocalAdjustments(value);
    if(!commit){set({localAdjustments});return;}
    const history=pushSnapshot(state,snapshotOf(state,{localAdjustments}));
    if(!history)return;
    set({localAdjustments,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  resetGeometry: () => get().setGeometry(IDENTITY_GEOMETRY),
  resetOptical: () => get().setOptical(null),
  resetLocalAdjustments: () => get().setLocalAdjustments(normalizeLocalAdjustments(undefined)),
  applyParameterGroups: (patch) => {
    const state=get();
    const filmPatch = patch.film && Object.hasOwn(FILM_PROFILES, patch.film.filmId) ? patch.film : undefined;
    const filmId = filmPatch ? filmPatch.filmId : state.activeFilmId;
    const presetId = filmPatch ? (filmPatch.presetId ?? null) : state.activePresetId;
    const next = {
      activeFilmId: filmId,
      activePresetId: presetId && getMargarinePreset(presetId)?.baseFilmId === filmId ? presetId : null,
      adjustments: patch.adjustments ? { ...patch.adjustments } : { ...state.adjustments },
      curves: patch.curves ? normalizeCurves(patch.curves) : normalizeCurves(state.curves),
      camera: patch.camera ? normalizeCamera(patch.camera) : normalizeCamera(state.camera),
      colorMixer: patch.colorMixer ? normalizeColorMixer(patch.colorMixer) : normalizeColorMixer(state.colorMixer),
      sharpening: patch.sharpening ? normalizeSharpening(patch.sharpening) : normalizeSharpening(state.sharpening),
      geometry: patch.geometry ? normalizeGeometry(patch.geometry) : normalizeGeometry(state.geometry),
      optical: patch.optical !== undefined ? (patch.optical ? normalizeOpticalTransform(patch.optical) : null) : (state.optical ? normalizeOpticalTransform(state.optical) : null),
      localAdjustments: patch.localAdjustments ? normalizeLocalAdjustments(patch.localAdjustments) : normalizeLocalAdjustments(state.localAdjustments),
    };
    const history=pushSnapshot(state,snapshotOf(state,next));
    if(!history)return;
    set({...next,history,historyIndex:history.length-1,canUndo:history.length>1,canRedo:false});
  },
  setView: (view) => set({ currentView: view }),

  setImage: (img, rawSource = null) => {
    const prevImg = get().image;
    if (prevImg && prevImg.sourceUrl && prevImg.sourceUrl.startsWith('blob:')) {
      try {
        URL.revokeObjectURL(prevImg.sourceUrl);
      } catch {
        // ignore revoke error
      }
    }
    const state = get();
    const camera = normalizeCamera(state.camera.dateStamp.source === 'exif' ? {
      ...state.camera, dateStamp: { ...state.camera.dateStamp, date: img.captureDate || '', enabled: state.camera.dateStamp.enabled && !!img.captureDate }
    } : state.camera);
    const geometry = IDENTITY_GEOMETRY;
    const optical: OpticalTransform | null = null;
    const localAdjustments = normalizeLocalAdjustments(undefined);
    const snapshot = snapshotOf(state,{camera,geometry,optical,localAdjustments});
    set({
      isCameraEffectsOpen: false, mixerTool:'none', mixerVisualize:false,
      camera, geometry, optical, localAdjustments,
      history: [snapshot], historyIndex: 0, canUndo: false, canRedo: false,
      isColorMixerOpen:false,mixerPointId:null,
      sharpeningMask:false,isSharpeningDragging:false,detailZoomReturn:null,
      image: img,
      rawSource,
      currentView: 'editor',
      zoom: 1.0,
      pan: { x: 0, y: 0 },
    });
  },

  setFilm: (filmId) => {
    const profile = FILM_PROFILES[filmId];
    if (!profile) return;
    const current = get().adjustments;
    // Apply film-specific default grain if user hasn't explicitly customized
    const newAdjustments: AdjustmentSettings = {
      ...current,
      grain: profile.grain.amount,
      filmStrength: 100,
    };

    const newHistory = get().history.slice(0, get().historyIndex + 1);
    const camera = normalizeCamera(get().camera);
    newHistory.push(snapshotOf(get(),{camera,adjustments:newAdjustments,activeFilmId:filmId,activePresetId:null}));

    set({
      camera,
      isCameraEffectsOpen: false, mixerTool:'none', mixerVisualize:false,
      activeFilmId: filmId,
      activePresetId: null,
      adjustments: newAdjustments,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      canUndo: newHistory.length > 1,
      canRedo: false,
    });
  },

  setAdjustment: (key, val) => {
    const current = get().adjustments;
    if (current[key] === val) return;

    const updated = { ...current, [key]: val };
    if(key==='sharpness')set({sharpening:normalizeSharpening(undefined,val)});
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    newHistory.push(snapshotOf(get(),{adjustments:updated}));

    // Limit history stack to 50
    if (newHistory.length > 50) newHistory.shift();

    set({
      adjustments: updated,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      canUndo: newHistory.length > 1,
      canRedo: false,
    });
  },

  resetAdjustments: () => {
    const film = FILM_PROFILES[get().activeFilmId];
    const resetValues: AdjustmentSettings = getMargarinePreset(get().activePresetId)?.adjustments || {
      ...DEFAULT_ADJUSTMENTS,
      grain: film ? film.grain.amount : 0,
      ...(get().activeFilmId === 'FS-010' ? RETRO90.defaultAdjustments : {}),
    };
    const newHistory = get().history.slice(0, get().historyIndex + 1);
    const camera = normalizeCamera({ ...get().camera, optics: get().activeFilmId === 'FS-010' ? { glow: 12, halation: 8, softness: 8, quality: 'standard' } : get().camera.optics });
    newHistory.push(snapshotOf(get(),{sharpening:{...DEFAULT_SHARPENING}, colorMixer:defaultColorMixer(), curves: defaultCurves(), camera, adjustments:{...resetValues}}));

    set({
      camera,
      sharpening:{...DEFAULT_SHARPENING},sharpeningMask:false,
      colorMixer:defaultColorMixer(), mixerPointId:null, mixerTool:'none', mixerVisualize:false,
      curves: defaultCurves(),
      adjustments: resetValues,
      history: newHistory,
      historyIndex: newHistory.length - 1,
      canUndo: newHistory.length > 1,
      canRedo: false,
    });
  },

  undo: () => {
    const { historyIndex, history } = get();
    if (historyIndex > 0) {
      const newIndex = historyIndex - 1;
      set({
        historyIndex: newIndex,
        isCameraEffectsOpen: false,sharpeningMask:false, mixerTool:'none', mixerVisualize:false,
        ...history[newIndex],
        ...(history[newIndex].activePresetId ? { lastPresetId: history[newIndex].activePresetId! } : {}),
        adjustments: { ...history[newIndex].adjustments },
        canUndo: newIndex > 0,
        canRedo: true,
      });
    }
  },

  redo: () => {
    const { historyIndex, history } = get();
    if (historyIndex < history.length - 1) {
      const newIndex = historyIndex + 1;
      set({
        historyIndex: newIndex,
        isCameraEffectsOpen: false,sharpeningMask:false, mixerTool:'none', mixerVisualize:false,
        ...history[newIndex],
        ...(history[newIndex].activePresetId ? { lastPresetId: history[newIndex].activePresetId! } : {}),
        adjustments: { ...history[newIndex].adjustments },
        canUndo: true,
        canRedo: newIndex < history.length - 1,
      });
    }
  },

  setCompareMode: (mode) => set({ compareMode: mode }),
  setSplitPos: (pos) => set({ splitPos: Math.min(1.0, Math.max(0.0, pos)) }),
  setZoom: (zoom) => set({ zoom: Math.min(8.0, Math.max(1.0, zoom)) }),
  setPan: (pan) => set({ pan }),
  setZoomAndPan: (zoom, pan) => set({ zoom: Math.min(8.0, Math.max(1.0, zoom)), pan }),
  resetZoomPan: () => set({ zoom: 1.0, pan: { x: 0, y: 0 } }),

  loadRecipes: async () => {
    const recipes = await loadSavedRecipes();
    set({ recipes });
  },

  saveCurrentAsRecipe: async (name: string) => {
    const state = get();
    const writeV9 = shouldWriteRecipeV9(state);
    const optical = state.optical ? normalizeOpticalTransform(state.optical) : null;
    const localAdjustments = normalizeLocalAdjustments(state.localAdjustments);
    const newRecipe: CustomRecipe = {
      id: `rcp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: name.trim() || 'Untitled Recipe',
      baseFilmId: state.activeFilmId,
      ...(state.activePresetId ? { presetId: state.activePresetId, presetVersion: getMargarinePreset(state.activePresetId)?.version } : {}),
      profileVersion: FILM_PROFILES[state.activeFilmId]?.version || '1.0.0',
      adjustments: { ...state.adjustments },
      createdAt: Date.now(),
      updatedAt: Date.now(),
      schemaVersion: writeV9 ? RECIPE_SCHEMA_V9 : RECIPE_SCHEMA_V8,
      geometry: normalizeGeometry(state.geometry),
      ...(writeV9 && optical ? { optical } : {}),
      ...(writeV9 && localAdjustments.groups.length > 0 ? { localAdjustments } : {}),
      sharpening:normalizeSharpening(state.sharpening),
      colorMixer:normalizeColorMixer(state.colorMixer),
      curves: normalizeCurves(state.curves),
      camera: normalizeCamera(state.camera),
    };

    const updated = [newRecipe, ...state.recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
    return newRecipe;
  },

  deleteRecipe: async (id: string) => {
    const updated = get().recipes.filter((r) => r.id !== id);
    set({ recipes: updated });
    await persistRecipes(updated);
  },

  renameRecipe: async (id: string, newName: string) => {
    const updated = get().recipes.map((r) =>
      r.id === id ? { ...r, name: newName.trim(), updatedAt: Date.now() } : r
    );
    set({ recipes: updated });
    await persistRecipes(updated);
  },

  duplicateRecipe: async (id: string) => {
    const target = get().recipes.find((r) => r.id === id);
    if (!target) return;
    const duplicated: CustomRecipe = {
      ...target,
      id: `rcp-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      name: `${target.name} (Copy)`,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const updated = [duplicated, ...get().recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
  },

  applyRecipe: (recipe: CustomRecipe) => {
    const state=get();
    const geometry=normalizeGeometry(recipe.geometry);
    const optical=recipe.optical?normalizeOpticalTransform(recipe.optical):null;
    const localAdjustments=normalizeLocalAdjustments(recipe.localAdjustments);
    const snapshot = snapshotOf(state,{
      sharpening:normalizeSharpening(recipe.sharpening,recipe.adjustments.sharpness),
      colorMixer:normalizeColorMixer(recipe.colorMixer),
      curves:normalizeCurves(recipe.curves),
      camera:normalizeCamera(recipe.camera),
      activeFilmId:recipe.baseFilmId,
      activePresetId:getMargarinePreset(recipe.presetId)?.id||null,
      adjustments:{...recipe.adjustments},
      geometry,
      optical,
      localAdjustments,
    });
    const history = [...state.history.slice(0, state.historyIndex + 1), snapshot].slice(-50);
    set({ sharpening:snapshot.sharpening,sharpeningMask:false,isSharpeningDragging:false,detailZoomReturn:null,colorMixer:snapshot.colorMixer,mixerPointId:null,mixerTool:'none',mixerVisualize:false, curves: snapshot.curves, camera: snapshot.camera, isCameraEffectsOpen: false, ...(recipe.baseFilmId === 'FS-010' ? { hasOldSchoolSettings: true } : {}), history, historyIndex: history.length - 1, canUndo: history.length > 1, canRedo: false,
      activeFilmId: recipe.baseFilmId,
      activePresetId: getMargarinePreset(recipe.presetId)?.id || null,
      ...(recipe.presetId && getMargarinePreset(recipe.presetId) ? { lastPresetId: recipe.presetId } : {}),
      adjustments: { ...recipe.adjustments },
      geometry,
      optical,
      localAdjustments,
    });
  },

  importRecipe: async (jsonStr: string) => {
    const validated = validateRecipeJSON(jsonStr);
    if (get().recipes.some(recipe => recipe.id === validated.id)) {
      validated.id = `rcp-${Date.now()}-${Math.random().toString(36).substring(2, 10)}`;
    }
    const updated = [validated, ...get().recipes];
    set({ recipes: updated });
    await persistRecipes(updated);
    return validated;
  },
}));
