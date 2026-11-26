# CP1 Closure Ledger — G1 Evidence (Q01 Core Engine)

Status: IN PROGRESS · Owner: Q01 · Auditor: Q05/Supervisor
Basis: `feature/phase1-pro-engine` @ `0ca7ec7` (CP2-00 `3f3fea6`, CP1.1/SC-01 `21fd6dc`, beta merge `2a45290`)
Updated: 2026-11-27 KST

This ledger records every CP1 correction relevant to G1. Engineer evidence is marked ENG; independent evidence is marked IND when Supervisor/Q05 supplied it. A row closes only with a commit, test, or PR link.

## 1. CORE (Q01)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| CORE-01 | Registry ordering, metadata copy/freeze, duplicate/cycle rejection | Closed | `tests/engineContractCorrective.test.ts` CORE-01; registry in `src/engine/contracts/moduleRegistry.ts` |
| CORE-02 | Registry-driven RenderPlan activation and fingerprint parity | Closed | CORE-02 tests; `renderPlan.ts`, `renderPlanFingerprint` |
| CORE-03 | ImageBuffer integrity (format/type/length/NaN/GPU owner) + SDR float-only boundary | Closed | CORE-03 tests incl. SC-01 SDR `rgba8`/`rgb16f` rejection; `imageBuffer.ts` |
| CORE-04 | Single geometry order flip→rotate→straighten→crop with forward/inverse mapping | Closed | CORE-04 tests; `geometryMappings.ts`; `tests/e2e/geometry-contract.spec.ts` |
| CORE-05 | OpticalTransform boundary (homography/distortion/perspective), Q02 internal shapes rejected | Closed | CORE-05 tests incl. SC-01 shape rejection; `optical.ts` |
| CORE-06 | Local adjustment mask groups + mask limits | Closed | CORE-06 tests; behavioral limit tests (17th mask / 65th stroke / 1025th point) in `tests/engineContracts.test.ts` |
| CORE-07 | Resource budget/allocation and device guidance | Closed | CORE-07 tests; `resourceBudget.ts` |
| CORE-08 | Resource lifecycle: rollback, idempotent sessions, abandon after context loss | Closed | CORE-08 tests |
| CORE-09 | Recipe version detection, storage key isolation, v1–v7 import policy | Closed | CORE-09 tests; `recipeValidation.ts` |
| CORE-10 | AI output descriptors stay disabled in Phase 1 | Closed | CORE-10 tests; `ai.ts`, empty `CORE_AI_MODULES` |
| SC-01 | Shared contract arbitration (buffer/optical/mask/EditState/IF scope) | Closed | `21fd6dc`; ENGINE_CONTRACT §3.2/§4.1/§5/§6; arbitration tests |
| SC-05-P1-A | `ExportControl` UI wiring (AbortController + Cancel Export + AbortError settlement) | Closed | `0ca7ec7`; `src/components/ExportModal.tsx`; `tests/exportModalCancel.test.tsx` |
| SC-05-P1-B | Recipe v8 flat/malformed geometry rejected instead of silent identity | Closed | `0ca7ec7`; `validateRecipeV8Geometry`; wrapper-reject and JSON round-trip tests |
| CP2-00-P1-01 | Playwright hardcoded port/shared-server reuse | Closed | `3f3fea6`; `playwright.config.ts`; fail-fast check `.private/e2e-reuse-failfast.log` |
| CP2-01-P2-03 | `k1=-0.5` accepted by Q01 validator but rejected by Q02 invertibility gate | Open — Q01/Q02 | Decision required on the shared distortion bound before freeze |

## 2. OPT (Q02)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| OPT-PoC | Optical PoC E2E and contract adoption | Closed (ENG/IND) | Q02 report: 17 optical E2E passed; contract SHA alignment below |
| CP2-01-P2-02 | `OPTICAL_POC.md` harness-cap contradiction / extrapolated worst case | Open — Q02 | Doc correction pending Q02 |

## 3. IMG (Q03)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| IMG-verify | Imaging verify 12/12 + mirror hash | Closed (IND) | Supervisor evidence in MASTER_STATUS |
| IMG-RAW | RAW assertions 114/114 | Closed (IND) | Supervisor evidence |
| IMG-video | Video suite assertions | Unverified — Q03/Q05 | Engineer claim only; no independent rerun |
| CP2-01-P2-04 | 4.84 MB derived results committed; `check:q01-sync` sibling-path dependency | Open — Q03 | Repo hygiene fix pending Q03 |

## 4. APP (Q04)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| IF-01 | Export cancellation | Closed on Q01 side | Q01 wires `ExportControl` (`0ca7ec7`); Q04 batch must consume the same API |
| IF-03 | Shared selection state | Deferred | PO decision; no CP1.1 consumer (INTEGRATION_GUIDE §0/§4.1) |
| IF-05 | Recommendation registry | Deferred | PO decision; no CP1.1 consumer |
| APP-perf | Perf gate 4/4 serial, thresholds unchanged | Closed (IND) | MASTER_STATUS Q04 row |
| CP2-01-P3-01 | Q04 edited Q01-owned HARNESS_GUIDE `npm test` row | Open — Q04 | Q04 to drop the edit; Q01 owns the file |

## 5. E2E — 28-failure disposition

E2E evidence is valid only from an isolated run: `E2E_PORT=5173`, `PW_REUSE_SERVER` unset, no concurrent full suite, host load ≤8 at start, clean tree, logs under `PW_OUTPUT_DIR`.

- Pre-check (`.private/e2e-full-cp2-01-precheck.log`): start 2026-11-27 07:44 KST, HEAD `0ca7ec7`, clean tree, load 6.73, port 5173 free.
- Command: `E2E_PORT=5173 PW_OUTPUT_DIR=.private/e2e-artifacts/q01 npx playwright test`
- Log: `.private/e2e-full-cp2-01.log` · Duration 13.2m
- Result (ENG): **286 passed / 2 failed / 12 skipped** — not a full pass.
- Failed (both deterministic, mobile only, same root cause):
  - `[mobile-chromium] workflow.spec.ts:4` → `text=Film Studio` resolves to the header `<em>` which `src/index.css` intentionally hides at mobile widths; no visible "Film Studio" text exists on the mobile home.
  - `[mobile-webkit] workflow.spec.ts:4` → same locator/visibility mismatch.
  - This is a pre-existing test/design mismatch, not a product regression from CP2-00/01. Fixing it requires a decision: expose mobile branding or change the assertion (test weakening needs PO approval). Owner: Q01 + PO/Q00.
- Skips (12, intended): geometry-contract non-chromium projects, mobile margarine/viewport-zoom exclusions.
- 28-failure disposition: none of the historical load-induced 5s `toBeVisible` timeouts reproduced in the isolated run; the earlier 28 is classified as INVALID EVIDENCE caused by host load 17–24 and a foreign Vite on 5173. The 2 remaining failures are a different, deterministic mobile branding locator/design mismatch (hidden element, not a timeout).

## 6. Beta preservation

- `git diff --diff-filter=D --name-only origin/beta..HEAD` → empty (0 deleted files).
- No merge or deployment to `main`/`beta` from this branch.

## 7. Shared contract version consistency

`contractVersion: 1` in `src/engine/contracts/moduleRegistry.ts` is identical across Q01/Q02/Q03/Q04 branches. SHA256 of shared contract files at the 3f3fea6 baseline is identical across all four worktrees:

| File | SHA256 prefix |
| --- | --- |
| `optical.ts` | `2e810dcb…` |
| `imageBuffer.ts` | `3f916d96…` |
| `exportControl.ts` | `dfab5a0d…` |
| `masks.ts` | `90153a92…` |
| `moduleRegistry.ts` | `913ebe0e…` |

Q02/Q03/Q04 must re-merge `0ca7ec7` (ExportModal/recipeV8/test changes are Q01-only, contracts unchanged) and rerun their gates before Q05 signs G1.

## 8. Remaining before G1 declaration

1. Official isolated E2E verdict (this ledger §5) and Q05 independent rerun.
2. Q02 distortion-bound decision (CP2-01-P2-03) and OPTICAL_POC correction (P2-02).
3. Q03 artifact hygiene (P2-04) and video-suite independent verification.
4. Q04 HARNESS_GUIDE edit removal (P3-01) and IF-01 body reconciliation.
5. Q00 G1 verdict; Contract Freeze only after all rows above are evidence-backed.
