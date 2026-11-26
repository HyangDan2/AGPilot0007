# CP1 Closure Ledger — G1 Evidence (Q01 Core Engine)

Status: IN PROGRESS · Owner: Q01 · Auditor: Q05/Supervisor
Basis: `feature/phase1-pro-engine` @ `c67d533` (CP2-01 residual `c67d533`, CP1 closure `0ca7ec7`, CP2-00 `3f3fea6`, CP1.1/SC-01 `21fd6dc`, beta merge `2a45290`)
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
| CP2-01-P2-03 | `k1=-0.5` accepted by Q01 validator but rejected by Q02 invertibility gate | Closed | `c67d533`; Q02 §12.1.1 gate adopted in `validateOpticalTransform` (radial 257 samples r≤1.5 > 1e-6; tangential 17×17 Jacobian det > 1e-6); CORE-05 boundary tests reject `k1=-0.5`/`-0.16` and accept `k1=-0.1`/`1.5` |

## 2. OPT (Q02)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| OPT-PoC | Optical PoC E2E and contract adoption | Closed (ENG/IND) | Q02 report: 17 optical E2E passed; contract SHA alignment below |
| CP2-01-P2-02 | `OPTICAL_POC.md` harness-cap contradiction / extrapolated worst case | Closed — Q02 (IND) | Q02 `5e5a472`; harness cap 8 documented as a harness limit and the 32-minute extrapolation separated from measured results |

## 3. IMG (Q03)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| IMG-verify | Imaging verify 12/12 + mirror hash | Closed (IND) | Supervisor evidence in MASTER_STATUS |
| IMG-RAW | RAW assertions 114/114 | Closed (IND) | Supervisor evidence |
| IMG-video | Video suite assertions | G1 non-blocking — Q03/Q05 | Engineer claim only; no independent rerun. G1 does not depend on this row |
| CP2-01-P2-04 | 4.84 MB derived results committed; `check:q01-sync` sibling-path dependency | Closed — Q03 (IND) | Q03 `b1a5f10`; 39 derived JPGs removed, results 0.92 MB, `Q01_CONTRACT_PATH` portability |

## 4. APP (Q04)

| ID | Item | State | Evidence |
| --- | --- | --- | --- |
| IF-01 | Export cancellation | Closed on Q01 side | Q01 wires `ExportControl` (`0ca7ec7`); Q04 batch must consume the same API |
| IF-03 | Shared selection state | Deferred | PO decision; no CP1.1 consumer (INTEGRATION_GUIDE §0/§4.1) |
| IF-05 | Recommendation registry | Deferred | PO decision; no CP1.1 consumer |
| APP-perf | Perf gate 4/4 serial, thresholds unchanged | Closed (IND) | MASTER_STATUS Q04 row |
| CP2-01-P3-01 | Q04 edited Q01-owned HARNESS_GUIDE `npm test` row | Closed | `0ca7ec7` HARNESS has 0 IF-01/SC-01 residue rows and no Q04 edits remain |

## 5. E2E — 28-failure disposition

E2E evidence is valid only from an isolated run: `E2E_PORT=5173`, `PW_REUSE_SERVER` unset, no concurrent full suite, host load ≤8 at start, clean tree, logs under `PW_OUTPUT_DIR`.

- Pre-check (`.private/e2e-full-cp2-01-precheck.log`): start 2026-11-27 07:44 KST, HEAD `0ca7ec7`, clean tree, load 6.73, port 5173 free.
- Command: `E2E_PORT=5173 PW_OUTPUT_DIR=.private/e2e-artifacts/q01 npx playwright test`
- Log: `.private/e2e-full-cp2-01.log` · Duration 13.2m
- Result (ENG): **286 passed / 2 failed / 12 skipped** — not a full pass at `0ca7ec7`.
- Failed (both deterministic, mobile only, same root cause):
  - `[mobile-chromium] workflow.spec.ts:4` → `text=Film Studio` resolves to the header `<em>` which `src/index.css` intentionally hides at mobile widths; no visible "Film Studio" text exists on the mobile home.
  - `[mobile-webkit] workflow.spec.ts:4` → same locator/visibility mismatch.
- Mobile branding assertion — Closed at `c67d533`: the assertion was stale, not a product regression. Desktop/tablet keep `text=Film Studio`; mobile projects branch on `test.info().project.name` and assert `.brand`/`.brand-name` = `HD2Lab` and `.brand em` hidden. No test was deleted or skipped.
- Correction run (ENG, isolated): start 2026-11-27 08:02 KST, HEAD `c67d533`, load 2.96, port 5173 free; command `E2E_PORT=5173 PW_OUTPUT_DIR=.private/e2e-artifacts/q01 npx playwright test tests/e2e/workflow.spec.ts`; result **8 passed / 0 failed / 0 skipped** (2 tests × chromium, webkit, mobile-chromium, mobile-webkit) in 19.4s. Full suite not rerun (Q05 owns the final full run).
- Skips (12, intended): geometry-contract non-chromium projects, mobile margarine/viewport-zoom exclusions.
- 28-failure disposition: none of the historical load-induced 5s `toBeVisible` timeouts reproduced in the isolated run; the earlier 28 is classified as INVALID EVIDENCE caused by host load 17–24 and a foreign Vite on 5173. The 2 failures from the 286-run were the deterministic mobile branding locator now corrected above, so the CP2-01 E2E blocker is closed.

## 6. Beta preservation

- `git diff --diff-filter=D --name-only origin/beta..HEAD` → empty (0 deleted files).
- No merge or deployment to `main`/`beta` from this branch.

## 7. Shared contract version consistency

`contractVersion: 1` in `src/engine/contracts/moduleRegistry.ts` is identical across Q01/Q02/Q03/Q04 branches. SHA256 of shared contract files at the 3f3fea6 baseline is identical across all four worktrees:

| File | SHA256 prefix |
| --- | --- |
| `optical.ts` | `8c533031…` (was `2e810dcb…` before the `c67d533` gate adoption) |
| `imageBuffer.ts` | `3f916d96…` |
| `exportControl.ts` | `dfab5a0d…` |
| `masks.ts` | `90153a92…` |
| `moduleRegistry.ts` | `913ebe0e…` |

Q02/Q03/Q04 must re-merge `c67d533` before Q05 signs G1: `optical.ts` now carries the Q02 invertibility gate, so Q02 must confirm its runtime gate and the Q01 contract accept/reject the same coefficient set. ExportModal/recipeV8/test changes remain Q01-only.

## 8. Remaining before G1 declaration

1. Q05 independent full E2E rerun (this ledger §5: 286/2/12 baseline at `0ca7ec7`, mobile blocker closed by the 8/8 workflow run at `c67d533`).
2. Q02/Q03/Q04 re-merge `c67d533` and confirm the new `optical.ts` checksum (`8c533031…`).
3. Q00 G1 verdict; Contract Freeze only after all rows above are evidence-backed.
4. IMG-video remains an engineer claim and is explicitly non-blocking for G1.
