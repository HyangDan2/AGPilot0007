import {describe,it,expect,beforeEach,vi} from 'vitest';
import {normalizeSharpening,DEFAULT_SHARPENING,validateSharpening,sharpeningPreviewSize} from '../src/types/sharpening';
import {validateRecipeJSON} from '../src/stores/recipeStore';
import {useEditorStore as store} from '../src/stores/editorStore';
import {entriesFromFiles,scanDirectory,virtualRange} from '../src/engine/image/workspace';
describe('Sharpening compatibility and history',()=>{
 beforeEach(()=>store.getState().resetAdjustments());
 it('keeps v1–6 nonzero legacy sharpening and defaults zero to neutral',()=>{for(const schemaVersion of [1,2,3,4,5,6]){const r=validateRecipeJSON(JSON.stringify({name:'Old',baseFilmId:'FS-001',schemaVersion,adjustments:{sharpness:35}}));expect(r.sharpening).toEqual({...DEFAULT_SHARPENING,amount:35,mode:'legacy'});expect(validateRecipeJSON(JSON.stringify({name:'Old',baseFilmId:'FS-001',schemaVersion})).sharpening).toEqual(DEFAULT_SHARPENING);}});
 it('clamps normalization, rejects malformed settings, groups one drag and roundtrips v7',async()=>{expect(normalizeSharpening({radius:0,amount:999,masking:NaN})).toEqual({...DEFAULT_SHARPENING,radius:.5,amount:150});for(const value of [null,[],{radius:4},{amount:Infinity},{mode:'other'}])expect(()=>validateSharpening(value)).toThrow();const start=store.getState().history.length;store.getState().setSharpening({...DEFAULT_SHARPENING,amount:20},false);store.getState().setSharpening({...DEFAULT_SHARPENING,amount:80,radius:1.8},false);store.getState().setSharpening(store.getState().sharpening);expect(store.getState().history.length).toBe(start+1);store.getState().undo();expect(store.getState().sharpening).toEqual(DEFAULT_SHARPENING);store.getState().redo();const saved=await store.getState().saveCurrentAsRecipe('Detail');expect(saved.schemaVersion).toBe(7);expect(validateRecipeJSON(JSON.stringify(saved)).sharpening).toEqual(store.getState().sharpening);expect((saved as any).sharpeningMask).toBeUndefined();store.getState().setSharpeningMask(true);store.getState().toggleToneCurve();expect(store.getState().sharpeningMask).toBe(false);});
});
describe('Workspace indexing and virtualization',()=>{
 it('bounds mounted rows for 100/1000/10000 entries including far scroll and empty folders',()=>{for(const count of [100,1000,10000])for(const scroll of [0,116*50,116*(count-10)]){const range=virtualRange(count,scroll,1440);expect(range.end-range.start).toBeLessThanOrEqual(20);expect(range.start).toBeGreaterThanOrEqual(0);expect(range.end).toBeLessThanOrEqual(count);}expect(virtualRange(0,0,1440)).toEqual({start:0,end:0});});
 it('filters supported files, distinguishes recursion, and never reads bytes while indexing',async()=>{const file=(name:string,path:string)=>{const f=new File(['test'],name);Object.defineProperty(f,'webkitRelativePath',{value:path});return f;};const files=[file('a.jpg','root/a.jpg'),file('b.png','root/sub/b.png'),file('c.dng','root/c.dng'),file('d.txt','root/d.txt')];expect(entriesFromFiles(files).map(e=>e.name)).toEqual(['a.jpg']);expect(entriesFromFiles(files,true).map(e=>e.name)).toEqual(['a.jpg','b.png']);const read=vi.fn();const leaf={kind:'file',name:'x.webp',getFile:read};const folder={async*values(){yield leaf;yield{kind:'directory',name:'sub',async*values(){yield{...leaf,name:'y.jpg'};}};}};const entries:any[]=[];await scanDirectory(folder,true,b=>entries.push(...b),new AbortController().signal);expect(entries.map(e=>e.path).sort()).toEqual(['sub/y.jpg','x.webp']);expect(read).not.toHaveBeenCalled();const c=new AbortController();c.abort();const cancelled=vi.fn();await scanDirectory(folder,true,cancelled,c.signal);expect(cancelled).not.toHaveBeenCalled();});
});

it('bounds draft resolution for mobile and desktop, keeps aspect and restores final resolution',()=>{
 expect(sharpeningPreviewSize(2048,1536,350,262.5,1,true)).toEqual({width:384,height:288});
 expect(sharpeningPreviewSize(2048,1536,900,675,1,true)).toEqual({width:768,height:576});
 expect(sharpeningPreviewSize(2048,1536,350,262.5,1,false)).toEqual({width:2048,height:1536});
 expect(sharpeningPreviewSize(64,48,800,600,1,true)).toEqual({width:64,height:48});
});
