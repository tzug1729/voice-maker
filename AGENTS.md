# Repository Guidelines

## Project Structure

- `backend/server.mjs` serves the local-only HTTP API and static application.
- `backend/store.mjs` stores presets in the user's local application data folder.
- `backend/core.mjs` validates presets and defines synthesis ranges.
- `public/` contains the reading screen and its controls.
- `test/` contains Node.js built-in test runner coverage using a mock VOICEVOX engine.
- `起動.cmd` starts the app on Windows.

## Development

- Use Node.js 20 or newer and ES modules.
- `npm ci` installs dependencies; this app currently has no third-party dependencies.
- `npm start` listens on `127.0.0.1:3000` by default. VOICEVOX Desktop must be running at `http://127.0.0.1:50021` to synthesize audio.
- `npm test` runs the Node.js tests.
- Keep JavaScript consistent with nearby code: two spaces, single quotes, semicolons, and `camelCase` identifiers.

## Local Data and Privacy

Preset data is stored under `%LOCALAPPDATA%\voice-maker`. Do not commit generated audio, local preset data, dependencies, or personal environment files. The app must continue to bind only to `127.0.0.1`.
