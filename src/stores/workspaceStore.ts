import {clearThumbnails} from '../engine/image/thumbnails';
import {create} from 'zustand';
import {useEditorStore} from './editorStore';
import {decodeImageFile} from '../engine/image/decoder';
import {WorkspaceEntry} from '../engine/image/workspace';
let generation=0;let decoding:AbortController|null=null;
type Session=Pick<ReturnType<typeof useEditorStore.getState>,'sharpening'|'history'|'historyIndex'|'canUndo'|'canRedo'|'adjustments'|'camera'|'curves'|'colorMixer'|'activeFilmId'|'activePresetId'|'zoom'|'pan'>;
const sessions=new Map<string,Session>();let historyKeys:string[]=[];
function session():Session{const s=useEditorStore.getState();return{sharpening:s.sharpening,history:s.history,historyIndex:s.historyIndex,canUndo:s.canUndo,canRedo:s.canRedo,adjustments:s.adjustments,camera:s.camera,curves:s.curves,colorMixer:s.colorMixer,activeFilmId:s.activeFilmId,activePresetId:s.activePresetId,zoom:s.zoom,pan:s.pan};}
interface WorkspaceState{entries:WorkspaceEntry[];name:string;activeId:string|null;collapsed:boolean;height:number;scroll:number;sort:'name'|'reverse';loading:boolean;scanning:boolean;error:string;setEntries:(entries:WorkspaceEntry[],name:string)=>void;append:(entries:WorkspaceEntry[])=>void;select:(id:string)=>Promise<void>;close:()=>void;}
export const useWorkspaceStore=create<WorkspaceState>((set,get)=>({entries:[],name:'',activeId:null,collapsed:false,height:144,scroll:0,sort:'name',loading:false,scanning:false,error:'',
 setEntries:(entries,name)=>{generation++;decoding?.abort();sessions.clear();historyKeys=[];clearThumbnails();set({entries,name,activeId:null,collapsed:false,scroll:0,sort:'name',error:'',loading:false});},
 append:entries=>set({entries:[...get().entries,...entries]}),
 select:async id=>{const entry=get().entries.find(e=>e.id===id);if(!entry)return;const request=++generation;decoding?.abort();const controller=new AbortController();decoding=controller;const old=get().activeId;if(old&&useEditorStore.getState().image?.workspaceKey===old){sessions.set(old,session());historyKeys=historyKeys.filter(key=>key!==old);historyKeys.push(old);if(historyKeys.length>50){const key=historyKeys.shift()!,saved=sessions.get(key)!;sessions.set(key,{...saved,history:[saved.history[saved.historyIndex]],historyIndex:0,canUndo:false,canRedo:false});}}set({loading:true,error:''});
  try{const file=await entry.getFile();if(controller.signal.aborted)throw new DOMException('Cancelled','AbortError');const image=await decodeImageFile(file,undefined,controller.signal);if(request!==generation){URL.revokeObjectURL(image.sourceUrl);return;}image.workspaceKey=id;const saved=sessions.get(id);set({activeId:id});useEditorStore.getState().setImage(image);if(saved)useEditorStore.setState({...saved,mixerTool:'none',mixerVisualize:false});set({loading:false});}
  catch(error){if(request===generation)set({loading:false,error:`${entry.name}: 사진을 열 수 없습니다. ${String(error)}`});}
 },
 close:()=>{generation++;decoding?.abort();sessions.clear();historyKeys=[];clearThumbnails();set({entries:[],name:'',activeId:null,loading:false,scanning:false,error:''});}
}));
useEditorStore.subscribe((state,previous)=>{if(state.image!==previous.image&&!state.image?.workspaceKey)useWorkspaceStore.getState().close();});
