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
| cr3_canon_r6m3 | CR3 | bayer | RGGB | 4320×2880 | 14.1 | 137.6 | 178.3 | 246.9 (142.4) | 248.3 | 300.8 | 368.3 (47.5) | 436.3 | 171.7 | CPU WASM SIMD128 x1 thread | 0 |
| cr2_canon_1000d | CR2 | bayer | RGGB | 3888×2592 | 10.5 | 88.6 | 113.3 | 242.6 (115.3) | 188.6 | 253.6 | 296 (38.4) | 454.9 | 188.3 | CPU WASM SIMD128 x1 thread | 0 |
| raf_fuji_xt4 | RAF | x-trans | GGRGGBGGBGGRBRGRBGGGBGGRGGRGGBRBGBRG | 6240×4160 | 25.7 | 532.6 | 605.3 | 1391.8 (297.1) | 1392.3 | 1583.2 | 1873.2 (99) | 1764.9 | 546.3 | CPU WASM SIMD128 x1 thread | 0 |
| nef_nikon_z6 | NEF | bayer | RGGB | 4528×3018 | 12.9 | 108.8 | 141.1 | 238 (156.4) | 240.1 | 297.9 | 352.5 (52.1) | 459.3 | 346.4 | CPU WASM SIMD128 x1 thread | 0 |
| arw_sony_a7m3 | ARW | bayer | RGGB | 6000×4000 | 24.5 | 104.6 | 194 | 326.4 (274.7) | 327 | 438.9 | 627.2 (91.6) | 713.9 | 100.5 | CPU WASM SIMD128 x1 thread | 0 |
| orf_olympus_em10 | ORF | bayer | RGGB | 4608×3456 | 14.6 | 370.6 | 231.7 | 396.6 (182.3) | 433.6 | 455 | 486.2 (60.8) | 597.1 | 723.7 | CPU WASM SIMD128 x1 thread | 0 |
| dng_ricoh_gr3 | DNG | bayer | RGGB | 6000×4000 | 31.8 | 427.9 | 281.9 | 481.8 (274.7) | 516.2 | 496.6 | 624.5 (91.6) | 800.9 | 320.5 | CPU WASM SIMD128 x1 thread | 0 |

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
| cr3_canon_r6m3 | 261.8 | 194.2 | 1069.4 | 992.9 | 672.6 | 1216.3 | 39.34% | 1.3 | 43.25% | 1.3 | identical |  |
| cr2_canon_1000d | 236.6 | 134.8 | 1263.8 | 594.6 | 390.3 | 411.2 | 64.06% | 3.9 | 68.22% | 3.9 | identical |  |
| raf_fuji_xt4 | 2085.4 | 1140.8 | 6466.3 | 3525 | — | — | 57.86% | 1.7 | 57.86% | 1.7 | identical |  |
| nef_nikon_z6 | 291.4 | 154.1 | 1250.5 | 953.2 | 705.1 | 796.9 | 25.95% | 1.3 | 28.23% | 1.3 | identical |  |
| arw_sony_a7m3 | 930.7 | 144.5 | 2669.3 | 1535 | 876.5 | 918.5 | 83.39% | 4 | 82.26% | 4.3 | identical |  |
| orf_olympus_em10 | 630.2 | 340.8 | 2271 | 1260.5 | 993.7 | 621.9 | 60.91% | 2.4 | 65.82% | 2.4 | identical |  |
| dng_ricoh_gr3 | 631.6 | 279.1 | 2147.2 | 1458 | 1238.8 | 914.6 | 64.27% | 3.2 | 69.53% | 3.2 | identical |  |

## Highlight recovery (linear-rgb f32, diff vs `clip`)

| File | neutral ms | blend ms | reconstruct ms | clip max linear | clipped px | neutral differing px | blend differing px | reconstruct differing px |
|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 1272.4 | 752.4 | 529.9 | 0.5537 | 0 | 0.00% | 0.00% | 0.00% |
| cr2_canon_1000d | 259.1 | 311.5 | 373.1 | 0.8103 | 0 | 0.00% | 0.00% | 0.00% |
| raf_fuji_xt4 | 1961.6 | 1726.4 | 3152.9 | 0.876 | 438 | 0.00% | 0.00% | 0.00% |
| nef_nikon_z6 | 476.8 | 484.8 | 664.9 | 1 | 49 | 0.00% | 0.00% | 0.00% |
| arw_sony_a7m3 | 582.4 | 675.2 | 817.9 | 1 | 6068 | 0.14% | 0.54% | 0.79% |
| orf_olympus_em10 | 531 | 591.8 | 714.9 | 0.61 | 0 | 0.00% | 0.00% | 0.00% |
| dng_ricoh_gr3 | 719.1 | 776.4 | 855.5 | 0.7826 | 0 | 0.00% | 0.00% | 0.00% |

## White balance variants (linear-rgb f32, mean linear RGB)

| File | as-shot ms | daylight ms | auto ms | as-shot mean RGB | daylight mean RGB | auto mean RGB | daylight differing px | auto differing px |
|---|---|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 246.9 | 315 | 323.3 | 0.058, 0.064, 0.069 | 0.054, 0.062, 0.076 | 0.070, 0.066, 0.057 | 83.59% | 85.31% |
| cr2_canon_1000d | 242.6 | 293.3 | 223.3 | 0.085, 0.111, 0.102 | 0.092, 0.114, 0.093 | 0.136, 0.120, 0.070 | 87.96% | 99.24% |
| raf_fuji_xt4 | 1391.8 | 6603.3 | 3092.3 | 0.064, 0.070, 0.050 | 0.075, 0.076, 0.027 | 0.075, 0.061, 0.075 | 99.54% | 99.84% |
| nef_nikon_z6 | 238 | 330.5 | 441 | 0.130, 0.091, 0.068 | 0.263, 0.092, 0.023 | 0.093, 0.088, 0.088 | 89.89% | 93.01% |
| arw_sony_a7m3 | 326.4 | 656.4 | 567.4 | 0.148, 0.148, 0.148 | 0.202, 0.157, 0.102 | 0.145, 0.147, 0.152 | 99.49% | 67.15% |
| orf_olympus_em10 | 396.6 | 536.8 | 577.5 | 0.097, 0.094, 0.103 | 0.125, 0.094, 0.091 | 0.098, 0.096, 0.097 | 87.47% | 81.64% |
| dng_ricoh_gr3 | 481.8 | 576.9 | 613.4 | 0.096, 0.106, 0.124 | 0.116, 0.111, 0.098 | 0.121, 0.110, 0.098 | 93.97% | 90.20% |

## LibRaw-Wasm reference decode (LibRaw defaults: camera WB, sRGB, 8-bit)

| File | flashraw rgba8 ms | LibRaw open ms | LibRaw imageData ms | LibRaw px | Bits | Result |
|---|---|---|---|---|---|---|
| cr3_canon_r6m3 | 368.3 | 163.6 | 988.7 | 4319×2879 | 8 | ok |
| cr2_canon_1000d | 296 | 157.4 | 1393.2 | 3906×2602 | 8 | ok |
| raf_fuji_xt4 | 1873.2 | 3007.2 | 29126.5 | 6246×4170 | 8 | ok |
| nef_nikon_z6 | 352.5 | 751 | 3375.1 | 4548×3030 | 8 | ok |
| arw_sony_a7m3 | 627.2 | 448.6 | 2526.4 | 6024×4024 | 8 | ok |
| orf_olympus_em10 | 486.2 | 147.9 | 1603.6 | 4640×3472 | 8 | ok |
| dng_ricoh_gr3 | 624.5 | 355.4 | 2486.8 | 6020×4024 | 8 | ok |

## Warnings / source integrity

- **cr3_canon_r6m3**: incomplete=false, source=sensor, warnings=[]
- **cr2_canon_1000d**: incomplete=false, source=sensor, warnings=[]
- **raf_fuji_xt4**: incomplete=false, source=sensor, warnings=[]
- **nef_nikon_z6**: incomplete=false, source=sensor, warnings=[]
- **arw_sony_a7m3**: incomplete=false, source=sensor, warnings=[]
- **orf_olympus_em10**: incomplete=false, source=sensor, warnings=[]
- **dng_ricoh_gr3**: incomplete=false, source=sensor, warnings=[]

Generated from results/raw/*.json by scripts/summarize-raw.mjs
