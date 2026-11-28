import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('../src/engine/image/decoder',()=>({decodeImageFile:vi.fn(async(file:File)=>({workspaceKey:file.name,name:file.name,sourceUrl:'blob:'+file.name,originalWidth:64,originalHeight:48}))}));
vi.mock('../src/engine/image/thumbnails',()=>({clearThumbnails:vi.fn(),requestThumbnail:vi.fn()}));
import {entriesFromFiles,isWorkspaceMedia,isWorkspacePhoto,isWorkspaceVideo} from '../src/engine/image/workspace';
import {useWorkspaceStore as ws} from '../src/stores/workspaceStore';
import {classifySupport,memoryGuard,resolutionPixels} from '../src/components/video/capabilities';
import {clampTrim,formatTime,frameStep,loopTime,trimFraction} from '../src/components/video/timeline';
import {clearClipboard,copySelection,pasteToSelection} from '../src/poc/q04/integration/parameterPaste';

const photo=(id:string)=>({id,name:id,path:id,kind:'photo' as const,getFile:async()=>new File(['x'],id,{type:'image/png'})});
const video=(id:string)=>({id,name:id,path:id,kind:'video' as const,video:{durationSec:null,width:null,height:null},getFile:async()=>new File(['v'],id,{type:'video/mp4'})});

describe('video media filter',()=>{
  it('accepts the advertised video containers case-insensitively without widening the photo filter',()=>{
    for(const name of ['clip.mp4','clip.MOV','clip.webm','clip.m4v','CLIP.MP4']) expect(isWorkspaceVideo(name)).toBe(true);
    for(const name of ['clip.mkv','clip.avi','clip.mp4.txt','notes.txt','']) expect(isWorkspaceVideo(name)).toBe(false);
    expect(isWorkspaceMedia('a.jpg')).toBe(true);
    expect(isWorkspaceMedia('clip.mp4')).toBe(true);
    expect(isWorkspaceMedia('notes.txt')).toBe(false);
    expect(isWorkspacePhoto('clip.mp4')).toBe(false);
  });

  it('marks ingested videos as kind video with a metadata placeholder and no eager decode',()=>{
    const file=new File(['v'],'clip.mp4');
    Object.defineProperty(file,'webkitRelativePath',{value:'root/clip.mp4'});
    const [entry]=entriesFromFiles([file]);
    expect(entry).toMatchObject({name:'clip.mp4',kind:'video',video:{durationSec:null,width:null,height:null}});
  });
});

describe('video timeline math',()=>{
  it('formats time with centisecond precision and guards invalid values',()=>{
    expect(formatTime(0)).toBe('0:00.00');
    expect(formatTime(65.5)).toBe('1:05.50');
    expect(formatTime(Number.NaN)).toBe('0:00.00');
    expect(formatTime(-3)).toBe('0:00.00');
  });

  it('steps exactly one frame and clamps at the clip bounds',()=>{
    expect(frameStep(1,30,1,10)).toBeCloseTo(1+1/30,6);
    expect(frameStep(0,30,-1,10)).toBe(0);
    expect(frameStep(10,30,1,10)).toBe(10);
    expect(frameStep(1,0,1,10)).toBe(2);
  });

  it('keeps at least one frame between trim in and out',()=>{
    expect(clampTrim(0,0,10,30)).toEqual({startSec:0,endSec:1/30});
    const edge=clampTrim(10,10,10,30);
    expect(edge.endSec).toBe(10);
    expect(edge.startSec).toBeCloseTo(10-1/30,6);
    expect(clampTrim(2,5,10,30)).toEqual({startSec:2,endSec:5});
    expect(clampTrim(Number.NaN,Number.NaN,0,30)).toEqual({startSec:0,endSec:0});
  });

  it('loops playback inside the trim window',()=>{
    const range={startSec:1,endSec:3};
    expect(loopTime(0.5,range)).toBe(1);
    expect(loopTime(2,range)).toBe(2);
    expect(loopTime(3.5,range)).toBeCloseTo(1.5,6);
    expect(loopTime(5,range)).toBeCloseTo(1,6);
  });

  it('maps trim seconds to a 0..1 fraction safely',()=>{
    expect(trimFraction(5,10)).toBe(0.5);
    expect(trimFraction(20,10)).toBe(1);
    expect(trimFraction(-1,10)).toBe(0);
    expect(trimFraction(1,0)).toBe(0);
    expect(trimFraction(1,Number.NaN)).toBe(0);
  });
});

describe('video capability classification',()=>{
  const probe={decodeAvc:true,decodeVp9:false,encodeAvc:true,encodeVp9:false,playMp4:true,playWebm:false,audioPassthrough:true};

  it('requires both encode support and container playability for a codec badge',()=>{
    expect(classifySupport(probe)).toEqual({canDecode:true,encoders:{avc:true,vp9:false},containers:{mp4:true,webm:false},audioPassthrough:true});
    const encodeOnly=classifySupport({...probe,playMp4:false});
    expect(encodeOnly.encoders.avc).toBe(false);
    expect(encodeOnly.containers.mp4).toBe(false);
    expect(classifySupport({...probe,decodeAvc:false}).canDecode).toBe(false);
  });

  it('passes normal frames and rejects frames that exceed the memory budget',()=>{
    expect(memoryGuard(3840,2160,4096).ok).toBe(true);
    const huge=memoryGuard(8192,8192,1024);
    expect(huge.ok).toBe(false);
    expect(huge.bytes).toBe(8192*8192*16);
    expect(huge.budgetBytes).toBeGreaterThanOrEqual(512*1024*1024);
  });

  it('scales tall sources down and never upscales',()=>{
    expect(resolutionPixels('source',3840,2160)).toEqual({width:3840,height:2160});
    expect(resolutionPixels('1080p',3840,2160)).toEqual({width:1920,height:1080});
    expect(resolutionPixels('720p',1280,720)).toEqual({width:1280,height:720});
    expect(resolutionPixels('720p',640,360)).toEqual({width:640,height:360});
  });
});

describe('workspace video mode',()=>{
  beforeEach(()=>{ws.getState().close();clearClipboard();});

  it('opens videos without touching the open photo or its saved session',async()=>{
    ws.getState().setEntries([photo('p1'),video('v1')],'Folder');
    await ws.getState().select('p1');
    const before=ws.getState().savedEditState('p1');
    expect(ws.getState().activeId).toBe('p1');
    expect(ws.getState().openVideo('p1')).toBe(false);
    expect(ws.getState().openVideo('missing')).toBe(false);
    expect(ws.getState().openVideo('v1')).toBe(true);
    expect(ws.getState().activeVideoId).toBe('v1');
    expect(ws.getState().activeId).toBe('p1');
    expect(ws.getState().savedEditState('p1')).toEqual(before);
    ws.getState().openVideo('v1');
    ws.getState().closeVideo();
    expect(ws.getState().activeVideoId).toBeNull();
    ws.getState().clickThumbnail('p1');
    await vi.waitFor(()=>expect(ws.getState().activeVideoId).toBeNull());
    expect(ws.getState().activeId).toBe('p1');
    expect(ws.getState().savedEditState('p1')).toEqual(before);
  });

  it('stores video metadata on the video entry only',()=>{
    ws.getState().setEntries([photo('p1'),video('v1')],'Folder');
    ws.getState().setVideoMeta('v1',{durationSec:2.5,width:640,height:360});
    const entries=ws.getState().entries;
    expect(entries.find(entry=>entry.id==='v1')?.video).toEqual({durationSec:2.5,width:640,height:360});
    expect(entries.find(entry=>entry.id==='p1')?.video).toBeUndefined();
  });

  it('selects videos in video mode while plain photo clicks return to the editor',async()=>{
    ws.getState().setEntries([photo('p1'),video('v1')],'Folder');
    await ws.getState().select('p1');
    ws.getState().clickThumbnail('v1');
    expect(ws.getState().selection).toMatchObject({ids:['v1'],active:'v1'});
    expect(ws.getState().activeVideoId).toBe('v1');
    expect(ws.getState().activeId).toBe('p1');
    ws.getState().clickThumbnail('p1');
    await vi.waitFor(()=>expect(ws.getState().activeVideoId).toBeNull());
    expect(ws.getState().selection).toMatchObject({ids:['p1'],active:'p1'});
  });

  it('keeps select-all and paste photo-only',async()=>{
    ws.getState().setEntries([photo('p1'),photo('p2'),video('v1')],'Folder');
    ws.getState().selectAllPhotos();
    expect(ws.getState().selection.ids).toEqual(['p1','p2']);
    const report=pasteToSelection({sourceId:'recommend',groups:['film'],film:{activeFilmId:'FS-002',activePresetId:null}});
    expect(report).toEqual({pasted:2,active:null});
    expect(ws.getState().savedEditState('p1')?.activeFilmId).toBe('FS-002');
    expect(ws.getState().savedEditState('p2')?.activeFilmId).toBe('FS-002');
    expect(ws.getState().savedEditState('v1')).toBeNull();
    ws.getState().updateSession('v1',{activeFilmId:'FS-003'} as never);
    expect(ws.getState().savedEditState('v1')).toBeNull();
  });

  it('never copies parameters from a video-only selection',()=>{
    ws.getState().setEntries([video('v1')],'Folder');
    ws.getState().select('v1');
    expect(ws.getState().activeId).toBeNull();
    expect(copySelection(['film','tone'])).toBeNull();
  });
});
