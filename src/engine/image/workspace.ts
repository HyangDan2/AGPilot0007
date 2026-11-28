export type WorkspaceMediaKind = 'photo' | 'video';
/**
 * Placeholder filled by the native <video> once metadata loads. Ingestion never
 * decodes or probes a video, so nothing here is available up front.
 */
export interface WorkspaceVideoMeta { durationSec: number | null; width: number | null; height: number | null }
export interface WorkspaceEntry { id:string; name:string; path:string; kind?:WorkspaceMediaKind; video?:WorkspaceVideoMeta; getFile:()=>Promise<File> }
/** Static regex only: this module is in the eager bundle and must never reach engine/raw (flashraw/wasm). */
export const isWorkspacePhoto=(name:string)=>/\.(jpe?g|png|webp|cr2|cr3|nef|arw|raf|orf|dng|rw2|pef|srw|x3f)$/i.test(name);
/** Video containers the CP4 workspace lists; playback support is probed later in the UI. */
export const isWorkspaceVideo=(name:string)=>/\.(mp4|mov|webm|m4v)$/i.test(name);
export const isWorkspaceMedia=(name:string)=>isWorkspacePhoto(name)||isWorkspaceVideo(name);
const videoPlaceholder=():WorkspaceVideoMeta=>({durationSec:null,width:null,height:null});
function mediaEntry(id:string,name:string,path:string,getFile:()=>Promise<File>):WorkspaceEntry{
 return isWorkspaceVideo(name)?{id,name,path,kind:'video',video:videoPlaceholder(),getFile}:{id,name,path,kind:'photo',getFile};
}
export function entriesFromFiles(files:File[],includeSubfolders=false):WorkspaceEntry[]{
 return [...files].sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name,undefined,{numeric:true})).filter(f=>isWorkspaceMedia(f.name)&&(includeSubfolders||!f.webkitRelativePath||f.webkitRelativePath.split('/').length<=2)).map((f,i)=>mediaEntry(f.webkitRelativePath||`${i}/${f.name}`,f.name,f.webkitRelativePath||f.name,async()=>f));
}
export async function scanDirectory(handle:any,recursive:boolean,onBatch:(batch:WorkspaceEntry[])=>void,signal:AbortSignal,prefix=''):Promise<void>{
 let batch:WorkspaceEntry[]=[];
 for await(const child of handle.values()){
  if(signal.aborted)return;
  const path=prefix+child.name;
  if(child.kind==='file'&&isWorkspaceMedia(child.name))batch.push(mediaEntry(path,child.name,path,()=>child.getFile()));
  else if(child.kind==='directory'&&recursive)await scanDirectory(child,true,onBatch,signal,path+'/');
  if(batch.length>=200){onBatch(batch);batch=[];await new Promise(r=>setTimeout(r,0));}
 }
 if(batch.length&&!signal.aborted)onBatch(batch);
}
export function virtualRange(count:number,scroll:number,width:number,itemWidth=116,overscan=3){const start=Math.max(0,Math.floor(scroll/itemWidth)-overscan),end=Math.min(count,Math.ceil((scroll+width)/itemWidth)+overscan);return{start,end};}
