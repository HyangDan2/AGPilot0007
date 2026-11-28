# WO-P1-CP5 — Release Qualification (Ledger)

Owner: Q00 Supervisor. Phase-1 CP5. Baseline: `ea4974b` (CP4 CLOSED).
Policy: Lean Engineering v1.1. Evidence reuse; no full regression before the release gate.

## Scope (PO direction, 2026-11-28)

1. **Performance optimization** — measure first, then fix the top user-facing bottlenecks.
2. **Remaining must-have features** — decide against release criteria (Q00 proposal + PO confirmation); non-must items stay backlog.
3. **Real-device compatibility** — real iOS Safari / Android Chrome where available; emulated mobile matrix otherwise (with the gap stated).
4. **Release Candidate preparation** — versioning, release notes, precache/network audit, dist-beta parity, G5 full regression.

## Constraints (unchanged)

- Non-AI scope; no server upload / new backend.
- Existing photo editing behavior preserved.
- `main`/`beta` merge and deploy forbidden before explicit PO approval.
- PR #17 stays Draft; no per-branch PRs.
- Fixtures local-only. Lean: no re-verification of accepted work, no duplicate QA on the same SHA.

## G5 Exit Criteria (PO order 2026-11-28)

| # | Criterion | Evidence source |
| --- | --- | --- |
| 1 | Full Unit / E2E regression once at the release SHA | Q05B |
| 2 | Production + Beta builds succeed; preview/export parity; data + Recipe v1–v9 compatibility | Q05B |
| 3 | Perf before/after comparison; required features functional | CP5-02 + Q05B |
| 4 | Photo-only boot network audit 0 video-engine requests; PWA cache update verified | Q04 audit |
| 5 | Browser support/limits documented; real-device items UNVERIFIED where hardware absent | CP5-03 |
| 6 | RC artifacts: version, release notes, user guide/feature notes, dependency/license notices, Beta deploy + rollback plan, workflow auto-run conditions | CP5-04 |
| 7 | P0 and release-blocking P1 defects = 0 | Q05B |

## PO Order — WO-P1-CP5 (2026-11-28, binding)

1. **Feature Freeze** — no new features. In scope as completion of existing features: BL-CP4-02 tiled-export lens blur; PWA precache + initial-load optimization; RAW develop debounce + memory optimization. BL-CP4-03 (video lens blur) → Phase 2 backlog. No arbitrary expansion or architecture redesign.
2. **CP5-01 Performance Baseline (Q01)** — as ordered, plus metrics: Cold Start / Warm Start; 12MP / 24MP photo processing; RAW decode + develop; slider response p50/p95; preview FPS; export time + peak memory; memory growth after repeated edit/export; initial download + PWA precache size. Identify top-5 bottlenecks and set improvement priority.
3. **CP5-02 Targeted Optimization (Q00 assigns from measurements)** — Q01 rendering/resource management; Q02 tiled-export lens blur + boundary coherence; Q03 RAW develop + video processing; Q04 workspace, initial loading, lazy loading, PWA. No image-quality or feature regression for perf; skip work without meaningful measured effect.
4. **CP5-03 Compatibility** — desktop Chromium/WebKit; mobile Chromium/WebKit emulation; real iOS Safari / Android Chrome only where hardware available; do not stop development for missing devices; mark UNVERIFIED; PO does real-device acceptance after Beta.
5. **CP5-04 Release Candidate** — version + release notes; user guide + new-feature notes; Recipe v1–v9 compatibility; dependency/license notices; per-browser support/limits; PWA cache update verification; Beta deploy + rollback plan; deploy workflow auto-run conditions.
6. **G5 Release Gate (Q05B)** — full regression once; prod/beta builds; data integrity + recipe compatibility; preview/export parity; perf before/after; required features; P0 + release-blocking P1 = 0. Reuse PASS evidence; no duplicate verification. On G5 completion submit RC SHA + 5-part Lean report.
7. **Authorization** — CP5 internal work and integration are Q00-autonomous. Main/Beta merge and actual deployment forbidden before PO approval.

## Milestones

- **CP5-01 Performance baseline (Q01).** **CLOSED 2026-11-28** — numbers table, gap-fill (drag FPS, lens preview, top-5) delivered at `8d30e9c`; budgets confirmed below.
- **CP5-02 Targeted optimization (Q00 assigns).** Ownership: Q01 rendering/resources; Q02 tiled lens blur + boundary coherence; Q03 RAW develop + video; Q04 workspace/boot/lazy/PWA. Only measured-significant work. **ISSUED 2026-11-28** — see Ledger.
- **CP5-03 Compatibility (Q05B).** Desktop + mobile emulation matrix; real-device only where hardware exists; UNVERIFIED marks otherwise.
- **CP5-04 RC preparation (Q01 + Q04 + Q00 docs).** As PO list above.
- **G5 (Q05B).** As PO list above; single full regression.

## Ledger

- 2026-11-28 CP5 opened after CP4 CLOSED at `ea4974b` (PO Closure Order). CP5-01 issued to Q01 (baseline measurement only).
- 2026-11-28 **WO-P1-CP5 (PO) received and frozen**: feature freeze; BL-CP4-02 in scope; BL-CP4-03 → Phase 2; CP5-01 metrics expanded (cold/warm start, preview FPS, repeated edit/export memory growth, initial download + precache); CP5-02 ownership matrix; CP5-03 emulation-first / UNVERIFIED policy; CP5-04 RC checklist; G5 single full regression by Q05B; Q00 autonomous inside CP5; main/beta locked.
- 2026-11-28 **CP5-01 baseline accepted** from Q01 at `8d30e9c` (code `ea4974b`; M1 headless Chromium/ANGLE Metal; 3-run medians): cold TTI 75 ms; index 195.7 KB transfer / 692.2 KB raw; precache 73 files / 12,937.85 KiB; JPEG 24MP open 326/248 ms (12MP 309/201); RAW 6000×4000 paint 872 ms / 135.7 MB heap (warm 678 ms / 185 MB — retention flag); mobile Pixel-7 RAW paint 2,257 ms (emulation); slider p50 16.7 / p95 33.3 ms but RAW develop settle 1,710 ms (≈3.4× budget); exports 24MP lens off 569 ms / 22 MB, lens on 1,543 ms / 308 MB. Budgets proposed (cold TTI p95 ≤250 ms, RAW ≤1,000 ms, settle ≤500 ms, heap ≤350 MB export). SwiftShader headless rejected as perf-valid (3.5 s vs 0.33 s).
- 2026-11-28 Addendum narrowed to **gap-fill only** (PASS reused, no re-measure): drag FPS 12/24MP, 10× edit→export retained heap, warm-start TTI if missing, **top-5 bottleneck ranking** (CP5-02 input), optional `CP5_BASELINE.md`.
- 2026-11-28 **CP5-01 CLOSED.** Gap-fill delivered (drag 55/56 fps, lens preview adds no measurable frame cost, top-5 ranking). Budgets **confirmed by Q00**: TTI p95 ≤250 ms; JPEG 24MP ≤400 ms; RAW 6000×4000 ≤1,000 ms; first-session ≤1,500 ms; slider p95 ≤33 ms (20 ms is stretch, not required); **RAW develop settle ≤500 ms** (CP5-02 gate); exports ≤1 s lens-off 24MP / ≤2.5 s lens-on / ≤3 s tiled 20MP / video ≤clip+1 s; JS heap ≤350 MB per export, RAW session steady ≤200 MB. Still open: 10× edit→export retention and warm-start TTI → folded into Q01 CP5-02 evidence.
- 2026-11-28 **CP5-02 issued (measured-significant only).** Q03: RAW develop settle 1,710 → ≤500 ms (breakdown first, no blind caching), plus warm re-open heap retention (135.7 → 185 MB flag). Q02: lens-ON tiled export (BL-CP4-02, feature completion) — 1,543 ms / 307.8 MB heap, seam/boundary coherence + parity vs single-pass; perf ≤2.5 s retained, heap target ≤150 MB if achievable. Q01: fresh-session first image 1,260 ms vs 326 ms warm (shader/pipeline warmup, no boot-manifest edits) + export/RAW heap retention + PO-mandated 10× retention metric. Q04: precache 12,937.85 KiB / 73 files + 218.3 KB first-session LUT — initial-load/PWA only if measurable, offline capability preserved. **Skipped:** slider (budget met, no measured headroom), video processing (2,144 ms < clip+1 s), mobile emulation perf (CP5-03 verification only, UNVERIFIED on real hardware).
- 2026-11-28 Seam rule for CP5-02: Q02 proposals that touch renderer/exportControl land via Q01; contracts frozen (6 blobs); no cross-owner edits without Q00 WO.
- 2026-11-28 Q01 gap-fill PASS (reused artifacts, no re-runs) + `docs/phase1/CP5_BASELINE.md` accepted (`aa343df`, docs-only). Warm TTI 62.3 ms (14/14 SW-served, 0 B); 10× edit→export retained +0.93 MB then flat — no JS-heap leak (GPU UNVERIFIED); drag 61–64 fps lens on/off; precache 24,082.93 KiB raw / 12,937.85 KiB compressed.
- 2026-11-28 CP5-02 orders delivered: **Q03** (develop settle breakdown → ≤500 ms; warm-reopen heap), **Q02** (lens-ON tiled export BL-CP4-02 + seam/parity + depth/psf release ≤200 MB floor; optional mask-raster cache only with pixel parity), **Q01** (idle pipeline warm-up, fresh open ≤800 ms, TTI ≤250 ms, pixel parity, 0 video-engine boot requests; integrator for Q02 renderer proposals). **Q04 pending** (precache/LUT).
