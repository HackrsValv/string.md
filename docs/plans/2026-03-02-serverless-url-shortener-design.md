# short.string.md — Serverless URL Shortener

## Problem

URLs can be very long — especially string.md content URLs (7,000+ chars). Traditional shorteners require a server. We want a URL shortener with truly zero infrastructure.

## Core Insight

Without a server, the mapping between short code and target URL must either travel with the URL itself (compression) or live on existing public infrastructure (Nostr relays). We use both.

## Architecture

Single static HTML page at `short.string.md`. Two shortening mechanisms, four resolution layers.

### Two URL Formats

- `short.string.md/#c/<compressed>` — self-contained compressed URL, works forever
- `short.string.md/#n/<alias>` — Nostr-backed alias, genuinely short

### Resolution Waterfall

When resolving `#n/<alias>`:

1. **localStorage** — instant, offline. Check local cache of previously seen mappings.
2. **P2P peers (Trystero)** — ask connected peers. Anyone with short.string.md open (or string.md, if integrated later) is a peer.
3. **Nostr relays** — query public relays for the mapping event. Always available, slightly slower.
4. **Fallback** — show "alias not found" with explanation. Creator always has the compressed form as backup.

When resolving `#c/<compressed>`:

1. Decompress directly. No network needed. Always works.

### Compression Engine

Pipeline for `#c/` URLs:

1. Strip protocol (`https://` stored as 1-bit flag)
2. Domain dictionary — ~50 common domains mapped to short codes (google.com → `g`, github.com → `gh`, youtube.com → `yt`, etc.)
3. Path tokenization — common path segments get short tokens
4. Query param compression — sort for canonical form, dictionary for common keys
5. LZ-String final pass
6. Base64url encoding for hash fragment

Expected ratios: typical 150-char URL → 50-70 chars after hash. Full shortened URL ~70-90 chars. For very long URLs (string.md content), compression alone is insufficient — use aliases instead.

### Nostr Storage (for aliases)

- Event kind: `30078` (NIP-78 application-specific data, replaceable)
- Tag: `["d", "<alias>"]` for lookups
- Content: full target URL
- Signed with ephemeral keypair generated in-browser, stored in localStorage
- Collision handling: earliest timestamp wins on relays; suggest alternatives if taken

### P2P Layer

- Trystero with Nostr signaling (same library string.md uses)
- All users of short.string.md join a shared room
- Mappings gossip between peers and cache in localStorage
- Future: string.md can join the same room as a background node

## Creation Flow

1. User pastes a URL
2. System generates compressed form (`#c/...`)
3. System offers alias creation — user picks a name or gets random 6-char code
4. On alias creation:
   - Publish Nostr event with mapping
   - Broadcast to P2P network
   - Cache in localStorage
5. Show both URLs: alias (short) and compressed (durable fallback)

## Tech Stack

- Single HTML file, no build step
- LZ-String for compression
- Trystero v0.22.0 for P2P (WebRTC + Nostr signaling)
- Nostr event publishing (kind 30078) via relay WebSocket
- SubtleCrypto for optional private/encrypted links
- No server, no database, no dependencies beyond CDN imports

## URL Format Examples

```
Original:       https://github.com/user/repo/issues/123?label=bug&sort=created
Compressed:     short.string.md/#c/eJxLy8xRKC4pysxLL0pVSMsvSs5ILUpVBABRHQdS
Alias:          short.string.md/#n/my-issue

Original:       https://string.md/#v1:plain:MQAgQghg... (7000+ chars)
Compressed:     short.string.md/#c/... (still very long)
Alias:          short.string.md/#n/my-doc
```

## Future Integration

- string.md "Share" button could offer short.string.md alias creation
- string.md tabs could join the shortener P2P room as background nodes
- These are optional — short.string.md works fully independently

## Decisions

- **Nostr over pure P2P**: no users are typically online, so pure P2P gossip is unreliable. Nostr relays provide persistent storage without owning infrastructure.
- **Hybrid over compression-only**: compression cannot meaningfully shorten very large URLs (string.md content). Aliases are needed.
- **Standalone over embedded**: short.string.md is its own service, usable without string.md.
