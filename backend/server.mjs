import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUDIO_DEFAULTS, MAX_CHARS, PARAMS, SAMPLE_RATES, publicPreset, validAccentPhrases, validPreset } from './core.mjs';
import { createStore, initialPresets } from './store.mjs';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const engineUrl = process.env.ENGINE_URL || 'http://127.0.0.1:50021';
if (new URL(engineUrl).hostname !== '127.0.0.1' || new URL(engineUrl).protocol !== 'http:') {
  throw new Error('VOICEVOXエンジンは 127.0.0.1 のHTTPアドレスだけを指定できます。');
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const store = createStore();
let dictionaryReady = false;

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 512_000) { const error = new Error('入力が大きすぎます。'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  catch { const error = new Error('入力形式が正しくありません。'); error.status = 400; throw error; }
  const error = new Error('入力形式が正しくありません。'); error.status = 400; throw error;
}

async function bodyWav(req) {
  if (req.headers['content-type']?.split(';')[0] !== 'audio/wav') {
    const error = new Error('WAV形式の音声を送信してください。'); error.status = 415; throw error;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 64 * 1024 * 1024) {
      const error = new Error('音声ファイルが大きすぎます。'); error.status = 413; throw error;
    }
    chunks.push(chunk);
  }
  const audio = Buffer.concat(chunks);
  if (audio.length < 12 || audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') {
    const error = new Error('WAV形式の音声ではありません。'); error.status = 400; throw error;
  }
  return audio;
}

async function engine(endpoint, options = {}, timeout = 45_000) {
  let response;
  try {
    response = await fetch(engineUrl + endpoint, { ...options, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED' || error.cause?.code === 'ECONNRESET' || error.name === 'TimeoutError') {
      const unavailable = new Error('VOICEVOXに接続できません。VOICEVOXデスクトップアプリを起動し、起動完了後にもう一度お試しください。');
      unavailable.status = 503;
      throw unavailable;
    }
    throw error;
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => ({}));
    const reason = typeof detail.detail === 'string' ? detail.detail : '';
    const error = new Error(`VOICEVOXエンジンからエラーが返されました (${response.status})。${reason}`);
    error.status = response.status === 422 || response.status === 400 ? 400 : 502;
    throw error;
  }
  return response;
}

async function getStyles() {
  const response = await engine('/speakers', {}, 10_000);
  const speakers = await response.json();
  return speakers.flatMap(speaker => (speaker.styles || []).filter(style => Number.isInteger(style.id)).map(style => ({
    id: style.id,
    speaker: speaker.name,
    style: style.name,
  })));
}

async function resolveVoice(input) {
  const preset = (await store.getPresets()).find(item => item.id === input.presetId && item.enabled && validPreset(item));
  if (!preset) {
    const error = new Error('プリセットが見つかりません。プリセットJSONを確認してください。'); error.status = 400; throw error;
  }
  const styleId = input.styleId ?? preset.styleId;
  if (!Number.isInteger(styleId) || !(await getStyles()).some(style => style.id === styleId)) {
    const error = new Error('選択した話者・スタイルがVOICEVOXに見つかりません。'); error.status = 400; throw error;
  }
  return { preset, styleId };
}

function validText(text) { return typeof text === 'string' && !!text.trim() && [...text].length <= MAX_CHARS; }
function validReadingText(text) { return text === undefined || (typeof text === 'string' && [...text].length <= MAX_CHARS); }
function spokenText(input) { return input.readingText?.trim() || input.text; }

async function audioQuery(text, styleId) {
  await ensureDictionary();
  const response = await engine(`/audio_query?text=${encodeURIComponent(text.trim())}&speaker=${styleId}`, { method: 'POST' });
  return response.json();
}

async function ensureDictionary() {
  if (dictionaryReady) return;
  const saved = await store.read('dictionary.json', null);
  if (saved && typeof saved === 'object' && !Array.isArray(saved) && Object.keys(saved).length) {
    await engine('/import_user_dict?override=true', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(saved),
    });
  }
  dictionaryReady = true;
}

async function engineDictionary() {
  await ensureDictionary();
  return (await engine('/user_dict')).json();
}

async function saveDictionary() {
  const words = await engineDictionary();
  await store.write('dictionary.json', words);
  return words;
}

function dictionaryFields(input) {
  const types = ['PROPER_NOUN', 'COMMON_NOUN', 'VERB', 'ADJECTIVE', 'SUFFIX'];
  if (typeof input.surface !== 'string' || !input.surface.trim() || input.surface.length > 100
    || typeof input.pronunciation !== 'string' || !/^[ァ-ヴー]+$/.test(input.pronunciation)
    || !Number.isInteger(input.accentType) || input.accentType < 0 || input.accentType > input.pronunciation.length
    || !types.includes(input.wordType) || !Number.isInteger(input.priority) || input.priority < 0 || input.priority > 10) {
    const invalid = new Error('辞書の表記、カタカナの読み、アクセント位置、品詞、優先度を確認してください。');
    invalid.status = 400;
    throw invalid;
  }
  return new URLSearchParams({ surface: input.surface.trim(), pronunciation: input.pronunciation,
    accent_type: String(input.accentType), word_type: input.wordType, priority: String(input.priority) });
}

async function singingStyles() {
  const [singersResponse, manifestResponse] = await Promise.all([
    engine('/singers', {}, 10_000), engine('/engine_manifest', {}, 10_000),
  ]);
  const singers = await singersResponse.json();
  const manifest = await manifestResponse.json();
  const styles = singers.flatMap(singer => (singer.styles || []).map(style => ({
    id: style.id, speaker: singer.name, style: style.name, type: style.type,
  }))).filter(style => Number.isInteger(style.id));
  return { styles, frameRate: Number(manifest.frame_rate) || 93.75 };
}

function validNotes(notes) {
  return Array.isArray(notes) && notes.length > 0 && notes.length <= 200 && notes.every(note =>
    note && (note.key === null || Number.isInteger(note.key) && note.key >= 0 && note.key <= 127)
    && typeof note.seconds === 'number' && Number.isFinite(note.seconds) && note.seconds >= 0.05 && note.seconds <= 10
    && typeof note.lyric === 'string' && note.lyric.length <= 20 && (note.key === null || !!note.lyric.trim()))
    && notes.reduce((sum, note) => sum + note.seconds, 0) <= 120;
}

function error(res, cause) {
  const status = cause.status || 500;
  json(res, status, { error: cause.message || '処理に失敗しました。' });
  if (status >= 500) console.error(cause);
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${host}:${port}`);
  try {
    if (req.headers.origin && req.headers.origin !== url.origin) {
      json(res, 403, { error: '別のWebサイトからの操作は許可されていません。' });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/health') {
      try { await engine('/version', {}, 3_000); json(res, 200, { ready: true }); }
      catch (cause) { json(res, 503, { ready: false, error: cause.message }); }
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/presets') {
      const presets = (await store.getPresets()).filter(preset => preset.enabled && validPreset(preset));
      const packaged = initialPresets.filter(validPreset);
      json(res, 200, { presets: presets.map(preset => ({
        ...publicPreset(preset),
        sourcePresetId: preset.sourcePresetId || packaged.find(item => item.id === preset.id || item.styleId === preset.styleId)?.id,
      })), maxChars: MAX_CHARS });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/speakers') {
      json(res, 200, { speakers: await getStyles() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/dictionary') {
      const words = await engineDictionary();
      await store.write('dictionary.json', words);
      json(res, 200, { words, storagePath: path.join(store.dir, 'dictionary.json') });
      return;
    }
    if (url.pathname === '/api/dictionary' && req.method === 'POST') {
      const fields = dictionaryFields(await bodyJson(req));
      await ensureDictionary();
      await engine(`/user_dict_word?${fields}`, { method: 'POST' });
      json(res, 201, { words: await saveDictionary() });
      return;
    }
    const dictionaryWord = /^\/api\/dictionary\/([0-9a-f-]{36})$/i.exec(url.pathname);
    if (dictionaryWord && (req.method === 'PUT' || req.method === 'DELETE')) {
      await ensureDictionary();
      const fields = req.method === 'PUT' ? `?${dictionaryFields(await bodyJson(req))}` : '';
      await engine(`/user_dict_word/${dictionaryWord[1]}${fields}`, { method: req.method });
      json(res, 200, { words: await saveDictionary() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/singers') {
      json(res, 200, await singingStyles());
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/sing') {
      const input = await bodyJson(req);
      const { styles, frameRate } = await singingStyles();
      if (!Number.isInteger(input.teacherStyleId) || !Number.isInteger(input.singerStyleId)
        || !styles.some(style => style.id === input.teacherStyleId && ['sing', 'singing_teacher'].includes(style.type))
        || !styles.some(style => style.id === input.singerStyleId && style.type === 'frame_decode')
        || !validNotes(input.notes)) {
        json(res, 400, { error: '歌唱スタイル、音符、長さ、歌詞を確認してください。' }); return;
      }
      const notes = [{ key: null, frame_length: Math.max(1, Math.round(frameRate * 0.2)), lyric: '' },
        ...input.notes.map(note => ({ key: note.key, frame_length: Math.max(1, Math.round(note.seconds * frameRate)), lyric: note.key === null ? '' : note.lyric.trim() })),
        { key: null, frame_length: Math.max(1, Math.round(frameRate * 0.2)), lyric: '' }];
      const queryResponse = await engine(`/sing_frame_audio_query?speaker=${input.teacherStyleId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }),
      }, 90_000);
      const query = await queryResponse.json();
      query.volumeScale = input.volumeScale ?? 1;
      query.outputSamplingRate = input.outputSamplingRate ?? 24000;
      query.outputStereo = input.outputStereo ?? false;
      if (typeof query.volumeScale !== 'number' || !Number.isFinite(query.volumeScale) || query.volumeScale < 0 || query.volumeScale > 2
        || !SAMPLE_RATES.includes(query.outputSamplingRate) || typeof query.outputStereo !== 'boolean') {
        json(res, 400, { error: '歌唱音声の出力設定を確認してください。' }); return;
      }
      const wavResponse = await engine(`/frame_synthesis?speaker=${input.singerStyleId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
      }, 120_000);
      const audio = Buffer.from(await wavResponse.arrayBuffer());
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length, 'Cache-Control': 'no-store' });
      res.end(audio);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/presets') {
      const input = await bodyJson(req);
      const packagedIds = new Set(initialPresets.filter(validPreset).map(preset => preset.id));
      if (!validPreset(input) || initialPresets.some(preset => preset.id === input.id)
        || !packagedIds.has(input.sourcePresetId)
        || !(await getStyles()).some(style => style.id === input.styleId)) {
        json(res, 400, { error: 'プリセット名と話者・スタイル、設定値を確認してください。' }); return;
      }
      const preset = { ...input, defaultText: null };
      await store.savePreset(preset);
      json(res, 201, { preset: { ...publicPreset(preset), sourcePresetId: preset.sourcePresetId }, storagePath: path.join(store.dir, 'presets.json') });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/wav') {
      const audio = await bodyWav(req);
      const file = path.join(store.dir, `voice-${Date.now()}-${randomUUID().slice(0, 8)}.wav`);
      await writeFile(file, audio, { flag: 'wx' });
      json(res, 201, { storagePath: file });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/query') {
      const input = await bodyJson(req);
      if (!validText(input.text) || !validReadingText(input.readingText)) { json(res, 400, { error: `文章は1〜${MAX_CHARS}文字で入力してください。` }); return; }
      const { styleId } = await resolveVoice(input);
      const query = await audioQuery(spokenText(input), styleId);
      if (!validAccentPhrases(query.accent_phrases)) {
        json(res, 502, { error: 'VOICEVOXのアクセント解析結果を読み込めませんでした。' }); return;
      }
      json(res, 200, { accentPhrases: query.accent_phrases });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/mora-data') {
      const input = await bodyJson(req);
      if (!validAccentPhrases([input.accentPhrase])) {
        json(res, 400, { error: 'アクセント句のデータが正しくありません。' }); return;
      }
      const { styleId } = await resolveVoice(input);
      const response = await engine(`/mora_data?speaker=${styleId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([input.accentPhrase]),
      });
      const phrase = (await response.json())[0];
      if (!validAccentPhrases([phrase])) {
        json(res, 502, { error: 'VOICEVOXの再計算結果を読み込めませんでした。' }); return;
      }
      json(res, 200, { accentPhrase: phrase });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/synthesize') {
      const input = await bodyJson(req);
      const text = input.text;
      if (!validText(text) || !validReadingText(input.readingText)) {
        json(res, 400, { error: `文章は1〜${MAX_CHARS}文字で入力してください。` }); return;
      }
      const { preset, styleId } = await resolveVoice(input);
      const parameters = input.parameters ?? {};
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        json(res, 400, { error: '読み上げパラメータの形式が正しくありません。' }); return;
      }
      for (const [key, [min, max]] of Object.entries(PARAMS)) {
        if (Object.hasOwn(parameters, key) && (typeof parameters[key] !== 'number' || !Number.isFinite(parameters[key]) || parameters[key] < min || parameters[key] > max)) {
          json(res, 400, { error: '読み上げパラメータが範囲外です。画面のスライダーを確認してください。' }); return;
        }
      }
      const options = input.options ?? {};
      if (!options || typeof options !== 'object' || Array.isArray(options)
        || (Object.hasOwn(options, 'outputSamplingRate') && !SAMPLE_RATES.includes(options.outputSamplingRate))
        || (Object.hasOwn(options, 'pauseLength') && options.pauseLength !== null
          && (typeof options.pauseLength !== 'number' || !Number.isFinite(options.pauseLength)
            || options.pauseLength < 0 || options.pauseLength > 5))
        || (Object.hasOwn(options, 'outputStereo') && typeof options.outputStereo !== 'boolean')
        || (Object.hasOwn(options, 'enableInterrogativeUpspeak') && typeof options.enableInterrogativeUpspeak !== 'boolean')) {
        json(res, 400, { error: '音声出力の設定が正しくありません。' }); return;
      }
      if (input.accentPhrases !== undefined && !validAccentPhrases(input.accentPhrases)) {
        json(res, 400, { error: 'アクセント句のデータが正しくありません。' }); return;
      }
      const query = await audioQuery(spokenText(input), styleId);
      for (const key of Object.keys(PARAMS)) {
        query[key] = Object.hasOwn(parameters, key) ? parameters[key] : preset[key] ?? AUDIO_DEFAULTS[key];
      }
      query.outputSamplingRate = options.outputSamplingRate ?? preset.outputSamplingRate ?? AUDIO_DEFAULTS.outputSamplingRate;
      query.outputStereo = options.outputStereo ?? preset.outputStereo ?? AUDIO_DEFAULTS.outputStereo;
      query.pauseLength = Object.hasOwn(options, 'pauseLength') ? options.pauseLength : preset.pauseLength ?? AUDIO_DEFAULTS.pauseLength;
      if (input.accentPhrases) query.accent_phrases = input.accentPhrases;
      const upspeak = options.enableInterrogativeUpspeak ?? preset.enableInterrogativeUpspeak ?? AUDIO_DEFAULTS.enableInterrogativeUpspeak;
      const audioResponse = await engine(`/synthesis?speaker=${styleId}&enable_interrogative_upspeak=${upspeak}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
      }, 90_000);
      const audio = Buffer.from(await audioResponse.arrayBuffer());
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length,
        'Content-Disposition': `attachment; filename="voice-${randomUUID().slice(0, 8)}.wav"`, 'Cache-Control': 'no-store' });
      res.end(audio);
      return;
    }
    const assets = new Map([
      ['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'],
      ['/style.css', 'style.css'], ['/parameters.css', 'parameters.css'],
      ['/extras.js', 'extras.js'], ['/extras.css', 'extras.css'],
    ]);
    if (req.method === 'GET' && assets.has(url.pathname)) {
      const name = assets.get(url.pathname);
      const type = name.endsWith('.html') ? 'text/html; charset=utf-8' : name.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/css; charset=utf-8';
      res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' });
      res.end(await readFile(path.join(root, name)));
      return;
    }
    json(res, 404, { error: 'ページが見つかりません。' });
  } catch (cause) { error(res, cause); }
}

http.createServer(handler).listen(port, host, () => {
  console.log(`声をつくる: http://${host}:${port}`);
  console.log('終了するには Ctrl+C を押してください。');
});
