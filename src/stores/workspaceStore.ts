import {clearThumbnails} from '../engine/image/thumbnails';
import {create} from 'zustand';
import {decodeEditorImage,useEditorStore} from './editorStore';
import {WorkspaceEntry} from '../engine/image/workspace';
import {DEFAULT_ADJUSTMENTS} from '../types/film';
import {defaultCurves} from '../types/curves';
import {normalizeCamera} from '../types/camera';
import {defaultColorMixer} from '../types/colorMixer';
import {DEFAULT_SHARPENING} from '../types/sharpening';
import {clampSelection,clickSelection,createSelection,type ClickModifiers,type SelectionState} from '../poc/q04/selection';
let generation=0;let decoding:AbortController|null=null;
/** Defaults for a photo that has no saved session yet (P1: never inherit the previous photo's edit). */
export function freshSession(){return{adjustments:{...DEFAULT_ADJUSTMENTS},activeFilmId:'FS-001' as const,activePresetId:null,curves:defaultCurves(),camera:normalizeCamera(),colorMixer:defaultColorMixer(),sharpening:{...DEFAULT_SHARPENING}};}
type Session=Pick<ReturnType<typeof useEditorStore.getState>,'sharpening'|'history'|'historyIndex'|'canUndo'|'canRedo'|'adjustments'|'camera'|'curves'|'colorMixer'|'activeFilmId'|'activePresetId'|'zoom'|'pan'>;
const sessions=new Map<string,Session>();let historyKeys:string[]=[];
function session():Session{const s=useEditorStore.getState();return{sharpening:s.sharpening,history:s.history,historyIndex:s.historyIndex,canUndo:s.canUndo,canRedo:s.canRedo,adjustments:s.adjustments,camera:s.camera,curves:s.curves,colorMixer:s.colorMixer,activeFilmId:s.activeFilmId,activePresetId:s.activePresetId,zoom:s.zoom,pan:s.pan};}
interface WorkspaceState{entries:WorkspaceEntry[];name:string;activeId:string|null;collapsed:boolean;height:number;scroll:number;sort:'name'|'reverse';loading:boolean;scanning:boolean;error:string;selection:SelectionState;setEntries:(entries:WorkspaceEntry[],name:string)=>void;append:(entries:WorkspaceEntry[])=>void;openPhoto:(id:string)=>Promise<boolean>;select:(id:string)=>Promise<void>;clickThumbnail:(id:string,mods?:ClickModifiers)=>void;toggleSelection:(id:string)=>void;selectAllPhotos:()=>void;clearSelection:()=>void;close:()=>void;}
export const useWorkspaceStore=create<WorkspaceState>((set,get)=>({entries:[],name:'',activeId:null,collapsed:false,height:144,scroll:0,sort:'name',loading:false,scanning:false,error:'',selection:createSelection([]),
 setEntries:(entries,name)=>{generation++;decoding?.abort();sessions.clear();historyKeys=[];clearThumbnails();set({entries,name,activeId:null,collapsed:false,scroll:0,sort:'name',error:'',loading:false,selection:createSelection([])});},
 append:entries=>{const next=[...get().entries,...entries];set({entries:next,selection:clampSelection(get().selection,next.map(entry=>entry.id))});},
 openPhoto:async id=>{const entry=get().entries.find(e=>e.id===id);if(!entry)return false;const request=++generation;decoding?.abort();const controller=new AbortController();decoding=controller;const old=get().activeId;if(old&&useEditorStore.getState().image?.workspaceKey===old){sessions.set(old,session());historyKeys=historyKeys.filter(key=>key!==old);historyKeys.push(old);if(historyKeys.length>50){const key=historyKeys.shift()!,saved=sessions.get(key)!;sessions.set(key,{...saved,history:[saved.history[saved.historyIndex]],historyIndex:0,canUndo:false,canRedo:false});}}set({loading:true,error:''});
  try{const file=await entry.getFile();if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');const loaded=await decodeEditorImage(file,controller.signal);const image=loaded.image;if(request!==generation){URL.revokeObjectURL(image.sourceUrl);return false;}image.workspaceKey=id;const saved=sessions.get(id);set({activeId:id});if(!saved)useEditorStore.setState(freshSession());useEditorStore.getState().setImage(image,loaded.rawSource);if(saved)useEditorStore.setState({...saved,mixerTool:'none',mixerVisualize:false});set({loading:false});return true;}
  catch(error){if(request===generation)set({loading:false,error:`${entry.name}: 사진을 열 수 없습니다. ${String(error)}`});return false;}
 },
 select:async id=>{if(!get().entries.some(e=>e.id===id))return;if(await get().openPhoto(id))set({selection:createSelection([id])});},
 clickThumbnail:(id,mods)=>{const state=get();const next=clickSelection(state.selection,state.entries.map(entry=>entry.id),id,mods);set({selection:next});if(next.active&&next.active!==state.activeId)void get().openPhoto(next.active);},
 toggleSelection:id=>{const state=get();const next=clickSelection(state.selection,state.entries.map(entry=>entry.id),id,{toggle:true});const active=state.selection.active&&next.ids.includes(state.selection.active)?state.selection.active:next.active;set({selection:{...next,active}});},
 selectAllPhotos:()=>{if(!get().entries.length)return;set({selection:createSelection(get().entries.map(entry=>entry.id))});},
 clearSelection:()=>{if(!get().selection.ids.length)return;set({selection:createSelection([])});},
 close:()=>{generation++;decoding?.abort();sessions.clear();historyKeys=[];clearThumbnails();set({entries:[],name:'',activeId:null,loading:false,scanning:false,error:'',selection:createSelection([])});}
}));
useEditorStore.subscribe((state,previous)=>{if(state.image!==previous.image&&!state.image?.workspaceKey)useWorkspaceStore.getState().close();});
