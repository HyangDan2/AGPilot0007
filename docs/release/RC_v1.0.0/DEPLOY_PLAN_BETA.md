# Film Studio v1.0.0 — Beta Deploy and Rollback Plan

Docs-only plan for CP5. **No deployment happens in CP5 without PO approval.**
main and beta are locked during CP5; this document describes what the existing
workflows do so the PO can approve (or defer) release actions. It does not
change any workflow.

Source read for this document: `.github/workflows/beta.yml`,
`.github/workflows/deploy.yml`, `tools/deployment/fetch-production.mjs`,
`tools/deployment/assemble-pages.mjs`.

## Targets

| Environment | URL | Workflow | Trigger |
|---|---|---|---|
| Beta | https://hyangdan2.github.io/AGPilot0007/beta/ | `beta.yml` | push to `beta`, or manual dispatch |
| Production | https://hyangdan2.github.io/AGPilot0007/ | `deploy.yml` | push to `main`, or manual dispatch |

Both workflows share the `pages` concurrency group with
`cancel-in-progress: false`, so a beta and a production deploy never run
concurrently; a queued run waits.

## beta.yml — what runs on push to `beta`

1. Guard: `build-beta` runs only when `github.ref == 'refs/heads/beta'`.
2. Setup: Python 3.11 (+numpy/scipy/pillow), Node 22 with npm cache, `npm ci`.
3. Gates: `npm run generate-luts`, `npm test` (unit tests). A failure stops the
   deploy.
4. Build: `npm run build:beta` → `dist-beta/` with base `/AGPilot0007/beta/`
   and manifest id/scope `/AGPilot0007/beta/`.
5. Artifact: uploads `film-studio-beta` (retention 90 days).
6. Compose site: fetches the **approved production snapshot** via
   `tools/deployment/fetch-production.mjs` into `.production-root`, then
   `assemble-pages.mjs --production .production-root/site --beta dist-beta
   --output .pages-site`. This is why deploying beta does not remove or change
   production. The snapshot itself is also retained as artifact
   `production-root` (90 days).
7. Upload Pages artifact, then job `deploy` publishes with
   `actions/deploy-pages@v4` to the `github-pages` environment.

Note: beta does not build or test the production bundle; it republishes the
snapshot of production it fetched.

## deploy.yml — what runs on push to `main`

1. Guard: `build-and-test` runs only when `github.ref == 'refs/heads/main'`.
2. Same setup and gates as beta (`generate-luts`, `npm test`), then
   `npm run build` with base `/AGPilot0007/`.
3. Preserve beta: queries the latest **successful** `beta.yml` run on `beta`,
   downloads its `film-studio-beta` artifact, and runs
   `assemble-pages.mjs --production dist --beta .beta-artifact`. If no
   successful beta run exists, the step fails and nothing deploys.
4. Upload Pages artifact; job `deploy` publishes via `actions/deploy-pages@v4`.

Consequence: production always carries the newest production build plus the
last successful beta artifact. Beta content is therefore frozen at the last
successful beta run, not rebuilt from `beta` HEAD.

## Pre-deploy gates (CP5)

All must hold before PO approves either deploy:

1. CP5 qualification signed off by Q00 (final numbers recorded in the release
   notes, evidence tip `da97ba6`).
2. Q05 verification PASS for the RC; no open blocking defects.
3. App version confirmed 1.0.0 (`package.json`); no bump without approval.
4. PR #17 merged to the pro-engine integration branch by Q01 (not by Q04),
   then the production merge to `main` approved by the PO. main/beta remain
   locked until then.
5. Licenses: `THIRD_PARTY_NOTICES.md` complete for all runtime dependencies
   (see this doc set and the notices file). The notices file is bundled into
   the build as `THIRD_PARTY_NOTICES.txt`.

## Rollback

Fastest path — redeploy the previous Pages artifact:

1. Open Actions → the last known-good "Deploy Film Studio to GitHub Pages" run.
2. Re-run the `deploy` job. It republishes that run's Pages artifact without
   rebuilding. Use this for an immediate production rollback.

Git-based rollback (preferred for lasting state):

1. Identify the last-good SHA on `main` (`git log` on the deploy commits).
2. Create a revert commit on a working branch and merge it to `main` through a
   PR (PO-approved). `deploy.yml` then builds and publishes the reverted tree.
3. For beta, revert the offending commit on `beta` and push; `beta.yml`
   rebuilds and republishes beta while keeping production from the snapshot.

Post-rollback checks:

- Visit both URLs and confirm the expected build loads (version string, film
  list).
- Installed PWAs update automatically on next load (`autoUpdate`); a
  `controllerchange` reload applies the rollback build. Clients that are
  offline keep the previous build until they reconnect.
- Confirm beta-specific assets (LUT/thumbnails) match the beta base path
  `/AGPilot0007/beta/`.

Artifact retention: `film-studio-beta` and `production-root` are kept 90 days,
which covers the rollback window for the RC.

## Explicit statement

CP5 delivers documentation only. No push to `main` or `beta`, no workflow
edits, no deploy, and no release action occurs in CP5 without PO approval.
