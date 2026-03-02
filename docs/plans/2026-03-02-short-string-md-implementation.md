# short.string.md Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a serverless URL shortener at `short.string.md` — a single static HTML page that shortens URLs via compression and Nostr-backed aliases.

**Architecture:** Single HTML file with inline CSS/JS, no build step. Two URL formats: `#c/<compressed>` (self-contained) and `#n/<alias>` (Nostr-resolved). Resolution waterfall: localStorage → P2P peers → Nostr relays → fallback. Libraries loaded from CDN via ES module imports.

**Tech Stack:** LZ-String (compression), nostr-tools (event signing/publishing), Trystero v0.22.0 (P2P via WebRTC+Nostr signaling), SubtleCrypto (optional encryption)

**Reference:** Design doc at `docs/plans/2026-03-02-serverless-url-shortener-design.md`

**Patterns from string.md to follow:**
- Inline `<script>` for bundled libs (LZ-String), `<script type="module">` for CDN imports (Trystero, nostr-tools)
- `window._initReady = init()` pattern for async init coordination
- Dark GitHub theme CSS variables (--bg, --panel-bg, --border, --accent, --text, --text-dim)
- URL-safe base64: replace `+`→`-`, `/`→`_`, strip trailing `=`

---

### Task 1: HTML Scaffold + CSS

**Files:**
- Create: `short.html`

**Step 1: Create the HTML file with basic structure and CSS**

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>short.string.md</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      --bg:         #0d1117;
      --panel-bg:   #161b22;
      --border:     #30363d;
      --accent:     #58a6ff;
      --accent2:    #f78166;
      --text:       #e6edf3;
      --text-dim:   #8b949e;
      --green:      #3fb950;
      --red:        #f85149;
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    header {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 14px;
      background: var(--panel-bg);
      border-bottom: 1px solid var(--border);
    }

    .logo {
      font-size: 1.1rem;
      font-weight: 700;
      color: var(--accent);
      letter-spacing: -0.02em;
      text-decoration: none;
    }

    .status {
      margin-left: auto;
      font-size: 0.8rem;
      color: var(--text-dim);
    }

    main {
      width: 100%;
      max-width: 640px;
      padding: 40px 20px;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    h1 {
      font-size: 1.4rem;
      font-weight: 600;
    }

    .input-group {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    #url-input {
      width: 100%;
      padding: 10px 12px;
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.95rem;
      font-family: monospace;
      outline: none;
      resize: vertical;
      min-height: 44px;
    }
    #url-input:focus { border-color: var(--accent); }
    #url-input::placeholder { color: var(--text-dim); }

    .btn-row {
      display: flex;
      gap: 8px;
    }

    button {
      background: transparent;
      color: var(--text);
      border: 1px solid var(--border);
      padding: 8px 16px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 0.85rem;
      transition: background 0.15s, border-color 0.15s;
    }
    button:hover { background: rgba(255,255,255,0.07); border-color: var(--accent); }
    button:disabled { opacity: 0.4; cursor: default; }
    button:disabled:hover { background: transparent; border-color: var(--border); }
    button.primary { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
    button.primary:hover { background: #79c0ff; }

    .results {
      display: none;
      flex-direction: column;
      gap: 14px;
    }
    .results.visible { display: flex; }

    .result-card {
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .result-label {
      font-size: 0.75rem;
      font-weight: 600;
      color: var(--text-dim);
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }

    .result-url {
      font-family: monospace;
      font-size: 0.85rem;
      word-break: break-all;
      color: var(--accent);
      cursor: pointer;
    }
    .result-url:hover { text-decoration: underline; }

    .result-meta {
      font-size: 0.75rem;
      color: var(--text-dim);
    }

    .copy-btn {
      align-self: flex-start;
      font-size: 0.78rem;
      padding: 4px 10px;
    }

    .alias-input-row {
      display: flex;
      gap: 8px;
      align-items: center;
    }

    #alias-input {
      flex: 1;
      padding: 8px 10px;
      background: var(--panel-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      color: var(--text);
      font-size: 0.9rem;
      font-family: monospace;
      outline: none;
    }
    #alias-input:focus { border-color: var(--accent); }
    #alias-input::placeholder { color: var(--text-dim); }

    .toast {
      position: fixed;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      background: var(--green);
      color: #000;
      padding: 8px 18px;
      border-radius: 6px;
      font-size: 0.85rem;
      font-weight: 600;
      opacity: 0;
      transition: opacity 0.3s;
      pointer-events: none;
    }
    .toast.visible { opacity: 1; }

    .resolve-view {
      display: none;
      text-align: center;
      gap: 12px;
      flex-direction: column;
      align-items: center;
    }
    .resolve-view.visible { display: flex; }

    .spinner {
      width: 24px;
      height: 24px;
      border: 3px solid var(--border);
      border-top-color: var(--accent);
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }

    .resolve-status {
      font-size: 0.9rem;
      color: var(--text-dim);
    }

    .error-msg {
      color: var(--red);
      font-size: 0.85rem;
    }

    .error-msg a {
      color: var(--accent);
    }
  </style>
</head>
<body>
  <header>
    <a href="/" class="logo">short.string.md</a>
    <span class="status" id="peer-count"></span>
  </header>

  <!-- Create mode -->
  <main id="create-view">
    <h1>Shorten a URL</h1>

    <div class="input-group">
      <textarea id="url-input" rows="2" placeholder="Paste a URL here..."></textarea>
      <div class="btn-row">
        <button class="primary" id="shorten-btn" disabled>Shorten</button>
      </div>
    </div>

    <div class="results" id="results">
      <div class="result-card" id="compressed-card">
        <span class="result-label">Compressed (always works)</span>
        <span class="result-url" id="compressed-url"></span>
        <span class="result-meta" id="compressed-meta"></span>
        <button class="copy-btn" data-target="compressed-url">Copy</button>
      </div>

      <div class="result-card" id="alias-card">
        <span class="result-label">Short Alias</span>
        <div class="alias-input-row">
          <input type="text" id="alias-input" placeholder="my-link (or leave blank for random)" maxlength="64" pattern="[\w\-]+" />
          <button id="create-alias-btn">Create</button>
        </div>
        <span class="result-url" id="alias-url" style="display:none"></span>
        <span class="result-meta" id="alias-meta" style="display:none"></span>
        <button class="copy-btn" data-target="alias-url" style="display:none">Copy</button>
      </div>
    </div>
  </main>

  <!-- Resolve mode -->
  <main class="resolve-view" id="resolve-view">
    <div class="spinner" id="resolve-spinner"></div>
    <div class="resolve-status" id="resolve-status">Resolving...</div>
    <div class="error-msg" id="resolve-error"></div>
  </main>

  <div class="toast" id="toast">Copied!</div>

  <!-- Scripts added in subsequent tasks -->
</body>
</html>
```

**Step 2: Open in browser, verify layout renders**

Open `short.html` in a browser. Verify:
- Dark theme renders
- Header with logo shows
- Input textarea and disabled Shorten button show
- Results section is hidden

**Step 3: Commit**

```bash
git add short.html
git commit -m "feat: add short.string.md HTML scaffold with CSS"
```

---

### Task 2: Compression Engine

**Files:**
- Modify: `short.html` (add script before closing `</body>`)

**Step 1: Add LZ-String library and compression module**

Add this before `</body>` in `short.html`, replacing `<!-- Scripts added in subsequent tasks -->`:

```html
<script src="https://cdn.jsdelivr.net/npm/lz-string@1.5.0/libs/lz-string.min.js"></script>
<script>
// ── URL Compression Engine ──

const DOMAIN_DICT = {
  'www.google.com': 'G', 'google.com': 'G',
  'www.youtube.com': 'Y', 'youtube.com': 'Y',
  'www.github.com': 'GH', 'github.com': 'GH',
  'www.reddit.com': 'R', 'reddit.com': 'R',
  'www.twitter.com': 'TW', 'twitter.com': 'TW',
  'x.com': 'X',
  'www.wikipedia.org': 'W', 'en.wikipedia.org': 'WE',
  'www.amazon.com': 'AZ', 'amazon.com': 'AZ',
  'www.stackoverflow.com': 'SO', 'stackoverflow.com': 'SO',
  'www.linkedin.com': 'LI', 'linkedin.com': 'LI',
  'www.facebook.com': 'FB', 'facebook.com': 'FB',
  'www.instagram.com': 'IG', 'instagram.com': 'IG',
  'www.tiktok.com': 'TK', 'tiktok.com': 'TK',
  'www.twitch.tv': 'TV', 'twitch.tv': 'TV',
  'www.discord.com': 'DC', 'discord.com': 'DC',
  'discord.gg': 'DG',
  'www.notion.so': 'NO', 'notion.so': 'NO',
  'docs.google.com': 'GD',
  'drive.google.com': 'GR',
  'mail.google.com': 'GM',
  'maps.google.com': 'GP',
  'www.figma.com': 'FG', 'figma.com': 'FG',
  'www.medium.com': 'MD', 'medium.com': 'MD',
  'www.npmjs.com': 'NP', 'npmjs.com': 'NP',
  'string.md': 'SM',
  'short.string.md': 'SS',
};

const DOMAIN_REV = {};
for (const [domain, code] of Object.entries(DOMAIN_DICT)) {
  if (!DOMAIN_REV[code] || domain.length < DOMAIN_REV[code].length) {
    DOMAIN_REV[code] = domain;
  }
}

function compressURL(url) {
  try {
    const parsed = new URL(url);
    const isHttps = parsed.protocol === 'https:';
    const proto = isHttps ? 'S' : 'H';
    const host = parsed.host;
    const domainCode = DOMAIN_DICT[host];
    let encoded;
    if (domainCode) {
      encoded = proto + domainCode + '\t' + parsed.pathname + parsed.search + parsed.hash;
    } else {
      encoded = proto + host + '\t' + parsed.pathname + parsed.search + parsed.hash;
    }
    return LZString.compressToEncodedURIComponent(encoded);
  } catch {
    return LZString.compressToEncodedURIComponent(url);
  }
}

function decompressURL(compressed) {
  const decoded = LZString.decompressFromEncodedURIComponent(compressed);
  if (!decoded) return null;
  const tabIdx = decoded.indexOf('\t');
  if (tabIdx === -1) return decoded;
  const proto = decoded[0] === 'S' ? 'https://' : 'http://';
  const hostPart = decoded.slice(1, tabIdx);
  const rest = decoded.slice(tabIdx + 1);
  const domain = DOMAIN_REV[hostPart] || hostPart;
  return proto + domain + rest;
}

window.compressURL = compressURL;
window.decompressURL = decompressURL;
</script>
```

**Step 2: Test in browser console**

```javascript
const c1 = compressURL('https://github.com/user/repo/issues/123');
console.log('Compressed length:', c1.length);
console.log('Roundtrip:', decompressURL(c1));

const c2 = compressURL('https://example.com/some/path?q=test');
console.log('Roundtrip:', decompressURL(c2));
```

Verify all roundtrips match the original URL.

**Step 3: Commit**

```bash
git add short.html
git commit -m "feat: add URL compression engine with domain dictionary"
```

---

### Task 3: Hash Routing + Compressed URL Resolution

**Files:**
- Modify: `short.html` (append to the existing `<script>`)

**Step 1: Add hash routing and redirect logic**

Append to the existing `<script>` block:

```javascript
// ── Hash Routing ──

const ORIGIN = location.origin;

function makeCompressedURL(url) {
  return ORIGIN + '/#c/' + compressURL(url);
}

async function route() {
  const hash = location.hash;
  if (!hash || hash === '#') {
    document.getElementById('create-view').style.display = '';
    document.getElementById('resolve-view').classList.remove('visible');
    return;
  }

  if (hash.startsWith('#c/')) {
    const compressed = hash.slice(3);
    const target = decompressURL(compressed);
    if (target) {
      window.location.replace(target);
      return;
    }
    showResolveError('Failed to decompress URL.');
    return;
  }

  if (hash.startsWith('#n/')) {
    const alias = hash.slice(3);
    document.getElementById('create-view').style.display = 'none';
    document.getElementById('resolve-view').classList.add('visible');
    document.getElementById('resolve-status').textContent = 'Resolving "' + alias + '"...';
    resolveAlias(alias);
    return;
  }

  showResolveError('Unknown URL format.');
}

function showResolveError(msg) {
  document.getElementById('create-view').style.display = 'none';
  document.getElementById('resolve-view').classList.add('visible');
  document.getElementById('resolve-spinner').style.display = 'none';
  document.getElementById('resolve-status').textContent = '';
  document.getElementById('resolve-error').textContent = msg;
}

async function resolveAlias(alias) {
  showResolveError('Alias resolution not yet implemented. Alias: ' + alias);
}

// ── Init ──

async function init() {
  route();

  const urlInput = document.getElementById('url-input');
  const shortenBtn = document.getElementById('shorten-btn');

  urlInput.addEventListener('input', () => {
    shortenBtn.disabled = !urlInput.value.trim();
  });

  shortenBtn.addEventListener('click', () => {
    let url = urlInput.value.trim();
    if (!url) return;

    if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try { new URL(url); } catch { showToast('Invalid URL'); return; }

    const compressed = makeCompressedURL(url);
    const ratio = ((1 - compressed.length / url.length) * 100).toFixed(0);

    document.getElementById('compressed-url').textContent = compressed;
    document.getElementById('compressed-meta').textContent =
      url.length + ' \u2192 ' + compressed.length + ' chars (' +
      (ratio > 0 ? ratio + '% smaller' : 'larger than original') + ')';
    document.getElementById('results').classList.add('visible');

    window._pendingTarget = url;
  });

  // Copy buttons
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.target;
      const text = document.getElementById(targetId).textContent;
      navigator.clipboard.writeText(text).then(() => showToast('Copied!'));
    });
  });

  // Click result URLs to visit
  document.querySelectorAll('.result-url').forEach(el => {
    el.addEventListener('click', () => {
      const url = el.textContent;
      if (url) window.open(url, '_blank');
    });
  });

  // Alias input sanitization
  document.getElementById('alias-input').addEventListener('input', function() {
    this.value = this.value.replace(/[^\w\-]/g, '');
  });

  // Click title to reset
  document.querySelector('h1').style.cursor = 'pointer';
  document.querySelector('h1').addEventListener('click', () => {
    document.getElementById('results').classList.remove('visible');
    urlInput.value = '';
    shortenBtn.disabled = true;
  });
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 1500);
}

window._initReady = init();
```

**Step 2: Test in browser**

1. Open `short.html` — should show create view
2. Paste a URL, click Shorten — should show compressed result
3. Open `short.html#n/test` — should show "not yet implemented"
4. Click Copy — should copy to clipboard

**Step 3: Commit**

```bash
git add short.html
git commit -m "feat: add hash routing, compressed URL resolution, and shorten UI"
```

---

### Task 4: Nostr Keypair, Relay Publishing, and Alias Resolution

**Files:**
- Modify: `short.html` (add `<script type="module">` block after existing script)

**Step 1: Add the Nostr + alias resolution module**

Add after the closing `</script>` of the main script:

```html
<script type="module">
// ── Nostr + P2P Module ──

import { generateSecretKey, getPublicKey, finalizeEvent } from 'https://esm.run/nostr-tools@2';

const NOSTR_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band',
];
const NOSTR_KIND = 30078;
const APP_TAG = 'short.string.md';
const STORAGE_KEY_SK = 'short_stringmd_sk';
const STORAGE_KEY_CACHE = 'short_stringmd_cache';

// ── Key Management ──

function getOrCreateSecretKey() {
  const stored = localStorage.getItem(STORAGE_KEY_SK);
  if (stored) return Uint8Array.from(JSON.parse(stored));
  const sk = generateSecretKey();
  localStorage.setItem(STORAGE_KEY_SK, JSON.stringify(Array.from(sk)));
  return sk;
}

const sk = getOrCreateSecretKey();
const pk = getPublicKey(sk);

// ── Alias Cache ──

function loadCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY_CACHE) || '{}'); }
  catch { return {}; }
}
function saveCache(cache) {
  localStorage.setItem(STORAGE_KEY_CACHE, JSON.stringify(cache));
}
function cacheAlias(alias, targetURL) {
  const cache = loadCache();
  cache[alias] = { url: targetURL, ts: Date.now() };
  saveCache(cache);
}
function lookupCache(alias) {
  const cache = loadCache();
  return cache[alias]?.url || null;
}

// ── Nostr Relay Communication ──

function connectRelay(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const timeout = setTimeout(() => { ws.close(); reject(new Error('timeout')); }, 5000);
    ws.onopen = () => { clearTimeout(timeout); resolve(ws); };
    ws.onerror = () => { clearTimeout(timeout); reject(new Error('connect failed')); };
  });
}

async function publishToRelays(event) {
  const results = await Promise.allSettled(
    NOSTR_RELAYS.map(async (url) => {
      const ws = await connectRelay(url);
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => { ws.close(); reject(new Error('publish timeout')); }, 5000);
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === 'OK') {
            clearTimeout(timeout);
            ws.close();
            resolve(data);
          }
        };
        ws.send(JSON.stringify(['EVENT', event]));
      });
    })
  );
  const successes = results.filter(r => r.status === 'fulfilled').length;
  if (successes === 0) throw new Error('Failed to publish to any relay');
  return successes;
}

async function queryRelays(alias) {
  const filter = {
    kinds: [NOSTR_KIND],
    '#d': [alias],
    '#t': [APP_TAG],
    limit: 1,
  };

  return new Promise((resolve) => {
    let resolved = false;
    const sockets = [];
    const timeout = setTimeout(() => {
      if (!resolved) { resolved = true; cleanup(); resolve(null); }
    }, 6000);

    function cleanup() {
      clearTimeout(timeout);
      sockets.forEach(ws => { try { ws.close(); } catch {} });
    }

    NOSTR_RELAYS.forEach(async (url) => {
      try {
        const ws = await connectRelay(url);
        sockets.push(ws);
        const subId = 'q_' + Math.random().toString(36).slice(2, 8);
        ws.onmessage = (msg) => {
          const data = JSON.parse(msg.data);
          if (data[0] === 'EVENT' && data[1] === subId && data[2]?.content) {
            if (!resolved) {
              resolved = true;
              cleanup();
              resolve(data[2].content);
            }
          }
          if (data[0] === 'EOSE' && data[1] === subId) {
            ws.close();
          }
        };
        ws.send(JSON.stringify(['REQ', subId, filter]));
      } catch {}
    });
  });
}

async function createNostrAlias(alias, targetURL) {
  const event = finalizeEvent({
    kind: NOSTR_KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [
      ['d', alias],
      ['t', APP_TAG],
    ],
    content: targetURL,
  }, sk);

  const relayCount = await publishToRelays(event);
  cacheAlias(alias, targetURL);
  return { event, relayCount };
}

// ── Wire Up to UI ──

await window._initReady;

// Override placeholder resolveAlias
window.resolveAlias = async function(alias) {
  const resolveStatus = document.getElementById('resolve-status');
  const resolveSpinner = document.getElementById('resolve-spinner');
  const resolveError = document.getElementById('resolve-error');

  // Layer 1: localStorage
  resolveStatus.textContent = 'Checking local cache...';
  const cached = lookupCache(alias);
  if (cached) {
    resolveStatus.textContent = 'Found in cache. Redirecting...';
    setTimeout(() => window.location.replace(cached), 200);
    return;
  }

  // Layer 2: P2P — placeholder, added in Task 5
  // const p2p = await window._resolveP2P?.(alias);
  // if (p2p) { cacheAlias(alias, p2p); resolveStatus.textContent = 'Found via peer.'; ... }

  // Layer 3: Nostr relays
  resolveStatus.textContent = 'Querying Nostr relays...';
  const nostr = await queryRelays(alias);
  if (nostr) {
    cacheAlias(alias, nostr);
    resolveStatus.textContent = 'Found on relay. Redirecting...';
    setTimeout(() => window.location.replace(nostr), 200);
    return;
  }

  // Fallback
  resolveSpinner.style.display = 'none';
  resolveStatus.textContent = '';
  const errorEl = resolveError;
  errorEl.textContent = '';
  errorEl.append('Alias "' + alias + '" not found. ');
  errorEl.append('No peers online and no relay data available. ');
  const link = document.createElement('a');
  link.href = '/';
  link.textContent = 'Shorten a new URL';
  errorEl.append(link);
};

// Alias creation button
const aliasBtn = document.getElementById('create-alias-btn');
const aliasInput = document.getElementById('alias-input');
const aliasUrl = document.getElementById('alias-url');
const aliasMeta = document.getElementById('alias-meta');
const aliasCopyBtn = document.querySelector('[data-target="alias-url"]');

function genShortCode() {
  const buf = new Uint8Array(4);
  crypto.getRandomValues(buf);
  return Array.from(buf, b => b.toString(36).padStart(2, '0')).join('').slice(0, 6);
}

aliasBtn.addEventListener('click', async () => {
  const target = window._pendingTarget;
  if (!target) return;

  let alias = aliasInput.value.trim().replace(/[^\w\-]/g, '');
  if (!alias) alias = genShortCode();

  aliasBtn.disabled = true;
  aliasBtn.textContent = 'Publishing...';

  try {
    const existing = await queryRelays(alias);
    if (existing && existing !== target) {
      aliasBtn.disabled = false;
      aliasBtn.textContent = 'Create';
      aliasMeta.textContent = '"' + alias + '" is taken. Try a different name.';
      aliasMeta.style.display = '';
      return;
    }

    const { relayCount } = await createNostrAlias(alias, target);

    // Broadcast to P2P if available
    if (window._broadcastMapping) window._broadcastMapping(alias, target);

    const shortURL = location.origin + '/#n/' + alias;
    aliasUrl.textContent = shortURL;
    aliasUrl.style.display = '';
    aliasMeta.textContent = 'Published to ' + relayCount + ' relay(s)';
    aliasMeta.style.display = '';
    aliasCopyBtn.style.display = '';
    aliasInput.style.display = 'none';
    aliasBtn.style.display = 'none';
  } catch (err) {
    aliasMeta.textContent = 'Error: ' + err.message;
    aliasMeta.style.display = '';
    aliasBtn.disabled = false;
    aliasBtn.textContent = 'Create';
  }
});

// Re-trigger route for hash aliases now that resolveAlias is wired up
if (location.hash.startsWith('#n/')) {
  window.resolveAlias(location.hash.slice(3));
}
</script>
```

**Step 2: Test in browser**

1. Paste a URL, click Shorten, type alias, click Create — verify "Published to N relay(s)"
2. Copy alias URL, open in new tab — verify redirect via relay
3. Check `localStorage.getItem('short_stringmd_cache')` — verify cache entry

**Step 3: Commit**

```bash
git add short.html
git commit -m "feat: add Nostr keypair, relay publishing, and alias resolution waterfall"
```

---

### Task 5: P2P Gossip Layer

**Files:**
- Modify: `short.html` (add Trystero import and P2P code to the module script)

**Step 1: Add Trystero import**

At the top of the `<script type="module">`, add:

```javascript
import { joinRoom } from 'https://esm.run/trystero@0.22.0';
```

**Step 2: Add P2P gossip code**

Add before `// ── Wire Up to UI ──`:

```javascript
// ── P2P Gossip Layer ──

const P2P_APP_ID = 'short-string-md';
const P2P_ROOM_ID = 'global';
let p2pRoom = null;
let sendMapping = null;
let p2pPeers = new Set();
const p2pLookupCallbacks = {};

function initP2P() {
  try {
    p2pRoom = joinRoom({ appId: P2P_APP_ID }, P2P_ROOM_ID);
  } catch { return; }

  const [sendMap, receiveMap] = p2pRoom.makeAction('mapping');
  const [sendLkp, receiveLkp] = p2pRoom.makeAction('lookup');
  const [sendReply, receiveReply] = p2pRoom.makeAction('reply');
  sendMapping = sendMap;

  p2pRoom.onPeerJoin(peerId => {
    p2pPeers.add(peerId);
    updatePeerCount();
  });

  p2pRoom.onPeerLeave(peerId => {
    p2pPeers.delete(peerId);
    updatePeerCount();
  });

  receiveMap((data) => {
    if (data?.alias && data?.url) cacheAlias(data.alias, data.url);
  });

  receiveLkp((data, peerId) => {
    if (data?.alias) {
      const cached = lookupCache(data.alias);
      if (cached) sendReply({ alias: data.alias, url: cached }, peerId);
    }
  });

  receiveReply((data) => {
    if (data?.alias && data?.url && p2pLookupCallbacks[data.alias]) {
      p2pLookupCallbacks[data.alias](data.url);
      delete p2pLookupCallbacks[data.alias];
    }
  });
}

function resolveP2P(alias) {
  if (!p2pRoom || p2pPeers.size === 0) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      delete p2pLookupCallbacks[alias];
      resolve(null);
    }, 2000);
    p2pLookupCallbacks[alias] = (url) => {
      clearTimeout(timeout);
      resolve(url);
    };
    const [sendLkp] = p2pRoom.makeAction('lookup');
    sendLkp({ alias });
  });
}

function broadcastMapping(alias, url) {
  if (sendMapping) sendMapping({ alias, url });
}

function updatePeerCount() {
  document.getElementById('peer-count').textContent =
    p2pPeers.size > 0 ? p2pPeers.size + ' peer' + (p2pPeers.size > 1 ? 's' : '') : '';
}

window._resolveP2P = resolveP2P;
window._broadcastMapping = broadcastMapping;

initP2P();
```

**Step 3: Uncomment P2P layer in resolveAlias**

In the `window.resolveAlias` override, uncomment the P2P section:

```javascript
  // Layer 2: P2P
  resolveStatus.textContent = 'Asking peers...';
  const p2p = await window._resolveP2P?.(alias);
  if (p2p) {
    cacheAlias(alias, p2p);
    resolveStatus.textContent = 'Found via peer. Redirecting...';
    setTimeout(() => window.location.replace(p2p), 200);
    return;
  }
```

**Step 4: Test with two browser tabs**

1. Open `short.html` in two tabs, wait for "1 peer" in each
2. Create alias in tab 1, verify tab 2 receives via gossip
3. In tab 2 console: check localStorage cache contains the alias

**Step 5: Commit**

```bash
git add short.html
git commit -m "feat: add Trystero P2P gossip for alias broadcast and lookup"
```

---

### Task 6: Meta Tags and Final Polish

**Files:**
- Modify: `short.html`

**Step 1: Add meta tags to `<head>`**

```html
<meta name="description" content="Serverless URL shortener. No server, no database, no sign-up." />
<meta property="og:title" content="short.string.md" />
<meta property="og:description" content="Shorten URLs without a server. Compression + Nostr aliases." />
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🔗</text></svg>" />
```

**Step 2: Full end-to-end test**

1. Open `short.html` fresh (clear localStorage)
2. Paste `https://github.com/anthropics/claude-code` → Shorten → verify compressed URL and ratio
3. Create alias `test-link` → verify published to relays
4. Open compressed URL in incognito → should redirect to GitHub
5. Open alias URL in incognito → should resolve via Nostr relay and redirect
6. Open two tabs → verify peer count shows
7. Create alias in tab 1 → verify tab 2 receives via P2P gossip
8. Paste URL without `https://` → verify auto-prepend works
9. Paste invalid text → verify "Invalid URL" toast

**Step 3: Commit**

```bash
git add short.html
git commit -m "feat: add meta tags and complete short.string.md v1"
```

---

## Summary

| Task | What it builds | Estimated steps |
|------|---------------|-----------------|
| 1 | HTML scaffold + CSS | 3 |
| 2 | URL compression engine with domain dictionary | 3 |
| 3 | Hash routing, compressed resolution, shorten UI | 3 |
| 4 | Nostr keypair, relay publish/query, alias creation + resolution | 3 |
| 5 | Trystero P2P gossip broadcast and lookup | 5 |
| 6 | Meta tags, full E2E test | 3 |
