# Vibe Mind Run Guide

This document explains the simplest way to run `vibe-mind` locally.

## Prerequisites

Required:

- `Node.js`
- `npm`
- `codex` CLI installed
- `codex` CLI logged in

Versions verified in the current environment:

- `node v22.22.1`
- `npm 10.9.4`

Check Codex login status first:

```bash
codex login status
```

If needed, log in:

```bash
codex login
```

## Environment Variables

The project can run without a `.env` file, but using one is the easiest way to control the local server port or force a Codex model.

```bash
cp .env.example .env
```

Example:

```env
PORT=8787

# Optional. Leave empty to use the Codex CLI default model for your ChatGPT account.
CODEX_MODEL=
```

Meaning:

- `PORT`: local API server port. Default is `8787`
- `CODEX_MODEL`: if empty, the app uses the Codex CLI default model

## Development Mode

Install dependencies and start the app:

```bash
npm install
npm run dev
```

This starts both processes:

- API server: `http://127.0.0.1:8787`
- Vite frontend: usually `http://localhost:5173`

In development mode, the frontend proxies `/api` requests to `http://localhost:8787`.

Open:

```text
http://localhost:5173
```

## Production-style Local Serve

Build the frontend first, then serve the built app from the local Node server:

```bash
npm run build
npm run serve
```

Open:

```text
http://127.0.0.1:8787
```

`npm run serve` serves both the built `dist` assets and the `/api` endpoints.

## Verification Commands

If you want to validate the project before or after running it:

```bash
npm run lint
npm run build
codex login status
```

After the server starts, you can also check:

```text
http://127.0.0.1:8787/api/health
```

## Common Problems

### `codex: command not found`

- The Codex CLI is not installed or not available on `PATH`.
- `codex login status` should work before app generation features can work.

### Port conflict

- If `8787` is already in use, change `PORT` in `.env`.
- Restart the server after changing it.

### `npm run serve` shows no app

- `npm run build` must succeed first so that `dist` exists.

### `npm` cannot find `package.json`

- Run commands from the repository root:

```bash
cd /home/dhihm/vibe-mind
```

- Or run with `--prefix`:

```bash
npm --prefix /home/dhihm/vibe-mind run dev
```

## Shortest Working Sequence

```bash
cd /home/dhihm/vibe-mind
codex login status
cp .env.example .env
npm install
npm run dev
```

Then open:

```text
http://localhost:5173
```
