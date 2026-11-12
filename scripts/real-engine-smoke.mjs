// Run manually while VOICEVOX Desktop and this app are running.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const base = process.env.APP_URL || 'http://127.0.0.1:3000';
async function request(endpoint, options) {
  const response = await fetch(base + endpoint, options);
  if (!response.ok) throw new Error(`${endpoint}: ${response.status} ${await response.text()}`);
  return response;
}
async function json(endpoint, value, method = 'POST') {
  return (await request(endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) })).json();
}
async function saveWav(wav) {
  const audio = Buffer.from(await wav.arrayBuffer());
  assert.equal(audio.toString('ascii', 0, 4), 'RIFF');
  assert.equal(audio.toString('ascii', 8, 12), 'WAVE');
  const saved = await request('/api/wav', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio });
  const { storagePath } = await saved.json();
  assert.deepEqual(await readFile(storagePath), audio);
  return { storagePath, bytes: audio.length };
}

const health = await (await request('/api/health')).json();
assert.equal(health.ready, true);
const { presets } = await (await request('/api/presets')).json();
const hina = presets.find(preset => preset.id === 'hina');
assert.ok(hina);
const { speakers } = await (await request('/api/speakers')).json();
assert.ok(speakers.some(style => style.id === hina.styleId));
const preset = { ...hina, id: `local-${randomUUID().replaceAll('-', '')}`, name: '実機確認',
  enabled: true, sourcePresetId: hina.id, defaultText: null };
await json('/api/presets', preset);
const reloaded = (await (await request('/api/presets')).json()).presets;
assert.ok(reloaded.some(item => item.id === preset.id));
const text = 'こんにちは。';
const analysis = await json('/api/query', { presetId: preset.id, styleId: hina.styleId, text });
assert.ok(analysis.accentPhrases.length);
analysis.accentPhrases[0].moras[0].pitch += 0.1;
const speech = await saveWav(await request('/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ presetId: preset.id, styleId: hina.styleId, text, accentPhrases: analysis.accentPhrases,
    parameters: { intonationScale: 1.4 }, options: { outputSamplingRate: 24000, outputStereo: false } }) }));

const testSurface = `Codex確認${randomUUID().slice(0, 8)}`;
let wordUuid;
try {
  const before = await (await request('/api/dictionary')).json();
  const added = await json('/api/dictionary', { surface: testSurface, pronunciation: 'テスト', accentType: 1,
    wordType: 'PROPER_NOUN', priority: 5 });
  wordUuid = Object.keys(added.words).find(uuid => !Object.hasOwn(before.words, uuid));
  assert.ok(wordUuid);
  const edited = await json(`/api/dictionary/${wordUuid}`, { surface: testSurface, pronunciation: 'カクニン', accentType: 1,
    wordType: 'PROPER_NOUN', priority: 5 }, 'PUT');
  assert.equal(edited.words[wordUuid].pronunciation, 'カクニン');
} finally {
  if (wordUuid) await request(`/api/dictionary/${wordUuid}`, { method: 'DELETE' });
}

const { styles } = await (await request('/api/singers')).json();
const teacher = styles.find(style => ['sing', 'singing_teacher'].includes(style.type));
const singer = styles.find(style => style.type === 'frame_decode');
let song = null;
if (teacher && singer) {
  song = await saveWav(await request('/api/sing', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ teacherStyleId: teacher.id, singerStyleId: singer.id,
      notes: [{ key: 60, seconds: 0.4, lyric: 'ド' }, { key: 62, seconds: 0.4, lyric: 'レ' }, { key: 64, seconds: 0.4, lyric: 'ミ' }],
      volumeScale: 1, outputSamplingRate: 24000, outputStereo: false }) }));
}
console.log(JSON.stringify({ presetId: preset.id, speech, song, dictionary: 'add/edit/delete passed' }));
