# Film Studio v1.0.0 — User Guide

Short, task-oriented. Film Studio runs fully in the browser; images never leave
the device (no server upload, no backend).

## 1. Open the app

- Open the hosted app (or the installed PWA). On first visit the service worker
  installs in the background so the app works offline afterwards.
- The film strip on the left lists images in the current workspace.

## 2. Edit a photo

1. Drag photos onto the film strip, or use **Import**.
2. Select an image; the viewport shows the active film profile.
3. Pick a film from the profile list (FS-001 … FS-009) and adjust exposure,
   contrast, density, curves, sharpening and the color mixer in the side panel.
4. Changes preview live. Copies of the original are never modified.

## 3. Open a RAW file

1. Import a camera RAW file. It appears in the strip with a RAW badge.
2. Open the **Develop** panel to set white balance, exposure and highlight
   recovery; the developed image then flows through the same grade stack.
3. 24MP RAW files take roughly 1.7–1.9 s to open and need about 300 MB of
   memory. Smaller RAWs are faster.

## 4. Frame and crop (geometry)

- In **Geometry**, choose a crop ratio, drag the crop frame, and rotate.
- Geometry is stored with the recipe (schema v8+).

## 5. Local adjustments and masks

- Add a linear or radial mask and adjust exposure/contrast inside it.
- Masks and optical overrides require recipe schema v9 when saved.

## 6. Workspace tools

- **Copy/paste settings** between images from the strip context menu.
- **EXIF viewer** shows camera/lens/shooting data.
- **Film recommendation** suggests a profile from the image's characteristics.
- **Integrity check** re-validates an image's decode/backing data.

## 7. Batch export

- Select multiple images (or all) and choose **Export** → format, size, quality.
- The export runs sequentially and reports progress per image.

## 8. Lens blur

- Enable **Lens blur** in the develop section. A depth/PSF model blurs the
  background; use the lens preview to check the bokeh.
- Turning lens preview on does not reduce frame rate (measured: no frame cost).
- Lens blur requires recipe schema v10 when saved. Lens-ON exports are larger
  and slower than lens-OFF exports (see release notes for current numbers).

## 9. Video

1. Open the **Video** workspace and import a clip (MP4/WebM supported by the
   browser's WebCodecs).
2. Scrub and set trim in/out.
3. Choose container, codec, audio, resolution, bitrate and fps from the
   capability list (unsupported options are disabled).
4. Export. The active film grade is rendered into every frame; the output is
   named `<name>_HD2Lab_FilmStudio.<ext>`.

Notes:

- The video engine loads the first time video mode is opened. On a photo-only
  session the page issues no video-engine network requests.
- On first install the service worker downloads the video engine in the
  background so video export also works offline.

## 10. Export stills

- Use **Export** in the toolbar for the current image; choose JPEG/PNG, size
  and quality. Tiled export handles very large sources (tested to 17,000×1,200).

## 11. Offline and updates

- After the first visit the app is served from the service worker cache.
- Updates apply automatically: when a new version is deployed, the service
  worker takes control and the app reloads once. No user action is required.

## 12. Recipes

- **Save recipe** writes a JSON file; **Load recipe** restores it on any machine.
- Recipes from older versions are migrated in memory on load; recipes from a
  newer schema than supported are rejected with a clear message.
- See `RECIPE_COMPATIBILITY.md` for exact version support.
