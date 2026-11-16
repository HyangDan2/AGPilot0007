import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

// Generates public/social-preview.png (1200x630) in the HD2Lab Soft Iris (White & Violet) language.
// Palette is the Hub-common source of truth: Server-HQ/HD2Lab/hub-common.css.
async function generateSocialPreview() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });

  const uri = (p) => 'data:image/jpeg;base64,' + fs.readFileSync(path.resolve(p)).toString('base64');
  const fs1Uri = uri('public/thumbnails/FS-001.jpg');
  const fs6Uri = uri('public/thumbnails/FS-006.jpg');
  const fs9Uri = uri('public/thumbnails/FS-009.jpg');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1200px; height: 630px; background: #FAFAFD; color: #1D192B;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      position: relative; overflow: hidden; display: flex; flex-direction: column;
    }
    .grid {
      position: absolute; inset: 0;
      background-image: linear-gradient(#E8E4F2 1px, transparent 1px), linear-gradient(90deg, #E8E4F2 1px, transparent 1px);
      background-size: 48px 48px; opacity: .55;
    }
    .glow {
      position: absolute; width: 720px; height: 720px; right: -240px; top: -300px; border-radius: 50%;
      background: radial-gradient(circle, rgba(139,108,232,.16), rgba(250,250,253,0) 68%);
    }
    .accent-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 5px; background: #8B6CE8; }
    .header {
      position: relative; padding: 34px 56px 20px; display: flex; align-items: center; justify-content: space-between;
    }
    .brand-wrap { display: flex; align-items: center; gap: 14px; }
    .mark-icon { width: 40px; height: 40px; }
    .brand-name { font-size: 27px; font-weight: 800; letter-spacing: -1px; color: #1D192B; }
    .brand-by {
      font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #68627A;
      letter-spacing: 1.6px; text-transform: uppercase;
    }
    .content {
      position: relative; flex: 1; display: flex; padding: 10px 56px 34px; justify-content: space-between; align-items: center;
    }
    .left-col { max-width: 560px; display: flex; flex-direction: column; gap: 14px; }
    .eyebrow {
      display: inline-flex; align-items: center; gap: 10px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
      font-size: 12px; letter-spacing: 2.4px; color: #68627A; text-transform: uppercase;
    }
    .eyebrow-dot { width: 9px; height: 9px; border-radius: 50%; background: #8B6CE8; }
    .title { font-size: 76px; font-weight: 800; letter-spacing: -3.4px; line-height: 1; color: #1D192B; }
    .title span { color: #6B4CD6; }
    .subtitle { font-size: 30px; font-weight: 700; color: #6B4CD6; letter-spacing: -.6px; }
    .description { font-size: 18px; color: #68627A; line-height: 1.45; }
    .tags { display: flex; gap: 10px; margin-top: 4px; }
    .tag {
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; letter-spacing: 1px;
      padding: 6px 12px; border-radius: 999px; background: #F1ECFE; border: 1px solid #E8E4F2; color: #6B4CD6;
      text-transform: uppercase;
    }
    .url { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #8A839C; margin-top: 8px; }
    .right-col { display: flex; align-items: center; gap: 18px; }
    .film-cards { display: flex; flex-direction: column; gap: 12px; }
    .film-card {
      display: flex; align-items: center; gap: 14px; background: #FFFFFF; border: 1px solid #E8E4F2;
      border-radius: 14px; padding: 8px 18px 8px 8px; box-shadow: 0 10px 26px rgba(29,25,43,.07);
    }
    .film-card.lift { border-color: #C4B5FD; box-shadow: 0 12px 30px rgba(139,108,232,.16); }
    .film-thumb { width: 112px; height: 80px; border-radius: 9px; object-fit: cover; border: 1px solid #E8E4F2; }
    .film-meta { display: flex; flex-direction: column; gap: 2px; }
    .film-id { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11px; font-weight: 700; color: #8B6CE8; }
    .film-title { font-size: 15px; font-weight: 700; color: #1D192B; }
    .film-style { font-size: 11px; color: #68627A; }
  </style>
</head>
<body>
  <div class="grid"></div><div class="glow"></div><div class="accent-bar"></div>

  <div class="header">
    <div class="brand-wrap">
      <svg class="mark-icon" viewBox="0 0 64 64" fill="none">
        <rect width="64" height="64" rx="12" fill="#FAFAFD" stroke="#E8E4F2" stroke-width="2"/>
        <path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="#8B6CE8" stroke-width="4" stroke-linejoin="round"/>
      </svg>
      <span class="brand-name">HD2Lab <span style="color:#D4CCE8;font-weight:400">|</span> <span style="color:#6B4CD6">Film Studio</span></span>
    </div>
    <div class="brand-by">Color Simulation · 9 Film Profiles</div>
  </div>

  <div class="content">
    <div class="left-col">
      <div class="eyebrow"><div class="eyebrow-dot"></div><span>HD2Lab Original Film Collection</span></div>
      <div class="title">Film <span>Studio</span></div>
      <div class="subtitle">The Northern Palette</div>
      <div class="description">Nine Original Film Signatures engineered with WebGL2 3D LUTs and authentic characteristic curves.</div>
      <div class="tags">
        <div class="tag">100% Client-Side</div>
        <div class="tag">WebGL2 3D LUT</div>
        <div class="tag">Zero Server Upload</div>
      </div>
      <div class="url">hyangdan2.github.io/AGPilot0007</div>
    </div>

    <div class="right-col">
      <div class="film-cards">
        <div class="film-card">
          <img class="film-thumb" src="${fs1Uri}">
          <div class="film-meta">
            <span class="film-id">FS-001</span>
            <span class="film-title">VÆRN</span>
            <span class="film-style">Heritage Negative</span>
          </div>
        </div>
        <div class="film-card lift">
          <img class="film-thumb" src="${fs6Uri}">
          <div class="film-meta">
            <span class="film-id">FS-006</span>
            <span class="film-title">SOLVIK</span>
            <span class="film-style">Vivid Nature</span>
          </div>
        </div>
        <div class="film-card">
          <img class="film-thumb" src="${fs9Uri}">
          <div class="film-meta">
            <span class="film-id">FS-009</span>
            <span class="film-title">RIMVA</span>
            <span class="film-style">Silver Monochrome</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</body>
</html>
  `;

  await page.setContent(html);
  await page.waitForTimeout(500);
  const outPath = path.resolve('public/social-preview.png');
  await page.screenshot({ path: outPath, omitBackground: false });
  console.log(`Generated social preview: ${outPath} (1200x630)`);
  await browser.close();
}

generateSocialPreview().catch((err) => {
  console.error(err);
  process.exit(1);
});
