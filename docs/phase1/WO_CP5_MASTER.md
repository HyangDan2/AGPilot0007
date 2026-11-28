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

- **CP5-01 Performance baseline (Q01).** Issued at CP5 start; PO addendum adds the full metric list (cold/warm start, 12/24MP, RAW decode+develop, slider p50/p95, preview FPS, export time + peak memory, memory growth on repeat edit/export, initial download + precache). Deliverable: numbers table + top-5 bottlenecks + proposed budgets; measurement only.
- **CP5-02 Targeted optimization (Q00 assigns).** Ownership: Q01 rendering/resources; Q02 tiled lens blur + boundary coherence; Q03 RAW develop + video; Q04 workspace/boot/lazy/PWA. Only measured-significant work.
- **CP5-03 Compatibility (Q05B).** Desktop + mobile emulation matrix; real-device only where hardware exists; UNVERIFIED marks otherwise.
- **CP5-04 RC preparation (Q01 + Q04 + Q00 docs).** As PO list above.
- **G5 (Q05B).** As PO list above; single full regression.

## Ledger

- 2026-11-28 CP5 opened after CP4 CLOSED at `ea4974b` (PO Closure Order). CP5-01 issued to Q01 (baseline measurement only).
- 2026-11-28 **WO-P1-CP5 (PO) received and frozen**: feature freeze; BL-CP4-02 in scope; BL-CP4-03 → Phase 2; CP5-01 metrics expanded (cold/warm start, preview FPS, repeated edit/export memory growth, initial download + precache); CP5-02 ownership matrix; CP5-03 emulation-first / UNVERIFIED policy; CP5-04 RC checklist; G5 single full regression by Q05B; Q00 autonomous inside CP5; main/beta locked.
