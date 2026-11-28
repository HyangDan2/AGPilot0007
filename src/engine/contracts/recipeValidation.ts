/**
 * Recipe version detection and storage isolation. Version identification is a
 * cheap, pure step; full field validation stays in recipeStore/feature
 * validators. RECIPE_SCHEMA_MAX is the highest readable version; new and
 * migrated recipes write v8 (CURRENT_SCHEMA_VERSION), or v9 only when
 * optical/local features are active. Every earlier version stays readable and
 * is migrated in memory, so upgrading never edits stored v1-v7 records.
 */
export const RECIPE_SCHEMA_MAX = 9;

export const RECIPE_STORAGE_KEYS = Object.freeze({
  stable: 'hd2lab_film_studio_recipes_v1',
  beta: 'hd2lab_film_studio_beta_recipes_v1',
});

export type RecipeStorageKey = (typeof RECIPE_STORAGE_KEYS)[keyof typeof RECIPE_STORAGE_KEYS];

export function resolveRecipeStorageKey(baseUrl = ''): RecipeStorageKey {
  return baseUrl.includes('/beta/') ? RECIPE_STORAGE_KEYS.beta : RECIPE_STORAGE_KEYS.stable;
}

export function assertRecipeStorageKey(value: unknown): asserts value is RecipeStorageKey {
  if (value !== RECIPE_STORAGE_KEYS.stable && value !== RECIPE_STORAGE_KEYS.beta) {
    throw new Error('Unknown recipe storage key');
  }
}

/** Returns the declared schema version, or null when it is absent/malformed. */
export function detectRecipeSchemaVersion(value: unknown): number | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const version = (value as { schemaVersion?: unknown }).schemaVersion;
  return Number.isInteger(version) ? (version as number) : null;
}

export function assertRecipeVersionSupported(
  value: unknown,
  maxVersion = RECIPE_SCHEMA_MAX,
): number {
  if (value === undefined || value === null) return maxVersion;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maxVersion) {
    throw new Error('Unsupported recipe version');
  }
  return value as number;
}

export function isRecipeVersionSupported(value: unknown, maxVersion = RECIPE_SCHEMA_MAX): boolean {
  try {
    assertRecipeVersionSupported(value, maxVersion);
    return true;
  } catch {
    return false;
  }
}

/**
 * Guard before writing to IndexedDB. The storage key selects the Beta or Stable
 * database and the version check prevents writing future schemas to a v7 store.
 */
export function assertRecipePersistable(recipe: unknown, storageKey: RecipeStorageKey | string): void {
  assertRecipeStorageKey(storageKey);
  if (!recipe || typeof recipe !== 'object' || Array.isArray(recipe)) {
    throw new Error('Invalid recipe');
  }
  assertRecipeVersionSupported((recipe as { schemaVersion?: unknown }).schemaVersion);
}
