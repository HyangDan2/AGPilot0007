import {test,expect} from '@playwright/test';
test('both curve endpoints move horizontally and vertically, reset and round-trip in v4',async({page,isMobile})=>{
 await page.goto('/');await page.getByRole('button',{name:/Portrait/}).filter({visible:true}).first().click();
 await page.getByTestId('tone-curve-toggle').filter({visible:true}).click();
 const graph=page.getByTestId('curve-graph'),input=page.getByLabel('Curve Input',{exact:true}),output=page.getByLabel('Curve Output',{exact:true});
 await expect(input).toBeEnabled();const bounds=(await graph.boundingBox())!;
 // Emulated WebKit rounds pointer coordinates to CSS pixels; allow one pixel plus display rounding.
 const pointerTolerance=255*272/(bounds.width*256)+.5;
 const point=(x:number,y:number)=>({x:bounds.x+(8+x*256)/272*bounds.width,y:bounds.y+(8+(1-y)*256)/272*bounds.height});
 const drag=async(from:{x:number;y:number},to:{x:number;y:number})=>{await page.mouse.move(from.x,from.y);await page.mouse.down();await page.mouse.move(to.x,to.y,{steps:6});await page.mouse.up();};
 await drag(point(0,0),point(.2,.1));expect(Math.abs(Number(await input.inputValue())-51)).toBeLessThanOrEqual(pointerTolerance);expect(Math.abs(Number(await output.inputValue())-25.5)).toBeLessThanOrEqual(pointerTolerance);
 await drag(point(1,1),point(.8,.9));expect(Math.abs(Number(await input.inputValue())-204)).toBeLessThanOrEqual(pointerTolerance);expect(Math.abs(Number(await output.inputValue())-229.5)).toBeLessThanOrEqual(pointerTolerance);
 // Arrow keys and numeric input use the same bounds as dragging.
 await page.getByRole('button',{name:'Curve point 2',exact:true}).focus();const beforeKey=Number(await input.inputValue());await page.keyboard.press('ArrowLeft');await expect(input).toHaveValue(String(beforeKey-1));
 await input.fill('190');await output.fill('220');await expect(input).toHaveValue('190');await expect(output).toHaveValue('220');
 await page.getByRole('button',{name:'Curve point 1',exact:true}).focus();await input.fill('255');expect(Number(await graph.getByRole('button',{name:'Curve point 1',exact:true}).getAttribute('cx'))).toBeLessThan(Number(await graph.getByRole('button',{name:'Curve point 2',exact:true}).getAttribute('cx')));
 await input.fill('40');await output.fill('20');
 for(const channel of ['red','green','blue']){
  await page.getByRole('button',{name:`${channel} curve`,exact:true}).filter({visible:true}).click();await input.fill('25');await output.fill('10');
  await page.getByRole('button',{name:'Curve point 2',exact:true}).focus();await input.fill('225');await output.fill('245');
 }
 await page.getByRole('button',{name:'blue curve',exact:true}).filter({visible:true}).click();
 await page.getByRole('button',{name:'Reset selected curve',exact:true}).filter({visible:true}).click();await page.getByRole('button',{name:'Curve point 1',exact:true}).focus();await expect(input).toHaveValue('0');await expect(output).toHaveValue('0');
 await page.getByRole('button',{name:'white curve',exact:true}).filter({visible:true}).click();await expect(input).toHaveValue('40');
 // Tapping an existing endpoint must select it, not create a new point.
 if(isMobile)await page.touchscreen.tap(point(40/255,20/255).x,point(40/255,20/255).y);
 await expect(graph.getByRole('button')).toHaveCount(2);
 await page.screenshot({path:test.info().outputPath('movable-endpoints.png')});
 await page.getByRole('button',{name:'Close tone curve',exact:true}).click();
 const openRecipes=async()=>{if(isMobile){await page.locator('#main-nav-menu-button').click();await page.getByRole('button',{name:'Film Recipes',exact:true}).click();}else await page.getByRole('button',{name:'Recipes',exact:true}).click();};
 await openRecipes();const modal=page.getByRole('dialog',{name:'Film Recipe Manager'});await modal.locator('input[type=text]').fill('Moved endpoints');await modal.getByRole('button',{name:'Save',exact:true}).click();
 const downloading=page.waitForEvent('download');await modal.getByTitle('Export JSON',{exact:true}).click();const stream=await(await downloading).createReadStream();const chunks:Buffer[]=[];for await(const c of stream!)chunks.push(Buffer.from(c));const json=Buffer.concat(chunks).toString(),recipe=JSON.parse(json);
 expect(recipe.schemaVersion).toBe(7);expect(recipe.curves.white[0]).toEqual([40/255,20/255]);expect(recipe.curves.white[1]).toEqual([190/255,220/255]);
 await modal.locator('input[type=file]').setInputFiles({name:'endpoints.json',mimeType:'application/json',buffer:Buffer.from(json)});await modal.getByRole('button',{name:'Apply',exact:true}).first().click();
 await page.getByTestId('tone-curve-toggle').filter({visible:true}).click();await expect(input).toHaveValue('40');await expect(output).toHaveValue('20');
 await page.getByRole('button',{name:'전체 커브 초기화'}).click();await expect(input).toHaveValue('0');await page.getByRole('button',{name:'Curve point 2',exact:true}).focus();await expect(input).toHaveValue('255');await expect(output).toHaveValue('255');
});
