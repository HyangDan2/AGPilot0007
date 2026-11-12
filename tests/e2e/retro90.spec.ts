import { test, expect, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { withExifDate } from '../helpers/exifFixture';

async function openCamera(page:Page,isMobile:boolean) {
  if(isMobile) {
    const sheetToggle=page.getByRole('button',{name:/Adjustments \(/});
    if(await sheetToggle.getAttribute('aria-expanded') !== 'true') await sheetToggle.click();
  }
  const toggle=page.getByRole('button',{name:'Camera Effects',exact:true}).filter({visible:true});
  if(await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  return page.getByTestId('camera-effects').filter({visible:true});
}
test('shared camera button retains dates and profile-specific optics on return',async({page,isMobile},testInfo)=>{
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.getByRole('button',{name:/Portrait/}).filter({visible:true}).first().click();
 await expect(page.getByTestId('camera-effects-toggle').filter({visible:true})).toHaveCount(1);
 await expect(page.getByTestId('camera-effects')).toHaveCount(0);
 const card=page.getByTestId('filter-set-card').filter({visible:true});await card.click();
 const modal=page.getByRole('dialog',{name:'Filter Set',exact:true});await expect(modal).toBeVisible();
 await modal.getByRole('button',{name:/01 Old School Film/}).click();await expect(modal).not.toBeVisible();await expect(card).toHaveAttribute('aria-pressed','true');
 let camera=await openCamera(page,isMobile);
 await expect(page.getByTestId('slider-exposure').filter({visible:true})).toHaveValue('-0.35');
 await expect(camera.getByRole('checkbox',{name:'Date Imprint'})).toBeDisabled();
 await expect(camera.getByRole('button',{name:'Use EXIF Date'})).toBeDisabled();
 await camera.getByLabel('Imprint Date',{exact:true}).fill('2016-03-08');await camera.getByRole('checkbox',{name:'Date Imprint'}).check();
 await camera.getByLabel('Date Format',{exact:true}).selectOption('full');await camera.getByLabel('Date Position',{exact:true}).selectOption('bottom-left');
 await camera.getByLabel('Date Glow',{exact:true}).fill('65');await camera.getByLabel('Date Size',{exact:true}).fill('4');
 await camera.getByLabel('Optical Quality',{exact:true}).selectOption('high');
 await page.screenshot({path:testInfo.outputPath('camera-effects.png')});
 if(isMobile)await page.getByRole('button',{name:'Close adjustments',exact:true}).click();
 await page.locator('button').filter({hasText:'RIMVA'}).filter({visible:true}).first().click();
 await expect(page.getByTestId('camera-effects-toggle').filter({visible:true})).toHaveCount(1);
 await expect(page.getByTestId('camera-effects')).toHaveCount(0);
 await page.getByTestId('margarine-card').filter({visible:true}).click();
 await expect(page.getByTestId('camera-effects-toggle').filter({visible:true})).toHaveCount(1);
 await expect(page.getByTestId('camera-effects')).toHaveCount(0);
 await card.click();await modal.getByRole('button',{name:/Old School Film/}).click();
 camera=await openCamera(page,isMobile);
 await expect(camera.getByLabel('Date Glow',{exact:true})).toHaveValue('65');
 await expect(camera.getByLabel('Date Size',{exact:true})).toHaveValue('4');
 await expect(camera.getByRole('checkbox',{name:'Date Imprint'})).toBeChecked();await expect(camera.getByLabel('Imprint Date',{exact:true})).toHaveValue('2016-03-08');
 await camera.getByRole('button',{name:'Reset Camera Effects',exact:true}).click();await expect(camera.getByRole('checkbox',{name:'Date Imprint'})).not.toBeChecked();
 expect(errors).toEqual([]);
});

test('EXIF capture date is read locally and never silently replaced when absent',async({page,isMobile})=>{
 await page.goto('/');
 const jpeg=readFileSync('public/samples/film_test_portrait.jpg');
 await page.locator('input[type=file]').first().setInputFiles({name:'exif.jpg',mimeType:'image/jpeg',buffer:withExifDate(jpeg)});
 await page.getByTestId('filter-set-card').filter({visible:true}).click();await page.getByRole('dialog',{name:'Filter Set',exact:true}).getByRole('button',{name:/Old School Film/}).click();
 let camera=await openCamera(page,isMobile);
 await expect(camera.getByText(/^EXIF: 2016-03-08/)).toBeVisible();await camera.getByRole('button',{name:'Use EXIF Date'}).click();await camera.getByRole('checkbox',{name:'Date Imprint'}).check();
 await expect(camera.getByLabel('Imprint Date',{exact:true})).toHaveValue('2016-03-08');
 if(isMobile)await page.getByRole('button',{name:'Close adjustments',exact:true}).click();
 await page.locator('input[type=file]').first().setInputFiles('public/samples/landscape_test.png');
 await expect(page.getByText('landscape_test.png',{exact:true}).filter({visible:true}).first()).toBeVisible();
 camera=await openCamera(page,isMobile);
 await expect(camera.getByRole('button',{name:'Use EXIF Date'})).toBeDisabled();await expect(camera.getByLabel('Imprint Date',{exact:true})).toHaveValue('');await expect(camera.getByRole('checkbox',{name:'Date Imprint'})).not.toBeChecked();
});

test('shared renderer exports PNG and JPEG with date, proportional geometry, and context recovery',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {WebGL2FilmRenderer}=await import('../../src/engine/renderer/webglRenderer');
  const {loadCubeLut}=await import('../../src/engine/color/lutLoader');
  const {decodeImageFile}=await import('../../src/engine/image/decoder');
  const {prepareExportImage}=await import('../../src/engine/export/imageExporter');
  const {DEFAULT_ADJUSTMENTS}=await import('../../src/types/film');
  const {normalizeCamera}=await import('../../src/types/camera');
  const canvas=document.createElement('canvas');canvas.width=640;canvas.height=480;
  const source=document.createElement('canvas');source.width=640;source.height=480;const ctx=source.getContext('2d')!;ctx.fillStyle='#11151a';ctx.fillRect(0,0,640,480);
  const blob=await new Promise<Blob>(r=>source.toBlob(b=>r(b!),'image/png'));
  const image=await decodeImageFile(blob,'synthetic.png'),lut=await loadCubeLut('luts/FS-010_RETRO90.cube');
  const camera=normalizeCamera();camera.dateStamp={...camera.dateStamp,enabled:true,date:'2016-03-08',size:5};
  let recovered=false;
  const renderer=new WebGL2FilmRenderer(canvas,()=>{renderer.setImage(source);renderer.setLut(lut);renderer.render({filmId:'FS-010',adjustments:DEFAULT_ADJUSTMENTS,camera,compareMode:'none',splitPos:.5});recovered=true;});
  renderer.setImage(source);renderer.setLut(lut);
  const opts={filmId:'FS-010' as const,adjustments:DEFAULT_ADJUSTMENTS,compareMode:'none' as const,splitPos:.5};
  renderer.render(opts);const off=renderer.readPixels(0,0,640,480)!;
  renderer.render({...opts,camera});const on=renderer.readPixels(0,0,640,480)!;
  let changes=0,outside=0;for(let y=0;y<480;y++)for(let x=0;x<640;x++){const i=(y*640+x)*4;if(on[i]!==off[i]||on[i+1]!==off[i+1]||on[i+2]!==off[i+2]){changes++;if(x<320||y>100)outside++;}}
  renderer.render({...opts,camera,compareMode:'original'});const original=renderer.readPixels(0,0,640,480)!;
  renderer.render({...opts,compareMode:'original'});const originalOff=renderer.readPixels(0,0,640,480)!;
  const originalEqual=original.every((v,i)=>v===originalOff[i]);
  renderer.render({...opts,camera,compareMode:'split',splitPos:.95});const split=renderer.readPixels(0,0,640,480)!;
  // The date lies entirely in the original side at this split, so no date is composited there.
  const dateInOriginal=Array.from({length:600*80},(_,n)=>{const x=n%600,y=Math.floor(n/600),i=(y*640+x)*4;return split[i]!==originalOff[i]||split[i+1]!==originalOff[i+1]||split[i+2]!==originalOff[i+2];}).some(Boolean);
  const formats=[];
  for(const format of ['image/png','image/jpeg'] as const){
    const prepared=await prepareExportImage(image,lut,DEFAULT_ADJUSTMENTS,{format,quality:1,scale:1},undefined,camera,'FS-010');
    const img=await createImageBitmap(prepared.blob);const c=document.createElement('canvas');c.width=640;c.height=480;const cctx=c.getContext('2d')!;cctx.drawImage(img,0,0);const data=cctx.getImageData(0,0,640,480).data;let maxDiff=0,orange=0;
    for(let y=0;y<480;y++)for(let x=0;x<640;x++){const j=(y*640+x)*4,i=((479-y)*640+x)*4;for(let k=0;k<3;k++)maxDiff=Math.max(maxDiff,Math.abs(data[j+k]-on[i+k]));if(x>320&&y>380&&data[j]>data[j+2]+30)orange++;}
    formats.push({format,maxDiff,orange,size:prepared.blob.size,width:prepared.width,height:prepared.height});img.close();URL.revokeObjectURL(prepared.objectUrl);
  }
  const {FILM_LIST}=await import('../../src/films/registry');
  const unsupportedEqual=[];
  for(const profile of FILM_LIST){
    const profileLut=await loadCubeLut(profile.lutFile);renderer.setLut(profileLut);
    renderer.render({...opts,filmId:profile.id});const baseline=renderer.readPixels(0,0,640,480)!;
    renderer.render({...opts,filmId:profile.id,camera:{...camera,dateStamp:{...camera.dateStamp,enabled:false},optics:{glow:100,halation:100,softness:100,quality:'high'}}});const masked=renderer.readPixels(0,0,640,480)!;
    unsupportedEqual.push(baseline.every((v,i)=>v===masked[i]));
  }
  const unsupportedLut=await loadCubeLut('luts/FS-009_RIMVA.cube');
  const unsupportedExports:number[][]=[];
  for(const settings of [undefined,{...camera,dateStamp:{...camera.dateStamp,enabled:false}}]){
    const prepared=await prepareExportImage(image,unsupportedLut,DEFAULT_ADJUSTMENTS,{format:'image/png',quality:1,scale:1},undefined,settings,'FS-009');
    const data=Array.from(new Uint8Array(await prepared.blob.arrayBuffer()));unsupportedExports.push(data);URL.revokeObjectURL(prepared.objectUrl);
  }
  const unsupportedExportEqual=unsupportedExports[0].length===unsupportedExports[1].length&&unsupportedExports[0].every((v,i)=>v===unsupportedExports[1][i]);
  renderer.setLut(lut);
  const gl=canvas.getContext('webgl2')!,ext=gl.getExtension('WEBGL_lose_context');
  if(ext){ext.loseContext();await new Promise(r=>setTimeout(r,100));ext.restoreContext();for(let i=0;i<50&&!recovered;i++)await new Promise(r=>setTimeout(r,20));}
  const restored=renderer.readPixels(0,0,640,480);const contextEqual=recovered&&!!restored&&on.every((v,i)=>v===restored[i]);
  renderer.destroy();URL.revokeObjectURL(image.sourceUrl);
  return {changes,outside,originalEqual,dateInOriginal,formats,unsupportedEqual,unsupportedExportEqual,contextSupported:!!ext,contextEqual};
 });
 expect(result.changes).toBeGreaterThan(100);expect(result.outside).toBe(0);expect(result.originalEqual).toBe(true);expect(result.dateInOriginal).toBe(false);
 for(const f of result.formats){expect(f.orange).toBeGreaterThan(100);expect(f.size).toBeGreaterThan(1000);expect(f.width).toBe(640);expect(f.height).toBe(480);if(f.format==='image/png')expect(f.maxDiff).toBeLessThanOrEqual(1);}
 expect(result.unsupportedEqual).toEqual(Array(9).fill(true));expect(result.unsupportedExportEqual).toBe(true);
 expect(result.contextSupported).toBe(true);expect(result.contextEqual).toBe(true);
});

test('camera recipes round-trip through UI and the prepared PNG contains only the final date overlay',async({page,isMobile})=>{
 await page.goto('/');await page.getByRole('button',{name:/Portrait/}).filter({visible:true}).first().click();
 await page.getByTestId('filter-set-card').filter({visible:true}).click();await page.getByRole('dialog',{name:'Filter Set',exact:true}).getByRole('button',{name:/Old School Film/}).click();
 let camera=await openCamera(page,isMobile);await camera.getByLabel('Imprint Date',{exact:true}).fill('2016-03-08');await camera.getByRole('checkbox',{name:'Date Imprint'}).check();
 if(isMobile)await page.getByRole('button',{name:'Close adjustments',exact:true}).click();
 const openRecipes=async()=>{if(isMobile){await page.locator('#main-nav-menu-button').click();await page.getByRole('button',{name:'Film Recipes',exact:true}).click();}else await page.getByRole('button',{name:'Recipes',exact:true}).click();};
 await openRecipes();const dialog=page.getByRole('dialog',{name:'Film Recipe Manager'});await dialog.locator('input[type=text]').fill('Retro date');await dialog.getByRole('button',{name:'Save',exact:true}).click();
 const downloadPromise=page.waitForEvent('download');await dialog.getByTitle('Export JSON',{exact:true}).click();const download=await downloadPromise;const stream=await download.createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const json=Buffer.concat(chunks).toString();const recipe=JSON.parse(json);
 expect(recipe.schemaVersion).toBe(3);expect(recipe.baseFilmId).toBe('FS-010');expect(recipe.camera.dateStamp.enabled).toBe(true);
 await dialog.locator('input[type=file]').setInputFiles({name:'retro.json',mimeType:'application/json',buffer:Buffer.from(json)});await expect(dialog.getByRole('button',{name:'Apply',exact:true})).toHaveCount(2);
 await page.getByRole('button',{name:'Close recipe manager',exact:true}).click();
 if(isMobile){camera=await openCamera(page,true);}await camera.getByRole('button',{name:'Reset Camera Effects',exact:true}).click();if(isMobile)await page.getByRole('button',{name:'Close adjustments',exact:true}).click();
 await openRecipes();await dialog.getByRole('button',{name:'Apply',exact:true}).first().click();
 const exportPixels=async()=>{
  await page.getByRole('button',{name:'Export photo',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'PNG (Lossless)',exact:true}).click();await page.getByRole('button',{name:'Prepare Photo',exact:true}).click();await expect(page.getByText('Stage B: Save & Share')).toBeVisible();
  const hashes=await page.locator('img[src^="blob:"]').filter({visible:true}).evaluate(async el=>{const img=el as HTMLImageElement;await img.decode();const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const ctx=c.getContext('2d')!;ctx.drawImage(img,0,0);const d=ctx.getImageData(0,0,c.width,c.height).data;let outside=2166136261,stamp=2166136261;for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++){const i=(y*c.width+x)*4;for(let k=0;k<3;k++)if(x>c.width*.6&&y>c.height*.8)stamp=Math.imul(stamp^d[i+k],16777619);else outside=Math.imul(outside^d[i+k],16777619);}return{outside,stamp};});
  await page.getByRole('button',{name:'Done',exact:true}).click();return hashes;
 };
 const on=await exportPixels();camera=await openCamera(page,isMobile);
 await camera.getByRole('checkbox',{name:'Date Imprint'}).uncheck();if(isMobile)await page.getByRole('button',{name:'Close adjustments',exact:true}).click();
 const off=await exportPixels();expect(on.outside).toBe(off.outside);expect(on.stamp).not.toBe(off.stamp);
});
