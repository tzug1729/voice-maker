import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MAX_CHARS, PARAMS, publicPreset, validPreset } from './core.mjs';
import { createStore } from './store.mjs';

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
  return (await response.json()).flatMap(speaker => (speaker.styles || []).map(style => ({
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
      json(res, 200, { presets: presets.map(publicPreset), maxChars: MAX_CHARS });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/speakers') {
      json(res, 200, { speakers: await getStyles() });
      return;
    }
    if (req.method === 'GET' && url.pathname === '/api/admin/presets') {
      json(res, 200, { presets: await store.getPresets() });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/admin/presets') {
      const input = await bodyJson(req);
      if (input.id === 'hina' || !validPreset(input)) { json(res, 400, { error: 'プリセット名、話者・スタイル、設定値を確認してください。' }); return; }
      if (!(await getStyles()).some(style => style.id === input.styleId)) { json(res, 400, { error: '選択したスタイルがVOICEVOXに見つかりません。' }); return; }
      await store.savePreset(input);
      json(res, 201, { preset: input });
      return;
    }
    const presetRoute = url.pathname.match(/^\/api\/admin\/presets\/([a-z0-9][a-z0-9-]{0,39})$/);
    if (presetRoute && req.method === 'PUT') {
      const id = presetRoute[1];
      const input = { ...await bodyJson(req), id, ...(id === 'hina' ? { name: 'ヒナ' } : {}) };
      if (!validPreset(input)) { json(res, 400, { error: 'プリセット名、話者・スタイル、設定値を確認してください。' }); return; }
      if (!(await getStyles()).some(style => style.id === input.styleId)) { json(res, 400, { error: '選択したスタイルがVOICEVOXに見つかりません。' }); return; }
      await store.savePreset(input);
      json(res, 200, { preset: input });
      return;
    }
    if (presetRoute && req.method === 'DELETE') {
      if (presetRoute[1] === 'hina') { json(res, 400, { error: 'ヒナの初期設定は削除できません。利用不可のまま保存できます。' }); return; }
      await store.deletePreset(presetRoute[1]);
      json(res, 200, { ok: true });
      return;
    }
    if (req.method === 'POST' && url.pathname === '/api/synthesize') {
      const input = await bodyJson(req);
      const text = input.text;
      if (typeof text !== 'string' || !text.trim() || [...text].length > MAX_CHARS) {
        json(res, 400, { error: `文章は1〜${MAX_CHARS}文字で入力してください。` }); return;
      }
      const preset = (await store.getPresets()).find(item => item.id === input.presetId && item.enabled && validPreset(item));
      if (!preset) { json(res, 400, { error: 'このプリセットは未設定か無効です。管理画面で設定して保存してください。' }); return; }
      const queryResponse = await engine(`/audio_query?text=${encodeURIComponent(text.trim())}&speaker=${preset.styleId}`, { method: 'POST' });
      const query = await queryResponse.json();
      for (const key of Object.keys(PARAMS)) query[key] = preset[key];
      const audioResponse = await engine(`/synthesis?speaker=${preset.styleId}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(query),
      }, 90_000);
      const audio = Buffer.from(await audioResponse.arrayBuffer());
      res.writeHead(200, { 'Content-Type': 'audio/wav', 'Content-Length': audio.length,
        'Content-Disposition': `attachment; filename="voice-${randomUUID().slice(0, 8)}.wav"`, 'Cache-Control': 'no-store' });
      res.end(audio);
      return;
    }
    const assets = new Map([
      ['/', 'index.html'], ['/index.html', 'index.html'], ['/app.js', 'app.js'], ['/admin.html', 'admin.html'],
      ['/admin.js', 'admin.js'], ['/style.css', 'style.css'],
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
