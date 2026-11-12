import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';

async function listen(server) { await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); return server.address().port; }
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a fresh source copy starts without dependencies or user files', async () => {
  const dataRoot = path.join(process.cwd(), 'data');
  await mkdir(dataRoot, { recursive: true });
  const copy = await mkdtemp(path.join(dataRoot, 'fresh-source-'));
  for (const name of ['backend', 'public', 'presets.default.json', 'package.json', '起動.cmd']) {
    await cp(path.join(process.cwd(), name), path.join(copy, name), { recursive: true });
  }
  const probe = http.createServer(); const port = await listen(probe); probe.close();
  const app = spawn(process.execPath, ['backend/server.mjs'], { cwd: copy,
    env: { ...process.env, PORT: String(port), ENGINE_URL: 'http://127.0.0.1:59999' }, stdio: 'ignore' });
  try {
    let home;
    for (let i = 0; i < 50; i++) {
      try { home = await fetch(`http://127.0.0.1:${port}/`); break; } catch {} await pause(100);
    }
    assert.equal(home.status, 200);
    assert.match(await home.text(), /読み上げ/);
    assert.equal((await fetch(`http://127.0.0.1:${port}/extras.js`)).status, 200);
    assert.equal((await fetch(`http://127.0.0.1:${port}/extras.css`)).status, 200);
    const presets = await (await fetch(`http://127.0.0.1:${port}/api/presets`)).json();
    assert.ok(presets.presets.some(preset => preset.name === 'ヒナ'));
    const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json();
    assert.equal(health.ready, false);
    assert.match(health.error, /VOICEVOXデスクトップアプリを起動/);
  } finally {
    const exited = new Promise(resolve => app.once('exit', resolve));
    app.kill();
    await exited;
    await rm(copy, { recursive: true, force: true });
  }
});
