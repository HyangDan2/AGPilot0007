# Q03 Imaging PoC — Third-Party Notices

Scope: the RAW/video PoC under `poc/q03-imaging/`. This file prepares the notices required if
FlashRaw and Mediabunny are promoted into the product bundle; it does not modify the product app.
License texts below were copied from the installed packages (`node_modules/<pkg>/LICENSE*`).

## Bundled at product time (candidates)

### flashraw 0.5.0 — MIT OR Apache-2.0
Source: https://flashraw.ybouane.com · npm `flashraw@0.5.0` (`LICENSE-MIT`, `LICENSE-APACHE`).
Shipped artifacts include all dynamically-imported WASM variants:
`flashraw.wasm`, `flashraw_simd.wasm`, `flashraw_simd_threads.wasm`, `flashraw_simd_gpu.wasm`,
`flashraw_simd_jxl.wasm`, `flashraw_simd_threads_jxl.wasm`.
If the product picks MIT:

```
MIT License

Copyright (c) FlashRaw contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

(The full Apache-2.0 text is in `node_modules/flashraw/LICENSE-APACHE`; ship it if Apache-2.0 is chosen.)

### mediabunny 1.66.4 — MPL-2.0
Source: https://mediabunny.dev/ · https://github.com/Vanilagy/mediabunny (`node_modules/mediabunny/LICENSE`).

MPL-2.0 is file-level copyleft. The PoC does not modify Mediabunny; bundling the unmodified library
requires the MPL notice and a pointer to its source (the npm tarball / upstream repo above). If the
product ever patches Mediabunny files, those modified files must be published under MPL-2.0.

## Explicitly excluded from the product bundle

### libraw-wasm 1.6.0 — wrapper declared ISC; embedded LibRaw is LGPL-2.1 / CDDL-1.0
Source: https://github.com/ybouane/LibRaw-Wasm. Used only to generate reference decodes during PoC
measurement. It statically links LibRaw into WASM; shipping it would require LGPL relinking/source
obligations. Per the CP1.1 WO it stays out of the product bundle and out of `dist/`.

## Test data (not redistributed)

- RAW samples: raw.pixls.us corpus (samples published as CC0 / public domain). Downloaded by
  `scripts/fetch-raw-samples.sh` into git-ignored `testdata/` and verified against
  `scripts/raw-samples.sha256`. No RAW originals are committed or shipped.
- Video fixtures: synthesized locally with ffmpeg (`scripts/make-fixtures.sh`), git-ignored.
- ffmpeg (Homebrew, LGPL/GPL build) and Playwright Chromium are local measurement tools only.

## Verification method

`node -e "require('./node_modules/<pkg>/package.json').license"` plus license-file presence checks
performed against the installed tree on 2026-11-27. Re-verify against upstream repositories before
the product locks these dependencies (Q01 contract freeze).
