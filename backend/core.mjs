export const MAX_CHARS = 500;
export const PARAMS = {
  speedScale: [0.5, 2], pitchScale: [-0.15, 0.15],
  intonationScale: [0, 2], volumeScale: [0, 2],
  prePhonemeLength: [0, 2], postPhonemeLength: [0, 2],
  pauseLengthScale: [0, 2],
};
export const AUDIO_DEFAULTS = {
  pauseLengthScale: 1,
  pauseLength: null,
  outputSamplingRate: 24000,
  outputStereo: false,
  enableInterrogativeUpspeak: true,
};
export const SAMPLE_RATES = [24000, 44100, 48000];

function validMora(mora) {
  return mora && typeof mora === 'object' && !Array.isArray(mora)
    && typeof mora.text === 'string' && mora.text.length > 0 && mora.text.length <= 20
    && typeof mora.vowel === 'string' && mora.vowel.length > 0 && mora.vowel.length <= 10
    && typeof mora.vowel_length === 'number' && Number.isFinite(mora.vowel_length)
    && mora.vowel_length >= 0 && mora.vowel_length <= 10
    && typeof mora.pitch === 'number' && Number.isFinite(mora.pitch)
    && mora.pitch >= 0 && mora.pitch <= 20
    && (mora.consonant_length == null || (typeof mora.consonant_length === 'number'
      && Number.isFinite(mora.consonant_length) && mora.consonant_length >= 0 && mora.consonant_length <= 10));
}

export function validAccentPhrases(phrases) {
  if (!Array.isArray(phrases) || !phrases.length || phrases.length > 100) return false;
  let count = 0;
  for (const phrase of phrases) {
    if (!phrase || !Array.isArray(phrase.moras) || !phrase.moras.length) return false;
    count += phrase.moras.length;
    if (count > 600 || !Number.isInteger(phrase.accent)
      || phrase.accent < 1 || phrase.accent > phrase.moras.length
      || !phrase.moras.every(validMora)
      || (phrase.pause_mora != null && !validMora(phrase.pause_mora))) return false;
  }
  return true;
}

export function validPreset(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (typeof value.id !== 'string' || !/^[a-z0-9][a-z0-9-]{0,39}$/.test(value.id)) return false;
  if (typeof value.name !== 'string' || !value.name.trim() || value.name.length > 40) return false;
  if (value.defaultText !== undefined && value.defaultText !== null
    && (typeof value.defaultText !== 'string' || [...value.defaultText].length > MAX_CHARS)) return false;
  if (typeof value.credit !== 'string' || value.credit.length > 160) return false;
  if (typeof value.termsUrl !== 'string' || (value.termsUrl && !/^https:\/\/[^\s]+$/.test(value.termsUrl))) return false;
  if (!Number.isInteger(value.styleId) || value.styleId < 0) return false;
  for (const [key, [min, max]] of Object.entries(PARAMS)) {
    if (key === 'pauseLengthScale' && value[key] === undefined) continue;
    if (typeof value[key] !== 'number' || !Number.isFinite(value[key]) || value[key] < min || value[key] > max) return false;
  }
  if (value.outputSamplingRate !== undefined && !SAMPLE_RATES.includes(value.outputSamplingRate)) return false;
  if (value.pauseLength != null && (typeof value.pauseLength !== 'number'
    || !Number.isFinite(value.pauseLength) || value.pauseLength < 0 || value.pauseLength > 5)) return false;
  if (value.outputStereo !== undefined && typeof value.outputStereo !== 'boolean') return false;
  if (value.enableInterrogativeUpspeak !== undefined && typeof value.enableInterrogativeUpspeak !== 'boolean') return false;
  return typeof value.enabled === 'boolean';
}

export function publicPreset(preset) {
  return {
    id: preset.id,
    name: preset.name,
    defaultText: preset.defaultText ?? null,
    styleId: preset.styleId,
    credit: preset.credit,
    termsUrl: preset.termsUrl,
    ...Object.fromEntries(Object.keys(PARAMS).map(key => [key, preset[key] ?? AUDIO_DEFAULTS[key]])),
    outputSamplingRate: preset.outputSamplingRate ?? AUDIO_DEFAULTS.outputSamplingRate,
    pauseLength: preset.pauseLength ?? AUDIO_DEFAULTS.pauseLength,
    outputStereo: preset.outputStereo ?? AUDIO_DEFAULTS.outputStereo,
    enableInterrogativeUpspeak: preset.enableInterrogativeUpspeak ?? AUDIO_DEFAULTS.enableInterrogativeUpspeak,
  };
}
