export const MAX_CHARS = 500;
export const PARAMS = {
  speedScale: [0.5, 2], pitchScale: [-0.15, 0.15],
  intonationScale: [0, 2], volumeScale: [0, 2],
  prePhonemeLength: [0, 2], postPhonemeLength: [0, 2],
};

export function validPreset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.id)) return false;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40) return false;
  if (typeof value.credit !== 'string' || value.credit.length > 160) return false;
  if (typeof value.termsUrl !== 'string' || (value.termsUrl && !/^https:\/\/[^\s]+$/.test(value.termsUrl))) return false;
  if (!Number.isInteger(value.styleId) || value.styleId < 0) return false;
  for (const [key, [min, max]] of Object.entries(PARAMS)) {
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return false;
  }
  return typeof value.enabled === 'boolean';
}

export function publicPreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    styleId: preset.styleId,
    credit: preset.credit,
    termsUrl: preset.termsUrl,
    ...Object.fromEntries(Object.keys(PARAMS).map(key => [key, preset[key]])),
  };
}
