/**
 * string.md – optional git backend server
 *
 * Exposes the local git repository over a minimal HTTP API so that
 * index.html can read and write files and browse the commit log.
 *
 * Usage:
 *   npm install
 *   node server.js [--port 3000] [--repo /path/to/repo]
 *
 * Endpoints:
 *   GET  /file?path=<relPath>[&sha=<commitSha>]   read file content
 *   POST /file  { path, content, message }         write & commit file
 *   GET  /log?path=<relPath>[&limit=30]            git log for file
 *   GET  /health                                   liveness check
 */

'use strict';

const http   = require('http');
const path   = require('path');
const fs     = require('fs');
const { simpleGit } = require('simple-git');

// ── CLI args ──────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(flag, def) {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : def;
}

const PORT     = parseInt(getArg('--port', process.env.PORT || '3000'), 10);
const REPO_DIR = path.resolve(getArg('--repo', process.env.REPO_DIR || '.'));

const git = simpleGit(REPO_DIR);

// ── Helpers ────────────────────────────────────────────────────────────────────
// NOTE: Access-Control-Allow-Origin is set to '*' because this server is
// intended for local development only. Do NOT expose it to the public internet
// without adding proper authentication and origin restriction.
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(json);
}

const MAX_BODY_BYTES = 10 * 1024 * 1024; // 10 MB

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let bytes = 0;
    req.on('data', chunk => {
      bytes += Buffer.byteLength(chunk);
      if (bytes > MAX_BODY_BYTES) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      data += chunk;
    });
    req.on('end', () => {
      try { resolve(JSON.parse(data || '{}')); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

/** Validate a git commit SHA (4–40 hex characters). */
function isValidSha(sha) {
  return typeof sha === 'string' && /^[0-9a-f]{4,40}$/i.test(sha);
}

/**
 * Resolve a relative file path, ensuring it stays within REPO_DIR.
 * Returns null if the path escapes the repo root (path traversal guard).
 */
function safeResolve(relPath) {
  if (!relPath || typeof relPath !== 'string') return null;
  const resolved = path.resolve(REPO_DIR, relPath);
  const rel = path.relative(REPO_DIR, resolved);
  // Reject if relative path starts with '..' (escapes repo root) or is absolute
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return resolved;
}

// ── Route handlers ────────────────────────────────────────────────────────────

/** GET /health */
async function handleHealth(res) {
  const status = await git.status();
  send(res, 200, { ok: true, branch: status.current });
}

/** GET /file?path=<relPath>[&sha=<sha>] */
async function handleFileGet(req, res, query) {
  const relPath = query.get('path');
  const sha     = query.get('sha');

  const absPath = safeResolve(relPath);
  if (!absPath) { send(res, 400, { error: 'Invalid path' }); return; }

  if (sha && !isValidSha(sha)) {
    send(res, 400, { error: 'Invalid sha format' }); return;
  }

  try {
    let content;
    const branch = await git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'main');

    if (sha) {
      // Read file at a specific commit
      content = await git.show([`${sha}:${relPath}`]);
    } else {
      content = await fs.promises.readFile(absPath, 'utf8');
    }

    send(res, 200, { content, branch: branch.trim(), path: relPath });
  } catch (err) {
    console.error('[GET /file]', err.message);
    send(res, 404, { error: 'File not found or inaccessible' });
  }
}

/** POST /file  { path, content, message } */
async function handleFilePost(req, res) {
  let body;
  try { body = await parseBody(req); }
  catch (e) {
    const isTooBig = e.message === 'Request body too large';
    send(res, isTooBig ? 413 : 400, { error: isTooBig ? 'Request body too large' : 'Invalid JSON body' });
    return;
  }

  const { content, message } = body;
  const relPath = body.path;

  const absPath = safeResolve(relPath);
  if (!absPath) { send(res, 400, { error: 'Invalid path' }); return; }
  if (typeof content !== 'string') { send(res, 400, { error: 'content must be a string' }); return; }

  const commitMsg = (typeof message === 'string' && message.trim())
    ? message.trim()
    : 'Update via string.md';

  try {
    // Ensure parent directories exist
    await fs.promises.mkdir(path.dirname(absPath), { recursive: true });
    await fs.promises.writeFile(absPath, content, 'utf8');
    await git.add(relPath);
    const result = await git.commit(commitMsg, relPath);
    send(res, 200, { ok: true, sha: result.commit });
  } catch (err) {
    console.error('[POST /file]', err.message);
    send(res, 500, { error: 'Failed to save and commit file' });
  }
}

/** GET /log?path=<relPath>[&limit=30] */
async function handleLog(req, res, query) {
  const relPath = query.get('path');
  const limit   = Math.min(parseInt(query.get('limit') || '30', 10), 100);

  if (!relPath) { send(res, 400, { error: 'path is required' }); return; }

  // Validate path to prevent traversal
  const absPath = safeResolve(relPath);
  if (!absPath) { send(res, 400, { error: 'Invalid path' }); return; }

  try {
    const log = await git.log({ file: relPath, maxCount: limit });
    const entries = log.all.map(c => ({
      sha:     c.hash,
      message: c.message,
      author:  c.author_name,
      date:    c.date,
    }));
    send(res, 200, entries);
  } catch (err) {
    console.error('[GET /log]', err.message);
    send(res, 500, { error: 'Failed to retrieve commit log' });
  }
}

// ── Server ────────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin':  '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end();
    return;
  }

  const url   = new URL(req.url, `http://localhost:${PORT}`);
  const route = url.pathname;
  const query = url.searchParams;

  try {
    if (route === '/health' && req.method === 'GET') {
      await handleHealth(res);
    } else if (route === '/file' && req.method === 'GET') {
      await handleFileGet(req, res, query);
    } else if (route === '/file' && req.method === 'POST') {
      await handleFilePost(req, res);
    } else if (route === '/log' && req.method === 'GET') {
      await handleLog(req, res, query);
    } else {
      send(res, 404, { error: 'Not found' });
    }
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  console.log(`string.md git backend running on http://localhost:${PORT}`);
  console.log(`Repository: ${REPO_DIR}`);
});

module.exports = server; // for testing
