export interface DeviceProfile {
  hardwareConcurrency?: number;
  deviceMemory?: number;
  mobile?: boolean;
}

export function detectDeviceProfile(): DeviceProfile {
  if (typeof navigator === 'undefined') return {};
  const ua = navigator.userAgent || '';
  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    // deviceMemory is Chrome-only; treat the absence as unknown, not as 8 GiB.
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory,
    mobile: /Android|iPhone|iPad|iPod|Mobile/i.test(ua),
  };
}

/**
 * Export concurrency for CP1. Full-resolution WebGL export holds a decoded
 * image, a preview canvas and GPU textures per running job, so the limit is
 * deliberately low and never exceeds 4. Documented in docs/phase1/BATCH_POC.md.
 */
export function recommendedConcurrency(profile: DeviceProfile = detectDeviceProfile()): number {
  const cores = Math.max(1, Math.floor(profile.hardwareConcurrency ?? 4));
  const memory = profile.deviceMemory;
  let limit = typeof memory === 'number' ? (memory <= 2 ? 1 : memory <= 4 ? 2 : 3) : 2;
  limit = Math.min(limit, Math.max(1, cores - 1), 4);
  if (profile.mobile) limit = Math.min(limit, 2);
  return Math.max(1, limit);
}
