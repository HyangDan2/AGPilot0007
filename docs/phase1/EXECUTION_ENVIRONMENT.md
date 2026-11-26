# Execution Environment & QA Job Scheduling — WO-CP2-00

Status: policy ACTIVE · Config remediation owner: Q01 · Auditor: Q05
Updated: 2026-11-27 KST

## 1. Isolation Matrix

| Agent | Working directory | Branch | Vite/Playwright port | E2E output |
| --- | --- | --- | --- | --- |
| Q00 | `/Users/jaehyukshim/QoderWS/AGPilot0007-q00` | `feature/phase1-pro-engine` (docs only) | 5673 (not used for E2E) | n/a |
| Q01 | `/Users/jaehyukshim/AGWS/AGPilot0007-phase1` | `feature/phase1-pro-engine` | **5173** | `.private/e2e-artifacts/q01` |
| Q02 | `/Users/jaehyukshim/QoderWS/AGPilot0007-wt/feature-phase1-q02-optical` | `feature/phase1-q02-optical` | **5273** | `.private/e2e-artifacts/q02` |
| Q03 | `/Users/jaehyukshim/AGWS/AGPilot0007-q03-imaging` | `feature/phase1-q03-imaging` | **5373** | `.private/e2e-artifacts/q03` |
| Q04 | `/Users/jaehyukshim/QoderWS/AGPilot0007-q04` | `feature/phase1-q04-application` | **5473** | `.private/e2e-artifacts/q04` |
| Q05 | `/Users/jaehyukshim/AGPilot0007-qa` (new clone) | detached `origin/feature/phase1-pro-engine` + tested PR heads | **5573** | `.private/e2e-artifacts/q05` |

Each agent uses its own clone/worktree. Sharing a dev server, reusing another agent's Vite process, or running two full E2E suites concurrently is forbidden.

## 2. Current Config Gaps (verified at `21fd6dc`)

`playwright.config.ts`:

- `baseURL: 'http://localhost:5173'` — hardcoded.
- `webServer.command: 'npm run dev'` — always port 5173.
- `webServer.reuseExistingServer: !process.env.CI` — a foreign branch's server on 5173 is silently reused.
- `outputDir: '.private/e2e-artifacts'` — no per-agent separation.

Consequences already observed: Q01's full-suite run reused Q02's Vite server on 5173, and parallel SwiftShader runs produced order-dependent failures (6 then 3 different tests, passing serially).

## 3. Required Config Contract (Q01 implements)

1. `E2E_PORT` (default `5173`) drives `baseURL` and the webServer command:
   `npm run dev -- --port ${E2E_PORT} --strictPort`.
2. `reuseExistingServer` defaults to `false`; opt in only with `PW_REUSE_SERVER=1`.
3. `outputDir` from `PW_OUTPUT_DIR`, default `.private/e2e-artifacts`.
4. Optional `PW_PROJECT` for project selection; no change to `workers: 1` and `retries: 0`.
5. Document the variables in `docs/HARNESS_GUIDE.md` (Q01-owned) and keep commands copy-pasteable.
6. Do not weaken timeouts, assertions, retries, or test selection.

Acceptance for WO-CP2-00:

- With `E2E_PORT=5173` and `E2E_PORT=5273`, two agents can start servers simultaneously; `lsof -nP -iTCP:<port>` shows different PIDs.
- With port occupied by another branch's server and `PW_REUSE_SERVER` unset, the run fails fast instead of reusing it.
- `PW_OUTPUT_DIR` isolates traces/screenshots per agent.
- Unit tests are unaffected (`npm test` uses Vitest config only).

## 4. Pre-run Verification (every official evidence run)

Record in the report:

1. `pwd` and `git rev-parse HEAD` (must match the claimed SHA).
2. `git status --porcelain` (official runs must start clean; E2E-generated `docs/screenshots/*.png` must be reverted, never committed).
3. `lsof -nP -iTCP:<E2E_PORT> -sTCP:LISTEN` (must be empty before the run).
4. Start time, host load average, and the exact command.
5. Full output log path under the agent's `PW_OUTPUT_DIR`.

A run that shares a server, reuses another branch's process, or runs concurrently with another full suite is not acceptable evidence, even if it is green.

## 5. QA Job Scheduling Policy

| Slot | Job | Concurrency |
| --- | --- | --- |
| A | Full Chromium E2E (single agent) | exactly 1 at a time |
| B | Optical/geometry E2E (Q02) | may run with unit tests, not with Slot A |
| C | Unit tests (Vitest) | up to 2 agents concurrently |
| D | Perf gate (`npm run test:perf`, single worker) | strictly serial, host load < 8 |
| E | Build / build:beta | serial with Slot A on the same host |
| F | RAW/video suite (Q03) | serial with Slot A |

Scheduling: Q00 assigns slots; an agent must request Slot A/D before starting. Contention-induced failures are recorded as INVALID EVIDENCE, not defects and not passes.

## 6. CI Coverage Check

`.github/workflows/beta.yml` and `deploy.yml` run `npm ci`, `npm run generate-luts`, `npm test`, and build only. **No E2E stage exists.** Until a CI E2E job is added (separate WO, requires PO approval), G1 E2E evidence is the isolated local runs above plus Q05's independent rerun.

## 7. Q05 Independence Rules

- Fresh clone; never writes to product branches; no permission to merge or deploy.
- Runs from tested PR head SHAs, not from local uncommitted state.
- Reports include repro steps, expected/actual, commit SHA, and owner; UNVERIFIED is used for real-device/webkit gaps.
- Q05 may read engineer artifacts but must reproduce failures itself before filing a defect.
