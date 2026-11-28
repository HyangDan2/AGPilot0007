# Q03 RAW PoC — generated result tables

## Environment

| 항목 | 값 |
|---|---|
| Browser | Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/158.0.0.0 Safari/537.36 |
| flashraw | 0.5.0 (simd=true, threads=false, binary=simd) |
| threads reason | the page is not cross-origin isolated, so SharedArrayBuffer is unavailable (serve it with COOP: same-origin and COEP: require-corp) |
| crossOriginIsolated / SharedArrayBuffer | false / false |
| WebGL2 / maxTexture | true / 8192 |
| hardwareConcurrency | 8 |
| JS heap limit | 4192 MB |

## Non-RAW input honesty probe

```json
{
  "path": "notraw.jpg",
  "bytes": 21748,
  "detectFormat": null,
  "supportsFile": false,
  "open": {
    "error": "UnsupportedFormatError: unsupported or unrecognised file format: no recognisable header"
  }
}
```

## Full-frame decode matrix (median of 3 for linear f32 / rgba8, single run otherwise)

| File | Format | Sensor layout | CFA | Output px | Input MB | raw-u16 ms | normalized ms | linear f32 ms (out MB) | linear f16 ms | linear-rgb16 ms | rgba8 ms (out MB) | display rgb16 ms | region 1200×800 ms | Backend | Warnings |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | CR3 | bayer | RGGB | 4320×2880 | 14.1 | 195.9 | 189.1 | 261.3 (142.4) | 248.8 | 293.3 | 372.9 (47.5) | 443.7 | — | CPU WASM SIMD128 x1 thread | 0 |
| cr2_canon_1000d | CR2 | bayer | RGGB | 3888×2592 | 10.5 | 80.9 | 110.3 | 188.1 (115.3) | 160.6 | 201.4 | 252.5 (38.4) | 315 | — | CPU WASM SIMD128 x1 thread | 0 |
| raf_fuji_xt4 | RAF | x-trans | GGRGGBGGBGGRBRGRBGGGBGGRGGRGGBRBGBRG | 6240×4160 | 25.7 | 559 | 583.9 | 1071 (297.1) | 1011.6 | 1185.7 | 1354.9 (99) | 1404.8 | — | CPU WASM SIMD128 x1 thread | 0 |
| nef_nikon_z6 | NEF | bayer | RGGB | 4528×3018 | 12.9 | 2332.1 | 562.7 | 588 (156.4) | 4792.5 | 633.9 | 459.1 (52.1) | 971.6 | — | CPU WASM SIMD128 x1 thread | 0 |
| arw_sony_a7m3 | ARW | bayer | RGGB | 6000×4000 | 24.5 | 59 | 187.1 | 576.4 (274.7) | 588 | 623.8 | 657.7 (91.6) | 763.6 | — | CPU WASM SIMD128 x1 thread | 0 |
| orf_olympus_em10 | ORF | bayer | RGGB | 4608×3456 | 14.6 | 3623.6 | 785.3 | 653.7 (182.3) | 1077.4 | 465.3 | 532.5 (60.8) | 934.7 | — | CPU WASM SIMD128 x1 thread | 0 |
| dng_ricoh_gr3 | DNG | bayer | RGGB | 6000×4000 | 31.8 | 1675.7 | 2496.2 | 1374.2 (274.7) | 565.8 | 716 | 753.1 (91.6) | 4692.6 | — | CPU WASM SIMD128 x1 thread | 0 |

## Precision vs f32

| File | f32 output MB | f16 output MB | f16 MAE | f16 maxAbs | f16 >0.01 px | f16 >0.05 px | f16 sRGB8 differing px | f16 mean code diff | linear-rgb16 MAE | linear-rgb16 maxAbs | linear-rgb16 >0.01 px | linear-rgb16 >0.05 px | linear-rgb16 sRGB8 differing px | linear-rgb16 max code diff |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 142.4 | 71.2 | 0.000011 | 0.000244 | 0 | 0 | 0.54% | 1 | 0.000004 | 0.010542 | 2 | 0 | 0.41% | 1 |
| cr2_canon_1000d | 115.3 | 57.7 | 0.000017 | 0.0003 | 0 | 0 | 0.66% | 1 | 0.000004 | 0.172897 | 87 | 11 | 0.23% | 1 |
| raf_fuji_xt4 | 297.1 | 148.5 | 0.000011 | 0.000488 | 0 | 0 | 0.56% | 1 | 0.000014 | 0.149639 | 16766 | 5316 | 0.33% | 1 |
| nef_nikon_z6 | 156.4 | 78.2 | 0.000017 | 0.000488 | 0 | 0 | 0.63% | 1 | 0.000005 | 0.117692 | 626 | 31 | 0.26% | 1 |
| arw_sony_a7m3 | 274.7 | 137.3 | 0.000026 | 0.000488 | 0 | 0 | 0.77% | 1 | 0.000171 | 0.459894 | 229907 | 102871 | 0.17% | 1 |
| orf_olympus_em10 | 182.3 | 91.1 | 0.000017 | 0.000244 | 0 | 0 | 0.65% | 1 | 0.000004 | 0.050927 | 66 | 1 | 0.21% | 1 |
| dng_ricoh_gr3 | 274.7 | 137.3 | 0.000019 | 0.000474 | 0 | 0 | 0.69% | 1 | 0.000004 | 0.426283 | 43 | 5 | 0.23% | 1 |

## Demosaic variants (linear-rgb f32, diff vs `auto`)

| File | bilinear ms | half-size ms | edge-aware ms | ahd ms | ppg ms | rcd ms | edge-aware differing px | edge-aware mean code Δ | ahd differing px | ahd mean code Δ | bilinear vs auto | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 271.2 | 150.7 | 1007.8 | 793.2 | 497.9 | 500.6 | 39.34% | 1.3 | 43.25% | 1.3 | identical |  |
| cr2_canon_1000d | 180.7 | 88.5 | 997.4 | 594.3 | 389.2 | 354 | 64.06% | 3.9 | 68.22% | 3.9 | identical |  |
| raf_fuji_xt4 | 1279.6 | 800.9 | 3078.1 | 3614.4 | — | — | 57.86% | 1.7 | 57.86% | 1.7 | identical |  |
| nef_nikon_z6 | 1550.6 | 628.2 | 3273.3 | 1442.1 | 754.4 | 572.8 | 25.95% | 1.3 | 28.23% | 1.3 | identical |  |
| arw_sony_a7m3 | 1082.5 | 167 | 2915.1 | 3420.7 | 1435.1 | 8004.2 | 83.39% | 4 | 82.26% | 4.3 | identical |  |
| orf_olympus_em10 | 3827.2 | 900.3 | 4209.7 | 12295.7 | 10537.2 | 6392.2 | 60.91% | 2.4 | 65.82% | 2.4 | identical |  |
| dng_ricoh_gr3 | 17110.8 | 1899.9 | 7530.1 | 10913.4 | 16399.1 | 8815.5 | 64.27% | 3.2 | 69.53% | 3.2 | identical |  |

## Highlight recovery (linear-rgb f32, diff vs `clip`)

| File | neutral ms | blend ms | reconstruct ms | clip max linear | clipped px | neutral differing px | blend differing px | reconstruct differing px |
|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 335.5 | 369.2 | 499.3 | 0.5537 | 0 | 0.00% | 0.00% | 0.00% |
| cr2_canon_1000d | 254.2 | 235.5 | 293.2 | 0.8103 | 0 | 0.00% | 0.00% | 0.00% |
| raf_fuji_xt4 | 3364.7 | 1882.1 | 1619 | 0.876 | 438 | 0.00% | 0.00% | 0.00% |
| nef_nikon_z6 | 377.9 | 537.9 | 729.6 | 1 | 49 | 0.00% | 0.00% | 0.00% |
| arw_sony_a7m3 | 11711.1 | 6476.6 | 6344.6 | 1 | 6068 | 0.14% | 0.54% | 0.79% |
| orf_olympus_em10 | 3867.5 | 5670.7 | 4582.7 | 0.61 | 0 | 0.00% | 0.00% | 0.00% |
| dng_ricoh_gr3 | 7992.8 | 2199.9 | 7673.5 | 0.7826 | 0 | 0.00% | 0.00% | 0.00% |

## White balance variants (linear-rgb f32, mean linear RGB)

| File | as-shot ms | daylight ms | auto ms | as-shot mean RGB | daylight mean RGB | auto mean RGB | daylight differing px | auto differing px |
|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 261.3 | 341.1 | 411.6 | 0.058, 0.064, 0.069 | 0.054, 0.062, 0.076 | 0.070, 0.066, 0.057 | 83.59% | 85.31% |
| cr2_canon_1000d | 188.1 | 202.6 | 216 | 0.085, 0.111, 0.102 | 0.092, 0.114, 0.093 | 0.136, 0.120, 0.070 | 87.96% | 99.24% |
| raf_fuji_xt4 | 1071 | 1490.6 | 1691.4 | 0.064, 0.070, 0.050 | 0.075, 0.076, 0.027 | 0.075, 0.061, 0.075 | 99.54% | 99.84% |
| nef_nikon_z6 | 588 | 323.6 | 306.3 | 0.130, 0.091, 0.068 | 0.263, 0.092, 0.023 | 0.093, 0.088, 0.088 | 89.89% | 93.01% |
| arw_sony_a7m3 | 576.4 | 4407.4 | 5983.2 | 0.148, 0.148, 0.148 | 0.202, 0.157, 0.102 | 0.145, 0.147, 0.152 | 99.49% | 67.15% |
| orf_olympus_em10 | 653.7 | 9081 | 9241.6 | 0.097, 0.094, 0.103 | 0.125, 0.094, 0.091 | 0.098, 0.096, 0.097 | 87.47% | 81.64% |
| dng_ricoh_gr3 | 1374.2 | 6843.3 | 11876 | 0.096, 0.106, 0.124 | 0.116, 0.111, 0.098 | 0.121, 0.110, 0.098 | 93.97% | 90.20% |

## LibRaw-Wasm reference decode (LibRaw defaults: camera WB, sRGB, 8-bit)

| File | flashraw rgba8 ms | LibRaw open ms | LibRaw imageData ms | LibRaw px | Bits | Result |
|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 372.9 | 440.6 | 1098.8 | 4319×2879 | 8 | ok |
| cr2_canon_1000d | 252.5 | 120 | 1061.5 | 3906×2602 | 8 | ok |
| raf_fuji_xt4 | 1354.9 | 3720.7 | 41594.5 | 6246×4170 | 8 | ok |
| nef_nikon_z6 | 459.1 | 203.1 | 2218.7 | 4548×3030 | 8 | ok |
| arw_sony_a7m3 | 657.7 | 629.8 | 2516.2 | 6024×4024 | 8 | ok |
| orf_olympus_em10 | 532.5 | 3267 | 4166.2 | 4640×3472 | 8 | ok |
| dng_ricoh_gr3 | 753.1 | 1010.7 | 3240.5 | 6020×4024 | 8 | ok |

## Warnings / source integrity

- **cr3_canon_r6m3**: incomplete=false, source=sensor, warnings=[]
- **cr2_canon_1000d**: incomplete=false, source=sensor, warnings=[]
- **raf_fuji_xt4**: incomplete=false, source=sensor, warnings=[]
- **nef_nikon_z6**: incomplete=false, source=sensor, warnings=[]
- **arw_sony_a7m3**: incomplete=false, source=sensor, warnings=[]
- **orf_olympus_em10**: incomplete=false, source=sensor, warnings=[]
- **dng_ricoh_gr3**: incomplete=false, source=sensor, warnings=[]

Generated from results/raw/*.json by scripts/summarize-raw.mjs
