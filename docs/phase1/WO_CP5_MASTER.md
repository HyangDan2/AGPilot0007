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

## G5 Exit Criteria (proposal)

| # | Criterion | Evidence source |
| --- | --- | --- |
| 1 | Full Playwright matrix green at the release SHA | Q05B full run |
| 2 | Perf budgets met or explicitly accepted (cold load, RAW open, slider p95, export times, memory) | CP5-01 + Q05B spot |
| 3 | Photo-only boot network audit: 0 video-engine requests; precache decision recorded | Q04 audit |
| 4 | Real-device matrix PASS (or documented gap with fallback) | CP5-03 |
| 5 | RC artifacts ready: version, release notes, dist-beta parity, blobs 6/6 | CP5-04 |
| 6 | Backlog disposition recorded (must/should/won't) | CP5-02 |

## Milestones

- **CP5-01 Performance baseline (Q01).** Measure at `ea4974b` (desktop chromium + mobile-chromium emulation): cold load; RAW 6000×4000 open/first render; JPEG 24MP/12MP open; slider drag p50/p95 with optical+local active and with lens blur on/off; develop settle latency; JPEG full-res export (lens on/off), tiled export, video 1080p 2 s export; peak JS heap. Deliverable: numbers table + ranked top-5 bottlenecks + proposed budgets. No optimization code in this step.
- **CP5-02 Backlog triage (Q00 + PO).** Proposal: must-have = none new; should-have (post-release) = BL-CP4-02 tiled-export lens blur, PWA precache size trim, re-develop debounce tuning; won't for RC = BL-CP4-03 video lens blur. PO confirms.
- **CP5-03 Real-device compatibility (Q05B + PO hardware).** iOS Safari + Android Chrome real-device checklist (open RAW, lens blur, develop, video export) once devices/access are provided; until then, emulated matrix + documented gap.
- **CP5-04 RC preparation (Q01 + Q04).** Version bump, release notes, precache audit, dist-beta parity build, final network audit; full regression scheduled only here.

## Ledger

- 2026-11-28 CP5 opened after CP4 CLOSED at `ea4974b` (PO Closure Order). CP5-01 issued to Q01 (baseline measurement only).
