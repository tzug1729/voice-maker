import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
async function readBody(req) { const chunks = []; for await (const chunk of req) chunks.push(chunk); return JSON.parse(Buffer.concat(chunks)); }
async function startApp(enginePort, dir) {
  const probe = http.createServer(); const port = await listen(probe); probe.close();
  const app = spawn(process.execPath, ['backend/server.mjs'], { cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: 'test', PORT: String(port), ENGINE_URL: `http://127.0.0.1:${enginePort}`, DATA_DIR: dir }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/api/health')).ok) return { app, base }; } catch {} await pause(100); }
  app.kill(); throw new Error('app did not start');
}
async function post(base, endpoint, value, method = 'POST') {
  return fetch(base + endpoint, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
}

test('dictionary persists at project root, reloads into engine, and singing creates WAV', async () => {
  const dataRoot = path.join(process.cwd(), 'data');
  await mkdir(dataRoot, { recursive: true });
  const dir = await mkdtemp(path.join(dataRoot, 'extras-'));
  const state = { words: {}, imported: null, score: null, frameQuery: null, teacher: null, singer: null };
  const mock = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
    if (url.pathname === '/version') { res.end('0.25'); return; }
    if (url.pathname === '/user_dict' && req.method === 'GET') { send(state.words); return; }
    if (url.pathname === '/import_user_dict') { state.imported = await readBody(req); state.words = { ...state.words, ...state.imported }; send(null); return; }
    if (url.pathname === '/user_dict_word' && req.method === 'POST') {
      state.words['00000000-0000-0000-0000-000000000001'] = {
        surface: url.searchParams.get('surface'), pronunciation: url.searchParams.get('pronunciation'),
        accent_type: Number(url.searchParams.get('accent_type')), word_type: url.searchParams.get('word_type'),
        priority: Number(url.searchParams.get('priority')),
      }; send('00000000-0000-0000-0000-000000000001'); return;
    }
    if (url.pathname.startsWith('/user_dict_word/')) {
      const uuid = url.pathname.split('/').at(-1);
      if (req.method === 'DELETE') delete state.words[uuid];
      if (req.method === 'PUT') state.words[uuid] = { surface: url.searchParams.get('surface'), pronunciation: url.searchParams.get('pronunciation'),
        accent_type: Number(url.searchParams.get('accent_type')), word_type: url.searchParams.get('word_type'), priority: Number(url.searchParams.get('priority')) };
      send(null); return;
    }
    if (url.pathname === '/singers') { send([{ name: 'テスト歌手', styles: [
      { id: 6000, name: '教師', type: 'singing_teacher' }, { id: 3001, name: '歌声', type: 'frame_decode' },
    ] }]); return; }
    if (url.pathname === '/engine_manifest') { send({ frame_rate: 100 }); return; }
    if (url.pathname === '/sing_frame_audio_query') { state.teacher = url.searchParams.get('speaker'); state.score = await readBody(req);
      send({ f0: [0, 440], volume: [0, 1], phonemes: [], volumeScale: 1, outputSamplingRate: 24000, outputStereo: false }); return; }
    if (url.pathname === '/frame_synthesis') { state.singer = url.searchParams.get('speaker'); state.frameQuery = await readBody(req);
      res.writeHead(200, { 'Content-Type': 'audio/wav' }); res.end(Buffer.from('RIFFtestWAVE')); return; }
    send({ detail: 'missing' }, 404);
  });
  const enginePort = await listen(mock);
  let first;
  let second;
  try {
    first = await startApp(enginePort, dir);
    const initially = await (await fetch(first.base + '/api/dictionary')).json();
    assert.deepEqual(initially.words, {});
    const invalid = await post(first.base, '/api/dictionary', { surface: 'A', pronunciation: 'hiragana', accentType: 0, wordType: 'PROPER_NOUN', priority: 5 });
    assert.equal(invalid.status, 400);
    const word = { surface: 'VOICEVOX', pronunciation: 'ボイスボックス', accentType: 2, wordType: 'PROPER_NOUN', priority: 5 };
    const added = await post(first.base, '/api/dictionary', word);
    assert.equal(added.status, 201);
    assert.equal(JSON.parse(await readFile(path.join(dir, 'dictionary.json'), 'utf8'))['00000000-0000-0000-0000-000000000001'].surface, word.surface);
    first.app.kill(); first = null;
    state.words = {};
    second = await startApp(enginePort, dir);
    const reloaded = await (await fetch(second.base + '/api/dictionary')).json();
    assert.equal(reloaded.words['00000000-0000-0000-0000-000000000001'].surface, word.surface);
    assert.ok(state.imported);
    const edited = await post(second.base, '/api/dictionary/00000000-0000-0000-0000-000000000001', { ...word, pronunciation: 'ボイス', accentType: 1 }, 'PUT');
    assert.equal(edited.status, 200);
    assert.equal((await edited.json()).words['00000000-0000-0000-0000-000000000001'].pronunciation, 'ボイス');
    const singers = await (await fetch(second.base + '/api/singers')).json();
    assert.equal(singers.frameRate, 100);
    const badSong = await post(second.base, '/api/sing', { teacherStyleId: 3001, singerStyleId: 6000, notes: [{ key: 60, seconds: 0.5, lyric: 'ド' }] });
    assert.equal(badSong.status, 400);
    const song = await post(second.base, '/api/sing', { teacherStyleId: 6000, singerStyleId: 3001,
      notes: [{ key: 60, seconds: 0.5, lyric: 'ド' }, { key: null, seconds: 0.25, lyric: '' }],
      volumeScale: 1.5, outputSamplingRate: 48000, outputStereo: true });
    assert.equal(song.status, 200);
    assert.equal((await song.arrayBuffer()).byteLength, 12);
    assert.equal(state.teacher, '6000'); assert.equal(state.singer, '3001');
    assert.deepEqual(state.score.notes.map(note => note.frame_length), [20, 50, 25, 20]);
    assert.equal(state.frameQuery.volumeScale, 1.5);
    assert.equal(state.frameQuery.outputSamplingRate, 48000);
    assert.equal(state.frameQuery.outputStereo, true);
    const removed = await fetch(second.base + '/api/dictionary/00000000-0000-0000-0000-000000000001', { method: 'DELETE' });
    assert.equal(removed.status, 200);
    assert.deepEqual(JSON.parse(await readFile(path.join(dir, 'dictionary.json'), 'utf8')), {});
  } finally { first?.app.kill(); second?.app.kill(); mock.close(); await rm(dir, { recursive: true, force: true }); }
});
