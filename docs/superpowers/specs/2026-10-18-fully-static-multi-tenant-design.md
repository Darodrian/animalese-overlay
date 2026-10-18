# animalese-overlay — fully static, per-channel isolation (design)

## Intent

Make the overlay safe for many streamers on one deployment: when a `!ac`
command fires in one Twitch chat, only that streamer's overlay reacts, with
its own settings, cooldowns, and queue. The operator asked for a key
generator and a "Copy OBS URL" button in the dashboard so each streamer can
self-serve.

The architecture follows the pattern proven in the operator's own
`cartas-cotemon` and `miguelium-wisdom` projects: no server, a
client-generated key naming a Supabase Realtime broadcast room, key in the
URL fragment, settings and keys in localStorage.

## Goals

1. Fully static site (GitHub Pages). No Express server, no npm runtime
   dependencies, no committed data files.
2. Per-channel isolation: rooms keyed by an unguessable 24-char key; each
   overlay joins only its own room.
3. Dashboard key UX identical to the operator's other projects:
   Generate/Change key (confirm dialog), Copy OBS URL, adopt-key-from-URL,
   live preview iframe.
4. Settings (prefix, permissions, cooldown, max length, pacing,
   requirePortrait) are per-channel, stored in the dashboard's localStorage
   and pushed to the overlay through the room.
5. Villager roster fetched at runtime from Nookipedia's MediaWiki API
   (browser CORS verified via the `origin=*` convention), cached in
   localStorage for 24 h with stale-while-revalidate.
6. Chat command pipeline runs entirely in the overlay: ComfyJS detects
   `!ac`, the overlay applies permissions + cooldown, picks a villager,
   paces playback in a local queue, and speaks via animalese-tts.
7. Audio sprite fetched at runtime from the izure1/animalese-tts repo
   pinned to a commit hash and byte-validated (never committed — same rule
   as today).
8. Old keyless URLs hard-break: the overlay shows a setup screen pointing
   at the dashboard (no shared legacy room).

## Non-goals / anti-goals

- No accounts, login, or OAuth; the key is the identity.
- No server-side anything: no queues, no global status, no key registry.
- No rate limiting or abuse controls.
- No migration path for old `?channel=` URLs beyond the setup screen.
- No test framework dependency: Node's built-in `node --test` only.

## Key decisions

- **Key**: `generateKey(24)` over alphabet `23456789abcdefghjkmnpqrstuvwxyz`
  (no `0/1/o/i/l`), unbiased rejection sampling, `crypto.getRandomValues`.
  Stored per channel as `ac_key_<channel>` in localStorage. OBS URL:
  `<origin><path>/overlay.html#c=<channel>&k=<key>` — the fragment never
  reaches a server.
- **Rooms**: Supabase Realtime broadcast (`self: false`) on the operator's
  existing project (`liuhcwkpuivcletiwpab.supabase.co`, publishable key —
  by design in client code, matching the other two projects). Events:
  - `hello` overlay→room on subscribe (triggers the dashboard's `set` reply)
  - `state` overlay→room every 4 s + on change: `{ at, audio, queue: { pending, playing } }`
    (doubles as heartbeat; dashboard marks the overlay lost after 12 s)
  - `set` dashboard→room: full settings object, sent on `hello` and on save
  - `say` dashboard→room: `{ villagerName, text }` manual test line
- **Settings**: `ac_cfg_<channel>` in the dashboard's localStorage; overlay
  caches the last received copy as `ac_livecfg_<channel>` so chat gating
  works with the dashboard closed. Shape (defaults in `js/config.js`):

  ```js
  {
    prefix: 'ac',
    permissions: { everyone: true, broadcaster: true, mod: true, vip: true, subscriber: true },
    userCooldownMs: 30000,
    minGapMs: 1200,
    maxLength: 120,
    requirePortrait: true,
  }
  ```

- **Roster**: Nookipedia `w/api.php` — 1 `cargoquery` (limit 500) + batches
  of 50 `imageinfo` titles, 250 ms between batches, every request carries
  `origin=*` and no custom headers (preflights are not CORS-enabled).
  Cache `ac_roster_v1` in localStorage, 24 h TTL, stale-while-revalidate.
- **Vendors**: pinned CDN URLs — `comfy.js@1.1.29`,
  `animalese-tts@1.1.3/dist/animalese.browser.mjs`,
  `@supabase/supabase-js@2.117.2/+esm`; sprite from
  `raw.githubusercontent.com/izure1/animalese-tts/<commit-sha>/docs/sounds/…`
  (bytes: wav 1279244, json 2023).
- **Local asset paths are relative** (`css/…`, `js/…`, `overlay.html`) so a
  project Pages site under a sub-path works.
- **UI copy stays English** (matches the existing animalese dashboard).

## Constraints

- No new npm dependencies; tests via `node --test tests/*.test.mjs`.
- Client modules must not touch `localStorage`/`fetch` at module top level
  (testability in Node); storage and fetch are injectable.
- Free-tier Supabase pauses after ~1 week with no database activity; rooms
  do not connect while paused (one-click resume). Same operational reality
  as the operator's existing projects.
