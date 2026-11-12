export interface WorkspaceEntry { id:string; name:string; path:string; getFile:()=>Promise<File> }
export const isWorkspacePhoto=(name:string)=>/\.(jpe?g|png|webp)$/i.test(name);
export function entriesFromFiles(files:File[],includeSubfolders=false):WorkspaceEntry[]{
 return [...files].sort((a,b)=>(a.webkitRelativePath||a.name).localeCompare(b.webkitRelativePath||b.name,undefined,{numeric:true})).filter(f=>isWorkspacePhoto(f.name)&&(includeSubfolders||!f.webkitRelativePath||f.webkitRelativePath.split('/').length<=2)).map((f,i)=>({id:f.webkitRelativePath||`${i}/${f.name}`,name:f.name,path:f.webkitRelativePath||f.name,getFile:async()=>f}));
}
export async function scanDirectory(handle:any,recursive:boolean,onBatch:(batch:WorkspaceEntry[])=>void,signal:AbortSignal,prefix=''):Promise<void>{
 let batch:WorkspaceEntry[]=[];
 for await(const child of handle.values()){
  if(signal.aborted)return;
  const path=prefix+child.name;
  if(child.kind==='file'&&isWorkspacePhoto(child.name))batch.push({id:path,name:child.name,path,getFile:()=>child.getFile()});
  else if(child.kind==='directory'&&recursive)await scanDirectory(child,true,onBatch,signal,path+'/');
  if(batch.length>=200){onBatch(batch);batch=[];await new Promise(r=>setTimeout(r,0));}
 }
 if(batch.length&&!signal.aborted)onBatch(batch);
}
export function virtualRange(count:number,scroll:number,width:number,itemWidth=116,overscan=3){const start=Math.max(0,Math.floor(scroll/itemWidth)-overscan),end=Math.min(count,Math.ceil((scroll+width)/itemWidth)+overscan);return{start,end};}
