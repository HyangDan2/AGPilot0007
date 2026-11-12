import { test, expect } from '@playwright/test';

test('curve overlay edits channels, resets independently, and preserves workspace geometry',async({page,isMobile})=>{
 await page.goto('/');await page.getByRole('button',{name:/Portrait/}).filter({visible:true}).first().click();
 await expect(page.getByTestId('histogram')).toHaveCount(0);
 const workspace=page.getByTestId('image-workspace');await expect(workspace).toBeVisible();const before=await workspace.boundingBox();
 const toggle=page.getByTestId('tone-curve-toggle').filter({visible:true});await toggle.click();
 await expect(page.getByTestId('tone-curve-overlay')).toBeVisible();await expect(page.getByTestId('curve-toolbar').filter({visible:true})).toBeVisible();
 expect(await workspace.boundingBox()).toEqual(before);
 await expect(page.getByTestId('histogram').locator('path')).toHaveCount(4);const histBefore=await page.getByTestId('histogram').locator('path').nth(1).getAttribute('d');
 const red=page.getByRole('button',{name:'red curve',exact:true}).filter({visible:true});await red.click();
 const graph=page.getByTestId('curve-graph');let box=(await graph.boundingBox())!;
 if(isMobile)await page.touchscreen.tap(box.x+box.width*.5,box.y+box.height*.3);else await graph.click({position:{x:box.width*.5,y:box.height*.3}});
 await expect(page.getByRole('button',{name:'Curve point 3',exact:true})).toBeVisible();
 await expect(page.getByLabel('Curve Output',{exact:true})).toHaveValue(/17\d|18\d/);
 await expect.poll(()=>page.getByTestId('histogram').locator('path').nth(1).getAttribute('d')).not.toBe(histBefore);
 const output=await page.getByLabel('Curve Output',{exact:true}).inputValue();
 await page.getByRole('button',{name:'blue curve',exact:true}).filter({visible:true}).click();await page.getByLabel('Curve Output',{exact:true}).fill('30');
 await red.click();await page.getByRole('button',{name:'Curve point 2',exact:true}).focus();await expect(page.getByLabel('Curve Output',{exact:true})).toHaveValue(output);
 await page.getByRole('button',{name:'Reset selected curve',exact:true}).filter({visible:true}).click();await expect(page.getByRole('button',{name:'Curve point 3',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'blue curve',exact:true}).filter({visible:true}).click();await expect(page.getByLabel('Curve Output',{exact:true})).toHaveValue('30');
 await page.getByRole('button',{name:'전체 커브 초기화'}).click();await expect(page.getByLabel('Curve Output',{exact:true})).toHaveValue('0');
 await expect(page.getByTestId('histogram').locator('path')).toHaveCount(4);
 await page.getByRole('button',{name:'Close tone curve',exact:true}).click();await expect(page.getByTestId('tone-curve-overlay')).toHaveCount(0);await expect(page.getByTestId('histogram')).toHaveCount(0);
 // Camera is shared, date imprint works before selecting Old School, optics stay profile specific.
 await page.getByTestId('camera-effects-toggle').filter({visible:true}).click();
 const camera=page.getByTestId('camera-effects').filter({visible:true});await expect(camera).toBeVisible();
 await expect(camera.getByLabel('Highlight Glow',{exact:true})).toHaveCount(0);
 await camera.getByLabel('Imprint Date',{exact:true}).fill('2026-11-12');await camera.getByRole('checkbox',{name:'Date Imprint'}).check();
 if(isMobile && await page.getByRole('button',{name:'Close camera effects',exact:true}).isVisible())await page.getByRole('button',{name:'Close camera effects',exact:true}).click();
 await page.getByTestId('tone-curve-toggle').filter({visible:true}).click();await graph.waitFor();box=(await graph.boundingBox())!;
 // Pointer drag is captured by graph and cannot move/zoom the photograph.
 await page.mouse.move(box.x+box.width*.5,box.y+box.height*.5);await page.mouse.down();await page.mouse.move(box.x+box.width*.6,box.y+box.height*.4,{steps:5});await page.mouse.up();
 expect(await workspace.boundingBox()).toEqual(before);
 await page.screenshot({path:test.info().outputPath('tone-curve.png')});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});

test('curves share exact PNG preview/export, original/split, identity and context recovery',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {WebGL2FilmRenderer}=await import('../../src/engine/renderer/webglRenderer');
  const {loadCubeLut}=await import('../../src/engine/color/lutLoader');
  const {DEFAULT_ADJUSTMENTS}=await import('../../src/types/film');
  const {defaultCurves}=await import('../../src/types/curves');
  const {prepareExportImage}=await import('../../src/engine/export/imageExporter');
  const source=document.createElement('canvas');source.width=256;source.height=128;const ctx=source.getContext('2d')!;
  const gradient=ctx.createLinearGradient(0,0,256,0);gradient.addColorStop(0,'black');gradient.addColorStop(1,'white');ctx.fillStyle=gradient;ctx.fillRect(0,0,256,128);
  const canvas=document.createElement('canvas');canvas.width=256;canvas.height=128;
  const lut=await loadCubeLut('luts/identity.cube');
  const curves=defaultCurves();curves.white=[[.15,.05],[.5,.65],[.85,.95]];curves.blue=[[0,.1],[1,.9]];
  const options={adjustments:DEFAULT_ADJUSTMENTS,compareMode:'none' as const,splitPos:.5,filmId:'FS-001' as const};
  let recovered=false;const renderer=new WebGL2FilmRenderer(canvas,()=>{renderer.setImage(source);renderer.setLut(lut);renderer.render({...options,curves});recovered=true;});
  renderer.setImage(source);renderer.setLut(lut);renderer.render(options);const baseline=renderer.readPixels(0,0,256,128)!;
  renderer.render({...options,curves:defaultCurves()});const neutral=renderer.readPixels(0,0,256,128)!;
  const diagonal=defaultCurves();diagonal.white=[[.2,.2],[.8,.8]];renderer.render({...options,curves:diagonal});const plateau=renderer.readPixels(0,0,256,128)!;const partialDiagonal=plateau[4]===plateau[40*4]&&Math.abs(plateau[4]-51)<=1&&plateau[220*4]===plateau[254*4]&&Math.abs(plateau[254*4]-204)<=1;
  renderer.render({...options,curves});const developed=renderer.readPixels(0,0,256,128)!;
  renderer.render({...options,compareMode:'original'});const originalOff=renderer.readPixels(0,0,256,128)!;
  renderer.render({...options,curves,compareMode:'original'});const original=renderer.readPixels(0,0,256,128)!;
  renderer.render({...options,curves,compareMode:'split'});const split=renderer.readPixels(0,0,256,128)!;
  const splitOK=Array.from({length:128*256},(_,i)=>{const x=i%256;return x>125&&x<131||[0,1,2].every(c=>split[i*4+c]===(x<128?originalOff:developed)[i*4+c]);}).every(Boolean);
  const img={name:'gradient.png',originalWidth:256,originalHeight:128,originalElement:source} as any;
  const exports=[];const decode=document.createElement('canvas');decode.width=256;decode.height=128;const decoded=decode.getContext('2d')!;
  for(const format of ['image/png','image/jpeg'] as const){const prepared=await prepareExportImage(img,lut,DEFAULT_ADJUSTMENTS,{format,quality:1,scale:1},undefined,undefined,'FS-001',curves);const bm=await createImageBitmap(prepared.blob);decoded.drawImage(bm,0,0);const pixels=decoded.getImageData(0,0,256,128).data;let maxDiff=0;for(let y=0;y<128;y++)for(let x=0;x<256;x++)for(let c=0;c<3;c++)maxDiff=Math.max(maxDiff,Math.abs(pixels[(y*256+x)*4+c]-developed[((127-y)*256+x)*4+c]));exports.push({format,maxDiff,size:prepared.blob.size});bm.close();URL.revokeObjectURL(prepared.objectUrl);}
  renderer.render({...options,adjustments:{...DEFAULT_ADJUSTMENTS,blacks:50,whites:-50}});const endpoints=renderer.readPixels(0,0,256,128)!;
  const ext=canvas.getContext('webgl2')!.getExtension('WEBGL_lose_context')!;ext.loseContext();await new Promise(r=>setTimeout(r,100));ext.restoreContext();for(let i=0;i<100&&!recovered;i++)await new Promise(r=>setTimeout(r,20));const restored=renderer.readPixels(0,0,256,128)!;
  const result={partialDiagonal,identity:baseline.every((v,i)=>v===neutral[i]),original:originalOff.every((v,i)=>v===original[i]),changed:developed.some((v,i)=>v!==baseline[i]),splitOK,exports,endpoints:endpoints[0]>baseline[0]&&endpoints[255*4]<baseline[255*4],recovered:recovered&&developed.every((v,i)=>v===restored[i])};renderer.destroy();return result;
 });
 expect(result.partialDiagonal).toBe(true);expect(result.identity,JSON.stringify(result)).toBe(true);expect(result.original).toBe(true);expect(result.changed).toBe(true);expect(result.splitOK).toBe(true);expect(result.endpoints).toBe(true);expect(result.recovered,JSON.stringify(result)).toBe(true);
 for(const output of result.exports){expect(output.size).toBeGreaterThan(100);expect(output.maxDiff).toBeLessThanOrEqual(output.format==='image/png'?1:8);}
});


test('imports and exports all curve channels through the recipe manager',async({page,isMobile})=>{
 await page.goto('/');await page.getByRole('button',{name:/Portrait/}).filter({visible:true}).first().click();await expect(page.getByTestId('image-workspace')).toBeVisible();
 const openRecipes=async()=>{if(isMobile){await page.locator('#main-nav-menu-button').click();await page.getByRole('button',{name:'Film Recipes',exact:true}).click();}else await page.getByRole('button',{name:'Recipes',exact:true}).click();};
 await openRecipes();const dialog=page.getByRole('dialog',{name:'Film Recipe Manager'});
 const curves={white:[[0,0],[.5,.7],[1,1]],red:[[.1,.1],[.9,.9]],green:[[0,0],[1,1]],blue:[[0,.05],[1,1]]};
 const recipe={name:'Curve import',baseFilmId:'FS-001',schemaVersion:4,curves,adjustments:{blacks:-15,whites:20}};
 await dialog.locator('input[type=file]').setInputFiles({name:'curves.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(recipe))});await dialog.getByRole('button',{name:'Apply',exact:true}).click();
 await page.getByTestId('tone-curve-toggle').filter({visible:true}).click();await page.getByRole('button',{name:'red curve',exact:true}).filter({visible:true}).click();await expect(page.getByLabel('Curve Output',{exact:true})).toHaveValue('26');
 await page.getByRole('button',{name:'Close tone curve',exact:true}).click();await openRecipes();
 const downloaded=page.waitForEvent('download');await dialog.getByTitle('Export JSON',{exact:true}).click();const stream=await (await downloaded).createReadStream();const chunks:Buffer[]=[];for await(const chunk of stream!)chunks.push(Buffer.from(chunk));const saved=JSON.parse(Buffer.concat(chunks).toString());expect(saved.schemaVersion).toBe(6);expect(saved.curves).toEqual(curves);expect(saved.adjustments.blacks).toBe(-15);expect(saved.adjustments.whites).toBe(20);
});
