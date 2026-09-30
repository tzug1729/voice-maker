import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const defaults = {
  speedScale: 1,
  pitchScale: 0,
  intonationScale: 1,
  volumeScale: 1,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
};

// Hina intentionally has no assumed speaker or synthesis settings.
export const initialPresets = [
  { id: 'hina', name: 'ヒナ', enabled: false, styleId: null, credit: '', termsUrl: '',
    speedScale: null, pitchScale: null, intonationScale: null, volumeScale: null,
    prePhonemeLength: null, postPhonemeLength: null },
  { id: 'zundamon', name: 'ずんだもん', enabled: true, styleId: 3,
    credit: 'VOICEVOX:ずんだもん', termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html', ...defaults },
];

export class FileStore {
  constructor(dir) { this.dir = dir; this.queue = Promise.resolve(); }
  async read(name, fallback) {
    try { return JSON.parse(await readFile(path.join(this.dir, name), 'utf8')); }
    catch (err) { if (err.code === 'ENOENT') return fallback; throw err; }
  }
  async write(name, value) {
    await mkdir(this.dir, { recursive: true });
    const file = path.join(this.dir, name);
    const temp = `${file}.${process.pid}.tmp`;
    await writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
    await rename(temp, file);
  }
  async lock(fn) {
    const next = this.queue.then(fn);
    this.queue = next.catch(() => {});
    return next;
  }
  async getPresets() { return this.read('presets.json', initialPresets); }
  async savePreset(preset) { return this.lock(async () => {
    const presets = await this.getPresets();
    const next = presets.some(item => item.id === preset.id)
      ? presets.map(item => item.id === preset.id ? preset : item)
      : [...presets, preset];
    await this.write('presets.json', next);
    return next;
  }); }
  async deletePreset(id) { return this.lock(async () => {
    const next = (await this.getPresets()).filter(preset => preset.id !== id);
    await this.write('presets.json', next);
    return next;
  }); }
}

export function createStore() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.resolve('data');
  return new FileStore(process.env.DATA_DIR || path.join(base, 'voice-maker'));
}
