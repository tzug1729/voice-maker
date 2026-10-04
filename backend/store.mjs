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

// This file is the version-controlled set of defaults distributed to new users.
export const initialPresets = JSON.parse(await readFile(new URL('../presets.default.json', import.meta.url), 'utf8'));

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
  async readPresets() {
    const saved = await this.read('presets.json', initialPresets);
    const presets = Array.isArray(saved) ? [...saved] : [];
    let changed = !Array.isArray(saved);
    const preset = initialPresets.find(item => item.id === 'hina');
    if (preset) {
      const index = presets.findIndex(item => item.id === preset.id);
      const current = presets[index];
      const configured = current && Number.isInteger(current.styleId)
        && Object.keys(defaults).every(key => typeof current[key] === 'number' && Number.isFinite(current[key]))
        && typeof current.enabled === 'boolean';
      if (index < 0) { presets.push(preset); changed = true; }
      else if (!configured) { presets[index] = preset; changed = true; }
    }
    if (changed) await this.write('presets.json', presets);
    return presets;
  }
  async getPresets() { return this.lock(() => this.readPresets()); }
  async savePreset(preset) { return this.lock(async () => {
    const presets = await this.readPresets();
    const next = presets.some(item => item.id === preset.id)
      ? presets.map(item => item.id === preset.id ? preset : item)
      : [...presets, preset];
    await this.write('presets.json', next);
    return next;
  }); }
  async deletePreset(id) { return this.lock(async () => {
    const next = (await this.readPresets()).filter(preset => preset.id !== id);
    await this.write('presets.json', next);
    return next;
  }); }
}

export function createStore() {
  const base = process.env.LOCALAPPDATA || process.env.APPDATA || path.resolve('data');
  return new FileStore(process.env.DATA_DIR || path.join(base, 'voice-maker'));
}
