import {beforeEach,expect,it,vi} from 'vitest';
const {rawSentinel}=vi.hoisted(()=>({rawSentinel:{kind:'raw-source'}}));
vi.mock('../src/stores/editorStore',async(importOriginal)=>{
 const actual=await importOriginal<typeof import('../src/stores/editorStore')>();
 return{...actual,decodeEditorImage:vi.fn(async(file:File)=>({image:{workspaceKey:file.name,name:file.name,sourceUrl:'blob:'+file.name,originalWidth:64,originalHeight:48},rawSource:/\.(dng|cr3|arw|nef)$/i.test(file.name)?rawSentinel:null}))};
});
vi.mock('../src/engine/image/thumbnails',()=>({clearThumbnails:vi.fn(),requestThumbnail:vi.fn()}));
import {useWorkspaceStore as ws} from '../src/stores/workspaceStore';
import {useEditorStore as editor} from '../src/stores/editorStore';
const entry=(name:string)=>({id:name,name,path:name,getFile:async()=>new File(['test'],name)});
beforeEach(()=>{ws.getState().close();editor.setState({image:null,rawSource:null});});
it('keeps the RAW source on the editor state when a workspace RAW entry opens',async()=>{
 ws.getState().setEntries([entry('photo.CR3')],'Folder');
 await ws.getState().select('photo.CR3');
 expect(editor.getState().image?.workspaceKey).toBe('photo.CR3');
 expect(editor.getState().rawSource).toBe(rawSentinel);
});
it('leaves rawSource null for non-RAW entries and clears it when switching away from RAW',async()=>{
 ws.getState().setEntries([entry('raw.DNG'),entry('plain.png')],'Folder');
 await ws.getState().select('raw.DNG');
 expect(editor.getState().rawSource).toBe(rawSentinel);
 await ws.getState().select('plain.png');
 expect(editor.getState().image?.workspaceKey).toBe('plain.png');
 expect(editor.getState().rawSource).toBeNull();
});
