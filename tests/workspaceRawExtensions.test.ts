import {describe,it,expect,vi} from 'vitest';
import {isWorkspacePhoto,entriesFromFiles,scanDirectory} from '../src/engine/image/workspace';

const receipt=(name:string,path:string)=>{
  const file=new File(['test'],name);
  Object.defineProperty(file,'webkitRelativePath',{value:path});
  return file;
};

describe('Workspace RAW extensions',()=>{
  it('accepts every advertised RAW extension case-insensitively and keeps existing formats',()=>{
    for(const ext of ['cr2','cr3','nef','arw','raf','orf','dng','rw2','pef','srw','x3f']) {
      expect(isWorkspacePhoto(`IMG_0001.${ext}`)).toBe(true);
      expect(isWorkspacePhoto(`IMG_0001.${ext.toUpperCase()}`)).toBe(true);
    }
    for(const name of ['a.jpg','a.jpeg','a.JPG','a.png','a.webp','R0000357.DNG','IMG_4243.CR3']) {
      expect(isWorkspacePhoto(name)).toBe(true);
    }
  });

  it('rejects non-image and lookalike names',()=>{
    for(const name of ['notes.txt','clip.mp4','photo.dng.txt','rawcr3','tiff.tif','archive.dng.zip','']) {
      expect(isWorkspacePhoto(name)).toBe(false);
    }
  });

  it('entriesFromFiles includes RAW and video at depth 2 and keeps folder-depth rules',()=>{
    const files=[
      receipt('a.jpg','root/a.jpg'),
      receipt('IMG_4243.CR3','root/IMG_4243.CR3'),
      receipt('R0000357.DNG','root/R0000357.DNG'),
      receipt('deep.nef','root/sub/deep.nef'),
      receipt('notes.txt','root/notes.txt'),
      receipt('clip.mp4','root/clip.mp4'),
    ];
    const flat=entriesFromFiles(files);
    expect(flat.map(e=>e.name)).toEqual(['a.jpg','clip.mp4','IMG_4243.CR3','R0000357.DNG']);
    expect(flat.find(e=>e.name==='clip.mp4')).toMatchObject({kind:'video',video:{durationSec:null,width:null,height:null}});
    expect(flat.find(e=>e.name==='a.jpg')).toMatchObject({kind:'photo'});
    expect(entriesFromFiles(files,true).map(e=>e.name)).toEqual(['a.jpg','clip.mp4','IMG_4243.CR3','R0000357.DNG','deep.nef']);
  });

  it('scanDirectory indexes RAW and video files without reading bytes',async()=>{
    const read=vi.fn();
    const leaf=(name:string)=>({kind:'file',name,getFile:read});
    const folder={
      async*values(){
        yield leaf('R0000357.DNG');
        yield leaf('IMG_4243.CR3');
        yield leaf('notes.txt');
        yield leaf('clip.mp4');
        yield {kind:'directory',name:'sub',async*values(){yield leaf('deep.arw');}};
      },
    };
    const flat:any[]=[];
    await scanDirectory(folder,false,b=>flat.push(...b),new AbortController().signal);
    expect(flat.map(e=>e.path).sort()).toEqual(['IMG_4243.CR3','R0000357.DNG','clip.mp4']);
    expect(flat.find(e=>e.path==='clip.mp4')?.kind).toBe('video');
    const nested:any[]=[];
    await scanDirectory(folder,true,b=>nested.push(...b),new AbortController().signal);
    expect(nested.map(e=>e.path).sort()).toEqual(['IMG_4243.CR3','R0000357.DNG','clip.mp4','sub/deep.arw']);
    expect(read).not.toHaveBeenCalled();
  });
});
