import fs from 'fs';
import path from 'path';
import { chromium } from 'playwright';

async function generateSocialPreview() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });

  // Read images as base64 data URIs
  const avatarPath = '/Users/jaehyukshim/AGWS/Server-HQ/services/lmpilot/src/assets/hyangdani-avatar-approved.png';
  const avatarUri = 'data:image/png;base64,' + fs.readFileSync(avatarPath).toString('base64');

  const fs1Path = path.resolve('public/thumbnails/FS-001.jpg');
  const fs1Uri = 'data:image/jpeg;base64,' + fs.readFileSync(fs1Path).toString('base64');

  const fs6Path = path.resolve('public/thumbnails/FS-006.jpg');
  const fs6Uri = 'data:image/jpeg;base64,' + fs.readFileSync(fs6Path).toString('base64');

  const fs9Path = path.resolve('public/thumbnails/FS-009.jpg');
  const fs9Uri = 'data:image/jpeg;base64,' + fs.readFileSync(fs9Path).toString('base64');

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      width: 1200px;
      height: 630px;
      background: #101110;
      color: #f2f1eb;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      position: relative;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .accent-bar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 5px;
      background: #ff824f;
    }
    .header {
      padding: 38px 64px 20px 64px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid #272a24;
    }
    .brand-wrap {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .mark-icon {
      width: 36px;
      height: 36px;
    }
    .brand-name {
      font-size: 26px;
      font-weight: 800;
      letter-spacing: -0.5px;
      color: #f2f1eb;
    }
    .brand-by {
      font-size: 13px;
      font-family: monospace;
      color: #9da391;
      letter-spacing: 1.5px;
      text-transform: uppercase;
    }
    .content {
      flex: 1;
      display: flex;
      padding: 40px 64px 30px 64px;
      justify-content: space-between;
      align-items: center;
    }
    .left-col {
      max-width: 540px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .eyebrow {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      font-family: monospace;
      font-size: 13px;
      letter-spacing: 2px;
      color: #ff986e;
      text-transform: uppercase;
      font-weight: 700;
    }
    .eyebrow-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ff824f;
    }
    .title {
      font-size: 74px;
      font-weight: 800;
      letter-spacing: -3px;
      line-height: 1.02;
      color: #f2f1eb;
    }
    .subtitle {
      font-size: 32px;
      font-weight: 700;
      color: #ff986e;
      letter-spacing: -0.5px;
    }
    .description {
      font-size: 20px;
      color: #b5baa8;
      line-height: 1.4;
    }
    .tags {
      display: flex;
      gap: 10px;
      margin-top: 6px;
    }
    .tag {
      font-family: monospace;
      font-size: 11px;
      letter-spacing: 1px;
      padding: 6px 12px;
      border-radius: 4px;
      background: #181c15;
      border: 1px solid #32382a;
      color: #d2d7c5;
      text-transform: uppercase;
    }
    .url {
      font-family: monospace;
      font-size: 14px;
      color: #7b836f;
      margin-top: 10px;
    }
    .right-col {
      display: flex;
      align-items: center;
      gap: 24px;
      position: relative;
    }
    /* Contact Sheet Comparison Cards */
    .film-cards {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .film-card {
      display: flex;
      align-items: center;
      gap: 14px;
      background: #161914;
      border: 1px solid #2d3326;
      border-radius: 12px;
      padding: 8px 14px 8px 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.4);
    }
    .film-thumb {
      width: 112px;
      height: 80px;
      border-radius: 8px;
      object-fit: cover;
      border: 1px solid #363d2e;
    }
    .film-meta {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .film-id {
      font-family: monospace;
      font-size: 11px;
      font-weight: 700;
      color: #ff986e;
    }
    .film-title {
      font-size: 15px;
      font-weight: 700;
      color: #f2f1eb;
    }
    .film-style {
      font-size: 11px;
      color: #929984;
    }
    /* Hyangdani Badge */
    .avatar-card {
      width: 220px;
      height: 290px;
      background: #181c15;
      border: 1px solid #323a2a;
      border-radius: 20px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px;
      position: relative;
      box-shadow: 0 12px 32px rgba(0,0,0,0.5);
    }
    .avatar-img {
      width: 175px;
      height: 175px;
      border-radius: 50%;
      background: #242c1e;
      border: 3px solid #ff824f;
      padding: 4px;
      object-fit: cover;
    }
    .avatar-tag {
      margin-top: 14px;
      background: #e5e8d7;
      color: #202619;
      padding: 4px 16px;
      border-radius: 20px;
      font-weight: 700;
      font-size: 13px;
      letter-spacing: 0.5px;
    }
    .avatar-sub {
      font-size: 10px;
      font-family: monospace;
      color: #8c947d;
      margin-top: 5px;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
  </style>
</head>
<body>
  <div class="accent-bar"></div>

  <!-- Header -->
  <div class="header">
    <div class="brand-wrap">
      <svg class="mark-icon" viewBox="0 0 64 64" fill="none">
        <rect width="64" height="64" rx="12" fill="#101110"/>
        <path d="M15 20L35 10V43L15 53ZM29 24L49 14V47L29 57Z" fill="none" stroke="#ff824f" stroke-width="4.5" stroke-linejoin="round"/>
      </svg>
      <span class="brand-name">HD2Lab</span>
    </div>
    <div class="brand-by">Color Simulation · 9 Film Profiles</div>
  </div>

  <!-- Content -->
  <div class="content">
    <div class="left-col">
      <div class="eyebrow">
        <div class="eyebrow-dot"></div>
        <span>HD2Lab Original Film Collection</span>
      </div>
      <div class="title">Film Studio</div>
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
      <!-- 3 Representative Film Signatures -->
      <div class="film-cards">
        <div class="film-card">
          <img class="film-thumb" src="${fs1Uri}">
          <div class="film-meta">
            <span class="film-id">FS-001</span>
            <span class="film-title">VÆRN</span>
            <span class="film-style">Heritage Negative</span>
          </div>
        </div>
        <div class="film-card">
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

      <!-- Approved HyangDani character card -->
      <div class="avatar-card">
        <img class="avatar-img" src="${avatarUri}">
        <div class="avatar-tag">향단이</div>
        <div class="avatar-sub">HD2Lab Companion</div>
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

generateSocialPreview().catch(err => {
  console.error(err);
  process.exit(1);
});
