# RC v1.0.0 Documentation Set

Release candidate artifacts for Film Studio v1.0.0 (CP5-04, docs-only).

| Document | Purpose |
|---|---|
| [RELEASE_NOTES_v1.0.0.md](RELEASE_NOTES_v1.0.0.md) | What shipped (CP2–CP5) with final measured numbers (accepted at `da97ba6`) |
| [USER_GUIDE.md](USER_GUIDE.md) | Short task-oriented guide: edit, develop, geometry, masks, workspace, batch, lens blur, video, export, offline |
| [RECIPE_COMPATIBILITY.md](RECIPE_COMPATIBILITY.md) | Read versions 1–10, write v8 default / v9 / v10 conditional, migration and rejection rules |
| [SUPPORT_AND_LIMITS.md](SUPPORT_AND_LIMITS.md) | Browser matrix, SwiftShader caveat, 8192 px source limit, tiling, RAW memory, PWA offline (incl. video-engine install note) |
| [PWA_UPDATE_VERIFICATION.md](PWA_UPDATE_VERIFICATION.md) | Recorded PASS method/result for service-worker auto-update |
| [DEPLOY_PLAN_BETA.md](DEPLOY_PLAN_BETA.md) | beta.yml / deploy.yml auto-run conditions, rollback steps; no deploy in CP5 without PO approval |

App version: 1.0.0 (confirmed against `package.json`; no bump proposed).

Open items before publication:

- PO approval for any beta/main deployment (none performed in CP5).
- Re-run of the release gates (tsc, vitest, build) on the final integration
  tip before publication; the numbers in these docs are from the CP5 evidence
  tip `da97ba6`.
