import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function generateIcons() {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const outDir = path.resolve('public');

  // 1. PWA 192x192
  const svg192 = `
    <svg xmlns="http://www.w3.org/2000/svg" width="192" height="192" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="#101110"/>
      <path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="#ff824f" stroke-width="4" stroke-linejoin="round"/>
    </svg>
  `;
  await page.setContent(`<div id="icon" style="width:192px;height:192px;display:inline-block;">${svg192}</div>`);
  await page.locator('#icon').screenshot({ path: path.join(outDir, 'pwa-192x192.png'), omitBackground: false });
  console.log('Generated pwa-192x192.png');

  // 2. PWA 512x512
  const svg512 = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 64 64">
      <rect width="64" height="64" rx="12" fill="#101110"/>
      <path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="#ff824f" stroke-width="4" stroke-linejoin="round"/>
    </svg>
  `;
  await page.setContent(`<div id="icon" style="width:512px;height:512px;display:inline-block;">${svg512}</div>`);
  await page.locator('#icon').screenshot({ path: path.join(outDir, 'pwa-512x512.png'), omitBackground: false });
  console.log('Generated pwa-512x512.png');

  // 3. PWA 512x512 Maskable (Central 80% safe zone, square background)
  const svgMaskable = `
    <svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
      <rect width="512" height="512" fill="#101110"/>
      <g transform="translate(102.4, 102.4) scale(4.8)">
        <!-- 64x64 scaled to 307.2x307.2, centered inside 512x512 within 80% safe zone -->
        <path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="#ff824f" stroke-width="4" stroke-linejoin="round"/>
      </g>
    </svg>
  `;
  await page.setContent(`<div id="icon" style="width:512px;height:512px;display:inline-block;">${svgMaskable}</div>`);
  await page.locator('#icon').screenshot({ path: path.join(outDir, 'pwa-512x512-maskable.png'), omitBackground: false });
  console.log('Generated pwa-512x512-maskable.png');

  await browser.close();
}

generateIcons().catch(err => {
  console.error(err);
  process.exit(1);
});
