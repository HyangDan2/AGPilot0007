# Film Studio v1.0.0 — Recipe Compatibility

Source of truth: `src/engine/contracts/recipeValidation.ts`,
`src/engine/contracts/recipeV9.ts`, `src/engine/contracts/recipeV10.ts`,
`src/stores/recipeStore.ts`, `docs/phase1/RECIPE_SCHEMA.md`.
Verified against the RC tree (CP5-04). If code and this document disagree,
code wins — file a documentation bug.

## Supported versions

| | Version |
|---|---|
| Minimum readable | 1 |
| Maximum readable (`RECIPE_SCHEMA_MAX`) | 10 |
| Highest writable (`CURRENT_SCHEMA_VERSION`) | 10 (conditional) |
| Default write version | 8 |

Recipes declare `schemaVersion`. Anything above 10 is rejected with
`Unsupported recipe version`.

## Read behavior (1–10)

- **v1–v7**: migrated in memory to the current shape on load. Stored records in
  IndexedDB are not rewritten until an explicit persistence action; the
  migration keeps the original declared version in memory as a v8-compatible
  record (`schemaVersion` stays the declared version at load).
- **v8**: adds `geometry`. Geometry is validated (`validateRecipeV8Geometry`);
  a v8 record without a `geometry` key is accepted with defaults.
- **v9**: adds `optical` and `localAdjustments` (conditional). Validated with
  `validateRecipeV9`, including strict unknown-key checks.
- **v10**: adds `lensBlur` and `develop` (conditional). Validated with
  `validateRecipeV10`, strict unknown-key checks.
- Cross-version field guards:
  - a v9 field present in a record declaring a version < 9 (or no version)
    raises `Unexpected v9 field in recipe`;
  - a v10 field present in a record declaring a version < 10 raises
    `Unexpected v10 field in recipe`.
- Unknown `baseFilmId` falls back to `FS-001`. Adjustment values are clamped
  to each control's `min`/`max` from `ADJUSTMENT_DEFINITIONS`; non-finite
  values fall back to defaults.
- Loading from IndexedDB: invalid stored recipes are skipped with a console
  error; the rest load normally.

## Write behavior

The writer chooses the version per state, not always the maximum:

- `shouldWriteRecipeV9(state)` → write v9 when `localAdjustments` are active or
  a non-identity `optical` transform is present.
- `shouldWriteRecipeV10(state)` → write v10 when a non-neutral `lensBlur` or a
  non-neutral RAW `develop` is present.
- Otherwise write v8.

So a plain grade round-trips as v8, keeping files loadable by v8-era builds.
Migrated records keep the original declared version on load; an explicit save
re-emits at the computed version (v8/v9/v10).

## Storage keys

Saved recipes live in IndexedDB under a key resolved from the app base URL:
stable builds (`/AGPilot0007/`) and beta builds (`/AGPilot0007/beta/`) use
**separate** keys, so beta experiments cannot clobber production recipes.

## File import/export

- `validateRecipeJSON` parses the JSON, requires `name` and `baseFilmId`,
  checks the declared version, verifies the film profile and preset
  compatibility, then runs `validateRecipeFeatures` and `migrateRecipe`.
- Rejected: malformed JSON, missing required fields, unsupported version
  (>10), version/field mismatches, invalid geometry/optical/mask/lens/develop
  payloads.

## Compatibility summary for users

- Recipes made in v1.0.0 with only basic grade controls load in v8-era builds.
- Recipes using geometry need v8+; masks/optical need v9+; lens blur/develop
  need v10+.
- Older recipes load in v1.0.0 without loss of basic grade values.
