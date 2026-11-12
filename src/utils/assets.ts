/**
 * Resolves static asset paths taking Vite's base URL into account.
 * Ensures assets resolve correctly on GitHub Pages (/AGPilot0007/) as well as local dev (/).
 */
export function getAssetUrl(relativePath: string): string {
  const base = (import.meta as any).env?.BASE_URL || './';
  const cleanBase = base.endsWith('/') ? base : `${base}/`;
  const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath;
  return `${cleanBase}${cleanPath}`;
}
