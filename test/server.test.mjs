import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from '../backend/store.mjs';

async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('preset settings persist after creating a new store instance and Hina starts unconfigured', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'voice-store-'));
  try {
    const first = new FileStore(dir);
    const initial = await first.getPresets();
    const hina = initial.find(preset => preset.id === 'hina');
    assert.equal(hina.enabled, false);
    assert.equal(hina.styleId, null);
    assert.equal(hina.speedScale, null);
    const configured = { ...hina, styleId: 3, enabled: true, credit: 'VOICEVOX:ずんだもん', termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html', speedScale: 1.2, pitchScale: 0.02, intonationScale: 1.1, volumeScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1 };
    await first.savePreset(configured);
    const restarted = new FileStore(dir);
    assert.deepEqual((await restarted.getPresets()).find(preset => preset.id === 'hina'), configured);
    assert.equal((await readFile(path.join(dir, 'presets.json'), 'utf8')).includes('ヒナ'), true);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('local API lists styles, saves named presets, synthesizes audio, and reports an unavailable engine', async () => {
  let receivedQuery;
  const mock = http.createServer(async (req, res) => {
    if (req.url === '/speakers') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify([{ name: 'ずんだもん', styles: [{ id: 3, name: 'ノーマル' }] }])); return; }
    if (req.url.startsWith('/audio_query')) { res.setHeader('Content-Type', 'application/json'); res.end('{}'); return; }
    if (req.url.startsWith('/synthesis')) { const chunks = []; for await (const chunk of req) chunks.push(chunk); receivedQuery = JSON.parse(Buffer.concat(chunks)); res.setHeader('Content-Type', 'audio/wav'); res.end(Buffer.from('RIFFtestWAVE')); return; }
    if (req.url === '/version') { res.end('0.25'); return; }
    res.writeHead(404).end();
  });
  const mockPort = await listen(mock);
  const dir = await mkdtemp(path.join(tmpdir(), 'voice-maker-'));
  const probe = http.createServer(); const port = await listen(probe); probe.close();
  const server = spawn(process.execPath, ['backend/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ENGINE_URL: `http://127.0.0.1:${mockPort}`, DATA_DIR: dir }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) { ready = true; break; } } catch {} await pause(100); }
    assert.ok(ready, 'server starts');
    const styles = await (await fetch(base + '/api/admin/speakers')).json();
    assert.equal(styles.speakers[0].id, 3);
    const preset = { id: 'custom-test', name: 'テスト声', styleId: 3, credit: 'VOICEVOX:ずんだもん', termsUrl: 'https://zunko.jp/con_ongen_kiyaku.html', enabled: true, speedScale: 1.2, pitchScale: 0.02, intonationScale: 1.1, volumeScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1 };
    const saved = await fetch(base + '/api/admin/presets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(preset) });
    assert.equal(saved.status, 201);
    const publicList = await (await fetch(base + '/api/presets')).json();
    assert.equal(publicList.presets.some(item => item.name === 'テスト声'), true);
    const wav = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: preset.id, text: 'こんにちは' }) });
    assert.equal(wav.status, 200);
    assert.equal(wav.headers.get('content-type'), 'audio/wav');
    assert.equal(receivedQuery.speedScale, 1.2);
    const disabledHina = await fetch(base + '/api/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presetId: 'hina', text: 'ヒナは未設定' }) });
    assert.equal(disabledHina.status, 400);
    const savedAgain = await (await fetch(base + '/api/admin/presets')).json();
    assert.equal(savedAgain.presets.find(item => item.id === preset.id).name, 'テスト声');
    const deleted = await fetch(base + `/api/admin/presets/${preset.id}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.equal((await readFile(path.join(dir, 'presets.json'), 'utf8')).includes('テスト声'), false);
  } finally { server.kill(); mock.close(); await rm(dir, { recursive: true, force: true }); }
});

test('engine connection errors explain how to start VOICEVOX', async () => {
  const probe = http.createServer(); const port = await listen(probe); probe.close();
  const unused = http.createServer(); const enginePort = await listen(unused); unused.close();
  const server = spawn(process.execPath, ['backend/server.mjs'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), ENGINE_URL: `http://127.0.0.1:${enginePort}`, DATA_DIR: path.join(tmpdir(), `voice-maker-down-${process.pid}`) }, stdio: 'ignore' });
  try {
    let result;
    for (let i = 0; i < 50; i++) { try { result = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json(); break; } catch {} await pause(100); }
    assert.equal(result.ready, false);
    assert.match(result.error, /デスクトップアプリを起動/);
  } finally { server.kill(); }
});
