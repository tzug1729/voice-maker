import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CHARS, PARAMS, publicPreset, validPreset } from './core.mjs';
import { createStore, initialPresets } from './store.mjs';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 3000);
const engineUrl = process.env.ENGINE_URL || 'http://127.0.0.1:50021';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const store = createStore();

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function bodyJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 32_768) { const error = new Error('入力が大きすぎます。'); error.status = 413; throw error; }
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { const error = new Error('入力形式が正しくありません。'); error.status = 400; throw error; }
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
    const error = new Error(`VOICEVOXエンジンからエラーが返されました (${response.status})。`);
    error.status = 502;
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
    if (req.method === 'POST' && url.pathname === '/api/synthesize') {
      const input = await bodyJson(req);
      const text = input.text;
      if (typeof text !== 'string' || !text.trim() || [...text].length > MAX_CHARS) {
        json(res, 400, { error: `文章は1〜${MAX_CHARS}文字で入力してください。` }); return;
      }
      const preset = (await store.getPresets()).find(item => item.id === input.presetId && item.enabled && validPreset(item));
      if (!preset) { json(res, 400, { error: 'このプリセットは未設定か無効です。配布用または利用者用のプリセットJSONを確認してください。' }); return; }
      const styleId = input.styleId ?? preset.styleId;
      if (!Number.isInteger(styleId) || !(await getStyles()).some(style => style.id === styleId)) {
        json(res, 400, { error: '選択した話者・スタイルがVOICEVOXに見つかりません。' }); return;
      }
      const parameters = input.parameters ?? {};
      if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) {
        json(res, 400, { error: '読み上げパラメータの形式が正しくありません。' }); return;
      }
      for (const [key, [min, max]] of Object.entries(PARAMS)) {
        if (Object.hasOwn(parameters, key) && (typeof parameters[key] !== 'number' || !Number.isFinite(parameters[key]) || parameters[key] < min || parameters[key] > max)) {
          json(res, 400, { error: '読み上げパラメータが範囲外です。画面のスライダーを確認してください。' }); return;
        }
      }
      const queryResponse = await engine(`/audio_query?text=${encodeURIComponent(text.trim())}&speaker=${styleId}`, { method: 'POST' });
      const query = await queryResponse.json();
      for (const key of Object.keys(PARAMS)) query[key] = Object.hasOwn(parameters, key) ? parameters[key] : preset[key];
      const audioResponse = await engine(`/synthesis?speaker=${styleId}`, {
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
