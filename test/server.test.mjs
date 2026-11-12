import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createStore, FileStore, initialPresets } from '../backend/store.mjs';
import { validPreset } from '../backend/core.mjs';

async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const testDataDir = path.join(process.cwd(), 'data');
async function testDir(prefix) {
  await mkdir(testDataDir, { recursive: true });
  return mkdtemp(path.join(testDataDir, prefix));
}

test('normal storage stays at the project root', () => {
  assert.equal(createStore().dir, process.cwd());
});

test('packaged presets and personal voice choices persist without reviving old unrelated voices', async () => {
  const dir = await testDir('voice-store-');
  try {
    const packaged = initialPresets.find(preset => preset.enabled && validPreset(preset));
    assert.ok(packaged, 'a configured packaged preset exists');
    const first = new FileStore(dir);
    const personal = { ...packaged, id: 'local-choice', name: '保存した声', sourcePresetId: packaged.id, styleId: 99, defaultText: null };
    const oldVoice = { ...personal, id: 'old-voice', name: '古い声', sourcePresetId: undefined };
    await writeFile(path.join(dir, 'presets.json'), JSON.stringify([oldVoice]));
    await first.savePreset(personal);
    const restarted = new FileStore(dir);
    const loaded = await restarted.getPresets();
    assert.deepEqual(loaded.find(preset => preset.id === packaged.id), packaged);
    assert.deepEqual(loaded.find(preset => preset.id === personal.id), personal);
    assert.equal(loaded.some(preset => preset.id === oldVoice.id), false);
    assert.equal((await readFile(path.join(dir, 'presets.json'), 'utf8')).includes('保存した声'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local API loads preset JSON, saves personal presets, synthesizes audio, and reports an unavailable engine', async () => {
  let receivedQuery;
  let querySpeaker;
  let queryText;
  let synthesisSpeaker;
  let synthesisUrl;
  const packaged = initialPresets.find(preset => preset.enabled && validPreset(preset));
  assert.ok(packaged, 'a configured packaged preset exists');
  const phrase = { moras: [
    { text: 'ア', consonant: null, consonant_length: null, vowel: 'a', vowel_length: 0.2, pitch: 5 },
    { text: 'イ', consonant: null, consonant_length: null, vowel: 'i', vowel_length: 0.2, pitch: 5.5 },
  ], accent: 1, pause_mora: null, is_interrogative: false };
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/speakers') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ name: '配布話者', styles: [{ id: packaged.styleId, name: '通常' }] }, { name: '別話者', styles: [{ id: 99, name: '通常' }] }])); return; }
    if (req.url.startsWith('/audio_query')) { const url = new URL(req.url, 'http://127.0.0.1'); querySpeaker = url.searchParams.get('speaker'); queryText = url.searchParams.get('text'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ accent_phrases: [phrase], outputSamplingRate: 24000, outputStereo: false })); return; }
    if (req.url.startsWith('/mora_data')) { const chunks = []; for await (const chunk of req) chunks.push(chunk); const changed = JSON.parse(Buffer.concat(chunks))[0]; changed.moras[0].pitch = 6; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([changed])); return; }
    if (req.url.startsWith('/synthesis')) { synthesisUrl = req.url; synthesisSpeaker = new URL(req.url, 'http://127.0.0.1').searchParams.get('speaker'); const chunks = []; for await (const chunk of req) chunks.push(chunk); receivedQuery = JSON.parse(Buffer.concat(chunks)); res.setHeader('Content-Type', 'audio/wav'); res.end(Buffer.from('RIFFtestWAVE')); return; }
    if (req.url === '/version') { res.end('0.25'); return; }
    res.writeHead(404).end();
  });
  const mockPort = await listen(mock);
  const dir = await testDir('voice-maker-');
  const probe = http.createServer(); const port = await listen(probe); probe.close();
  const server = spawn(process.execPath, ['backend/server.mjs'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ENGINE_URL: `http://127.0.0.1:${mockPort}`, DATA_DIR: dir }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {} await pause(100); }
    assert.ok(ready, 'server starts');
    const speakers = await (await fetch(base + '/api/speakers')).json();
    assert.deepEqual(speakers.speakers.find(item => item.id === 99), { id: 99, speaker: '別話者', style: '通常' });
    const preset = { ...packaged, id: 'custom-test', name: 'テスト声', sourcePresetId: packaged.id, styleId: 99, credit: 'VOICEVOX:別話者', speedScale: 1.2 };
    const saved = await fetch(base + '/api/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset) });
    assert.equal(saved.status, 201);
    const saveResult = await saved.json();
    assert.equal(saveResult.storagePath, path.join(dir, 'presets.json'));
    assert.equal(saveResult.preset.defaultText, null);
    const publicList = await (await fetch(base + '/api/presets')).json();
    assert.equal(publicList.presets.some(item => item.name === 'テスト声'), true);
    assert.equal(publicList.presets.find(item => item.id === packaged.id).defaultText, packaged.defaultText ?? null);
    assert.equal(publicList.presets.find(item => item.id === preset.id).defaultText, null);
    assert.equal(publicList.presets.find(item => item.id === preset.id).sourcePresetId, packaged.id);
    const analysis = await fetch(base + '/api/query', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: packaged.id, styleId: 99, text: '別表記', readingText: 'あい' }) });
    assert.equal(analysis.status, 200);
    assert.equal(queryText, 'あい');
    const analyzedPhrase = (await analysis.json()).accentPhrases[0];
    assert.equal(analyzedPhrase.accent, 1);
    analyzedPhrase.accent = 2;
    const recalculated = await fetch(base + '/api/mora-data', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: packaged.id, styleId: 99, accentPhrase: analyzedPhrase }) });
    assert.equal(recalculated.status, 200);
    const editedPhrase = (await recalculated.json()).accentPhrase;
    assert.equal(editedPhrase.moras[0].pitch, 6);
    editedPhrase.moras[1].pitch = 7.25;
    const override = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: packaged.id, styleId: 99, text: '話者を変更' }) });
    assert.equal(override.status, 200);
    assert.equal(querySpeaker, '99');
    assert.equal(synthesisSpeaker, '99');
    const wav = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      presetId: preset.id, text: '別表記', readingText: 'あい', accentPhrases: [editedPhrase], parameters: { pauseLengthScale: 1.5 },
      options: { outputSamplingRate: 48000, outputStereo: true, enableInterrogativeUpspeak: false, pauseLength: 0.35 },
    }) });
    assert.equal(wav.status, 200);
    assert.equal(wav.headers.get('content-type'), 'audio/wav');
    const audio = Buffer.from(await wav.arrayBuffer());
    const savedWav = await fetch(base + '/api/wav', { method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audio });
    assert.equal(savedWav.status, 201);
    const wavPath = (await savedWav.json()).storagePath;
    assert.equal(path.dirname(wavPath), dir);
    assert.deepEqual(await readFile(wavPath), audio);
    assert.equal(receivedQuery.speedScale, 1.2);
    assert.equal(receivedQuery.pauseLengthScale, 1.5);
    assert.equal(receivedQuery.outputSamplingRate, 48000);
    assert.equal(receivedQuery.outputStereo, true);
    assert.equal(receivedQuery.pauseLength, 0.35);
    assert.equal(queryText, 'あい');
    assert.equal(receivedQuery.accent_phrases[0].moras[1].pitch, 7.25);
    assert.equal(wav.headers.get('x-accent-reset'), '0');
    assert.match(synthesisUrl, /enable_interrogative_upspeak=false/);
    const stalePhrase = structuredClone(editedPhrase);
    stalePhrase.moras[0].text = '別';
    const refreshed = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      presetId: preset.id, text: '別の読みになった文章', accentPhrases: [stalePhrase],
    }) });
    assert.equal(refreshed.status, 200);
    assert.equal(refreshed.headers.get('x-accent-reset'), '1');
    assert.equal(receivedQuery.accent_phrases[0].moras[0].text, phrase.moras[0].text);
    const badAccent = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
      presetId: preset.id, text: 'あい', accentPhrases: [{ ...editedPhrase, accent: 3 }],
    }) });
    assert.equal(badAccent.status, 400);
    assert.equal(querySpeaker, '99');
    assert.equal(synthesisSpeaker, '99');
    const unknownStyle = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: preset.id, styleId: 999, text: '話者不明' }) });
    assert.equal(unknownStyle.status, 400);
    const savedAgain = await (await fetch(base + '/api/presets')).json();
    assert.equal(savedAgain.presets.find(item => item.id === preset.id).name, 'テスト声');
    assert.equal((await fetch(base + '/api/admin/presets')).status, 404);
    const savedFile = JSON.parse(await readFile(path.join(dir, 'presets.json'), 'utf8'));
    assert.equal(savedFile.find(item => item.id === preset.id).defaultText, null);
  } finally { server.kill(); mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('engine connection errors explain how to start VOICEVOX', async () => {
  const probe = http.createServer(); const port = await listen(probe); probe.close();
  const unused = http.createServer(); const enginePort = await listen(unused); unused.close();
  const server = spawn(process.execPath, ['backend/server.mjs'], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ENGINE_URL: `http://127.0.0.1:${enginePort}`, DATA_DIR: path.join(testDataDir, `voice-maker-down-${process.pid}`) }, stdio: 'ignore' });
  try {
    let result;
    for (let i = 0; i < 50; i++) { try { result = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(); break; } catch {} await pause(100); }
    assert.equal(result.ready, false);
    assert.match(result.error, /デスクトップアプリを起動/);
  } finally { server.kill(); }
});
