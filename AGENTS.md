# Repository Guidelines

## Project Structure

- `backend/server.mjs` serves the local-only HTTP API and static application.
- `backend/store.mjs` stores personal presets in `presets.json` and dictionary data in `dictionary.json` at the repository root.
- `backend/core.mjs` validates presets and defines synthesis ranges.
- `public/` contains the reading, dictionary, and singing screens and their controls.
- `test/` contains Node.js built-in test runner coverage using a mock VOICEVOX engine.
- `scripts/real-engine-smoke.mjs` checks the app against a running VOICEVOX Desktop engine.
- `起動.cmd` starts the app on Windows.

## Development

- Use Node.js 20 or newer and ES modules.
- `npm ci` installs dependencies; this app currently has no third-party dependencies.
- `npm start` listens on `127.0.0.1:3000` by default. VOICEVOX Desktop must be running at `http://127.0.0.1:50021` to synthesize audio.
- `npm test` runs the Node.js tests.
- Keep JavaScript consistent with nearby code: two spaces, single quotes, semicolons, and `camelCase` identifiers.

## Local Data and Privacy

Personal presets, dictionary data, and saved WAV files stay at the repository root and are ignored by Git. Do not commit generated audio, local preset data, dependencies, or personal environment files. The app and its VOICEVOX engine connection must continue to use only `127.0.0.1`.
