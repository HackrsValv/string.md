/**
 * string.md — Cloudflare Worker backend
 *
 * A serverless alternative to server.js that runs on Cloudflare Workers
 * using Workers KV for persistent document and history storage.
 *
 * Setup:
 *   1. Install Wrangler: npm install -g wrangler
 *   2. Create a KV namespace: wrangler kv:namespace create STRING_MD_KV
 *   3. Update wrangler.toml with the returned namespace ID
 *   4. Deploy: wrangler deploy
 *
 * KV key schema:
 *   file:<path>          → current content of the file
 *   log:<path>           → JSON array of commit objects (newest first, max 100)
 *
 * Endpoints (same interface as server.js):
 *   GET  /file?path=<p>[&sha=<logIndex>]  read file (sha = log entry index)
 *   POST /file  { path, content, message }  write & record history entry
 *   GET  /log?path=<p>[&limit=30]          history for a file
 *   GET  /health                            liveness check
 */

const MAX_LOG_ENTRIES = 100;
const MAX_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB

// ── Helpers ───────────────────────────────────────────────────────────────────

/** CORS headers for all responses. Restrict ALLOWED_ORIGIN in wrangler.toml vars. */
function corsHeaders(env) {
  const origin = env.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin':  origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(env) },
  });
}

/** Validate a file path: no leading slash, no path traversal. */
function isValidPath(p) {
  if (!p || typeof p !== 'string') return false;
  if (p.startsWith('/') || p.includes('..')) return false;
  // Allow only printable ASCII (no null bytes, etc.)
  return /^[\x20-\x7E]+$/.test(p);
}

// ── Route handlers ────────────────────────────────────────────────────────────

/** GET /health */
function handleHealth(env) {
  return json({ ok: true, backend: 'cloudflare-worker' }, 200, env);
}

/** GET /file?path=<p>[&sha=<index>] */
async function handleFileGet(query, env) {
  const filePath = query.get('path');
  const sha      = query.get('sha');  // reused as log-entry index for Worker backend

  if (!isValidPath(filePath)) return json({ error: 'Invalid path' }, 400, env);

  const key = `file:${filePath}`;

  if (sha !== null) {
    // Load a historical snapshot from the log
    const logKey  = `log:${filePath}`;
    const logJson = await env.STRING_MD_KV.get(logKey);
    if (!logJson) return json({ error: 'No history found' }, 404, env);
    const log = JSON.parse(logJson);
    // sha is used as a unique commit id stored in the log entry
    const entry = log.find(e => e.sha === sha);
    if (!entry) return json({ error: 'Commit not found' }, 404, env);
    return json({ content: entry.snapshot, branch: 'kv', path: filePath }, 200, env);
  }

  const content = await env.STRING_MD_KV.get(key);
  if (content === null) return json({ error: 'File not found' }, 404, env);
  return json({ content, branch: 'kv', path: filePath }, 200, env);
}

/** POST /file  { path, content, message } */
async function handleFilePost(request, env) {
  const contentLength = parseInt(request.headers.get('content-length') || '0', 10);
  if (contentLength > MAX_CONTENT_BYTES) {
    return json({ error: 'Request body too large' }, 413, env);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, env);
  }

  const { content, message } = body;
  const filePath = body.path;

  if (!isValidPath(filePath)) return json({ error: 'Invalid path' }, 400, env);
  if (typeof content !== 'string') return json({ error: 'content must be a string' }, 400, env);

  const commitMsg = (typeof message === 'string' && message.trim())
    ? message.trim()
    : 'Update via string.md';

  const sha = crypto.randomUUID().replace(/-/g, '').slice(0, 40);
  const entry = {
    sha,
    message: commitMsg,
    author:  'string.md',
    date:    new Date().toISOString(),
    snapshot: content,
  };

  // Update KV: current content
  await env.STRING_MD_KV.put(`file:${filePath}`, content);

  // Update KV: log (prepend, cap at MAX_LOG_ENTRIES)
  const logKey  = `log:${filePath}`;
  const logJson = await env.STRING_MD_KV.get(logKey);
  const log     = logJson ? JSON.parse(logJson) : [];
  log.unshift(entry);
  if (log.length > MAX_LOG_ENTRIES) log.splice(MAX_LOG_ENTRIES);
  await env.STRING_MD_KV.put(logKey, JSON.stringify(log));

  return json({ ok: true, sha }, 200, env);
}

/** GET /log?path=<p>[&limit=30] */
async function handleLog(query, env) {
  const filePath = query.get('path');
  const limit    = Math.min(parseInt(query.get('limit') || '30', 10), 100);

  if (!isValidPath(filePath)) return json({ error: 'Invalid path' }, 400, env);

  const logKey  = `log:${filePath}`;
  const logJson = await env.STRING_MD_KV.get(logKey);
  if (!logJson) return json([], 200, env);

  const log = JSON.parse(logJson);
  // Strip snapshot from log listing to keep response small
  const entries = log.slice(0, limit).map(({ sha, message, author, date }) =>
    ({ sha, message, author, date })
  );
  return json(entries, 200, env);
}

// ── Worker entry point ────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const url    = new URL(request.url);
    const route  = url.pathname;
    const query  = url.searchParams;
    const method = request.method;

    // CORS preflight
    if (method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(env) });
    }

    if (route === '/health' && method === 'GET') {
      return handleHealth(env);
    }
    if (route === '/file' && method === 'GET') {
      return handleFileGet(query, env);
    }
    if (route === '/file' && method === 'POST') {
      return handleFilePost(request, env);
    }
    if (route === '/log' && method === 'GET') {
      return handleLog(query, env);
    }

    return json({ error: 'Not found' }, 404, env);
  },
};
