import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validPreset } from './core.mjs';

// This file is the version-controlled set of defaults distributed to new users.
export const initialPresets = JSON.parse(await readFile(new URL('../presets.default.json', import.meta.url), 'utf8'));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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
  async readUserPresets() {
    const saved = await this.read('presets.json', []);
    return Array.isArray(saved) ? saved : [];
  }
  mergePresets(userPresets) {
    const packagedIds = new Set(initialPresets.map(preset => preset.id));
    const packagedSourceIds = new Set(initialPresets.filter(validPreset).map(preset => preset.id));
    const supportedStyles = new Set(initialPresets.filter(validPreset).map(preset => preset.styleId));
    const personal = userPresets.filter(preset => validPreset(preset) && !packagedIds.has(preset.id)
      && (supportedStyles.has(preset.styleId) || packagedSourceIds.has(preset.sourcePresetId)));
    return [...initialPresets, ...personal];
  }
  async getPresets() { return this.lock(async () => this.mergePresets(await this.readUserPresets())); }
  async savePreset(preset) { return this.lock(async () => {
    const presets = await this.readUserPresets();
    const next = [...presets.filter(item => item.id !== preset.id), preset];
    await this.write('presets.json', next);
    return this.mergePresets(next);
  }); }
}

export function createStore() {
  if (process.env.NODE_ENV === 'test' && process.env.DATA_DIR) {
    const testDir = path.resolve(process.env.DATA_DIR);
    if (testDir !== projectRoot && !testDir.startsWith(projectRoot + path.sep)) {
      throw new Error('テスト用データの保存先はvoice-maker内に指定してください。');
    }
    return new FileStore(testDir);
  }
  return new FileStore(projectRoot);
}
