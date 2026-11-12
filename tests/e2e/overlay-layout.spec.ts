import {test,expect} from '@playwright/test';
test('transparent centered curves, filter-area toolbar and independent camera overlay',async({page})=>{
 for(const width of [320,768,1440]){
  await page.setViewportSize({width,height:900});await page.goto('/');await page.getByRole('button',{name:/Portrait/}).filter({visible:true}).first().click();
  const workspace=page.getByTestId('image-workspace');await expect(workspace).toBeVisible();const bounds=(await workspace.boundingBox())!;
  await expect(page.getByTestId('histogram')).toHaveCount(0);
  const openTools=async()=>{if(width>=768&&width<1280)await page.getByRole('button',{name:'Adjustments',exact:true}).click();};
  await openTools();await page.getByTestId('tone-curve-toggle').filter({visible:true}).click();
  const graph=page.getByTestId('curve-graph');await expect(graph).toBeVisible();const box=(await graph.boundingBox())!;
  expect(Math.abs(box.x+box.width/2-bounds.x-bounds.width/2)).toBeLessThan(1);expect(Math.abs(box.y+box.height/2-bounds.y-bounds.height/2)).toBeLessThan(1);
  const style=await page.getByTestId('tone-curve-overlay').evaluate(el=>({bg:getComputedStyle(el).backgroundColor,blur:getComputedStyle(el).backdropFilter}));expect(style).toEqual({bg:'rgba(0, 0, 0, 0)',blur:'none'});await expect(graph.locator('rect')).toHaveAttribute('fill','none');
  const toolbar=page.getByTestId('curve-toolbar').filter({visible:true});await expect(toolbar).toBeVisible();expect(await toolbar.evaluate(el=>!!el.closest(innerWidth>=1280?'[data-testid="tone-curve-overlay"]':'[data-testid="filter-area"]'))).toBe(true);expect(await workspace.boundingBox()).toEqual(bounds);
  await expect(page.getByTestId('histogram')).toBeVisible();await expect(page.getByTestId('histogram').locator('path')).toHaveCount(4);
  // Tablet icon panel opens above the workspace, then closes as camera overlay opens.
  await openTools();await page.getByTestId('camera-effects-toggle').filter({visible:true}).click();
  const camera=page.getByTestId('camera-effects');await expect(camera).toBeVisible();await expect(graph).toHaveCount(0);await expect(page.getByTestId('histogram')).toHaveCount(0);await expect(toolbar).toHaveCount(0);
  expect(await camera.evaluate(el=>!!el.closest('[data-testid="image-workspace"]'))).toBe(true);expect(await camera.evaluate(el=>!!el.closest('aside,[data-testid="adjustment-sheet"]'))).toBe(false);
  await camera.getByLabel('Imprint Date',{exact:true}).fill('2026-11-12');await camera.getByRole('checkbox',{name:'Date Imprint'}).check();expect(await workspace.boundingBox()).toEqual(bounds);
  await page.screenshot({path:test.info().outputPath(`overlay-camera-${width}.png`)});
  await page.keyboard.press('Escape');await expect(camera).toHaveCount(0);
  await openTools();await page.getByTestId('tone-curve-toggle').filter({visible:true}).click();await graph.waitFor();await page.screenshot({path:test.info().outputPath(`overlay-curve-${width}.png`)});
 }
});
