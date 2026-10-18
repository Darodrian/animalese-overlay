# Fully Static Multi-Tenant Overlay — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild animalese-overlay as a fully static, multi-tenant site where each streamer's overlay is isolated by a client-generated key naming a Supabase Realtime room, with per-channel settings and a dashboard key generator.

**Architecture:** No server. The dashboard (index.html) generates keys, stores per-channel settings in localStorage, and pushes them over a Supabase Realtime broadcast room. The overlay (overlay.html) joins only its own room, listens to Twitch chat via ComfyJS, runs the whole command pipeline locally (permissions → cooldown → villager pick → pacing queue → animalese-tts), and fetches its data (villager roster, audio sprite) at runtime from pinned external URLs. Ports the operator's proven pattern from cartas-cotemon and miguelium-wisdom.

**Tech Stack:** Static HTML/JS/CSS (ES modules), Supabase Realtime via pinned CDN, ComfyJS, animalese-tts, Nookipedia MediaWiki API, Node built-in test runner (`node --test`).

**Spec:** `docs/superpowers/specs/2026-10-18-fully-static-multi-tenant-design.md`

## Global Constraints

- Key alphabet `23456789abcdefghjkmnpqrstuvwxyz`, length 24, rejection-sampled `crypto.getRandomValues` (spec: Key).
- Pinned versions, exact: `comfy.js@1.1.29`, `animalese-tts@1.1.3/dist/animalese.browser.mjs`, `@supabase/supabase-js@2.117.2/+esm`.
- Sprite: `raw.githubusercontent.com/izure1/animalese-tts/<commit-sha>/docs/sounds/english-sprite.wav` (1279244 bytes) and `.json` (2023 bytes); sha resolved at implementation; never committed.
- Supabase project `https://liuhcwkpuivcletiwpab.supabase.co`, publishable key `sb_publishable_YenbmLGW94t6XHVXgZx0DQ_e2XjL6tC` in `js/config.js` (client-side by design).
- Roster: 24 h TTL (`ac_roster_v1`), batches of 50 titles, 250 ms inter-batch delay, every Nookipedia request carries `origin=*`, no custom headers.
- Room events: `hello` (on subscribe), `state` every 4 s (dashboard TTL 12 s), `set` (on hello + on save), `say`.
- Settings shape and defaults exactly as in spec (js/config.js `DEFAULT_SETTINGS`).
- Local asset references relative (`css/…`, `js/…`, `overlay.html`) — no leading `/`.
- No new npm dependencies. UI copy in English. Client modules: no top-level `localStorage`/`fetch` access; both injectable.
- One commit per task; match the repo's existing commit-message style (check `git log --oneline -5` first; default to conventional `feat:`/`chore:`/`refactor:` if unclear).

## Review Focus

1. **First-ever roster load fails (offline, Nookipedia down/403)** — the overlay must not die: keep retrying, speak nothing until the roster arrives; `loadRoster` must reject on fetch failure with no cache. Pinned by `tests/roster.test.mjs` (`loadRoster` error paths) in Task 2; overlay retry loop verified in Task 6 steps.
2. **localStorage unavailable or throwing (private mode, OBS quirks)** — every storage helper fails soft: reads return defaults, writes no-op, no exception escapes. Pinned by `tests/keys.test.mjs` storage-throw tests (Task 1) and `tests/roster.test.mjs` storage-throw test (Task 2).
3. **Typo'd or malformed key/URL** — a garbage `k` must show the setup screen with an "invalid key" reason, not silently join an empty room forever. Pinned by `validateKey` tests (Task 1); overlay wiring in Task 6.
4. **Room down (Supabase paused / CDN blocked) while OBS is live** — local chat commands must still work; only dashboard remote-`say` and status are lost. Pinned by Task 6 verification checklist (serve locally, simulate bad Supabase URL, chat path must not depend on bridge).
5. **Sprite upstream unreachable or changed** — pinned sha + exact byte validation; on failure the engine logs and `speak` rejects without breaking the overlay loop. Pinned by Task 5 verification (probe pinned URLs for status + byte length + `access-control-allow-origin`).

---

### Task 1: Branch, docs, config + keys modules

**Files:**
- Create: `js/config.js`, `js/keys.js`
- Test: `tests/keys.test.mjs`
- (Spec + plan docs are committed here too.)

**Interfaces:**
- Produces: `js/config.js` exports `SUPABASE_URL: string`, `SUPABASE_KEY: string`, `DEFAULT_SETTINGS: object` (shape per spec), `CHANNEL_STORE: 'ac_channel'`, `keyStore(channel: string): string`, `cfgStore(channel: string): string`, `liveCfgStore(channel: string): string`.
- Produces: `js/keys.js` exports `generateKey(len = 24): string`, `validateKey(k: string): boolean` (24 chars, alphabet regex), `normChannel(raw: string): string` (trim+lowercase), `savedChannel(storage?): string`, `saveChannel(v: string, storage?): void`, `savedKey(channel: string, storage?): string`, `saveKey(channel: string, v: string, storage?): void`, `hasKey(channel: string, storage?): boolean`, `overlayParams(hash: string): { channel: string, key: string }`, `adoptHashParams(hash: string, storage?): boolean` (saves channel+key when both present), `overlayUrl(channel: string, key: string): string`.
- Storage parameter: defaults to a safe wrapper over `window.localStorage` (try/catch per access, matching cartas-cotemon/js/bridge.js:16-22); tests inject a plain `Map`-backed stub or a throwing stub.

- [ ] **Step 1: Create branch and check commit style**

Run: `git checkout -b fully-static` then `git log --oneline -5`
Expected: branch created; note the message style for all later commits.

- [ ] **Step 2: Write the failing tests**

`tests/keys.test.mjs` with `node:test` + `node:assert/strict`:
- `generateKey(24)` → matches `/^[23456789abcdefghjkmnpqrstuvwxyz]{24}$/`; two calls differ.
- `validateKey` → true for a generated key; false for length 23, false containing `0`, `1`, `l`, `o`, uppercase; false for `''`.
- `normChannel('  FooBAR ')` → `'foobar'`.
- round-trip: `saveKey('foo', 'k1', stub); savedKey('foo', stub)` → `'k1'`; `hasKey` true, then absent channel → `''`.
- throwing storage stub → `saveKey`/`saveChannel` do not throw; `savedKey`/`savedChannel` return `''`.
- `overlayParams('#c=MyChan&k=abc')` → `{ channel: 'mychan', key: 'abc' }`; `overlayParams('')` → `{ channel: '', key: '' }` (channel lowercased).
- `adoptHashParams('#c=a&k=b', stub)` → true, `savedChannel(stub)==='a'`, `savedKey('a',stub)==='b'`; without both parts → false and storage untouched.
- `overlayUrl('foo', 'k')` ends with `overlay.html#c=foo&k=k`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `node --test tests/keys.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `js/config.js` and `js/keys.js`**

`js/config.js`: constants only, values from Global Constraints.
`js/keys.js`: port the key pattern from cartas-cotemon/js/bridge.js:14-55 and miguelium-wisdom/js/bridge.js:6-74 — `generateKey` rejection sampling verbatim; storage helpers take the optional storage param (default safe localStorage wrapper); `overlayUrl` builds via `new URL('overlay.html', location.href)` with the hash `c=…&k=…` (guard `location` for Node tests: fall back to a plain relative string when `location` is undefined).

- [ ] **Step 5: Run tests to verify they pass**

Run: `node --test tests/keys.test.mjs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add js/config.js js/keys.js tests/keys.test.mjs docs/
git commit -m "feat: key generation and per-channel storage modules"
```

---

### Task 2: Roster module (Nookipedia client)

**Files:**
- Create: `js/roster.js`
- Test: `tests/roster.test.mjs`

**Interfaces:**
- Produces: `loadRoster({ force = false, storage?, fetchImpl?, delayMs? } = {}): Promise<{ villagers: Villager[], generated: string, stale: boolean, counts: object }>` — fresh cache (age < 24 h) returned without network; expired cache returned as `stale: true` immediately while revalidating in the background; no cache → await build; fetch failure with stale cache → `stale: true`; fetch failure with no cache → rejects.
- Produces: `buildRoster({ fetchImpl?, delayMs? } = {}): Promise<{ generated, counts, villagers }>`; `findVillager(villagers, query): Villager|null`; `randomVillager(villagers, { requirePortrait, exclude }): Villager|null`; `playableVillagers(villagers, requirePortrait): Villager[]`.
- `Villager` shape: `{ name, nameLower, phrase, quote, personality, species, gender, image, imageUrl, isPortrait }` (port of lib/nookipedia.js:83-96).

- [ ] **Step 1: Write the failing tests**

`tests/roster.test.mjs`:
- `buildRoster` with stub `fetchImpl` (dispatch on URL params) returning a cargoquery fixture (`[{title:{name:'Ace',image:'Ace amiibo.png',nh:'1',phrase:'pttt'…}}, {title:{name:'Bob',image:'Bob PC.png',nh:'0'…}}, {title:{name:'Celeste',image:'Celeste.png',nh:'1'…}}]`) and an imageinfo fixture resolving only `File:Ace amiibo.png` + `File:Celeste.png` → villagers = Ace + Celeste (nh filter), Bob dropped; Ace `isPortrait === false` (NON_PORTRAIT `/amiibo| PC\.png$|icon/i`), Celeste `true`; imageUrl populated from fixture; every request URL contains `origin=*` (assert via dispatch recorder); `delayMs: 0` used in tests.
- imageinfo missing a file → that villager dropped (port keep/missing behavior, lib/nookipedia.js:61-69).
- `loadRoster` with fresh stub-storage cache (`generated` = now) → resolves from cache, fetchImpl never called.
- expired cache → resolves `stale: true` with cached villagers, background refresh calls fetchImpl and writes updated cache (await a tick).
- fetch rejects + expired cache → resolves `stale: true`; fetch rejects + empty storage → rejects.
- throwing storage stub → `loadRoster` still works via fetch (fails soft).
- selectors: `findVillager` case-insensitive exact; `randomVillager` exclude removes the named villager; `requirePortrait` filters `isPortrait:false`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/roster.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `js/roster.js`**

Port lib/nookipedia.js client-side: `WIKI='https://nookipedia.com/w/api.php'`; `apiGet(params, fetchImpl)` appends `origin='*'` to every call; cargo fields `name,image,phrase,quote,personality,species,gender,nh`, `limit=500`, filter `nh === '1' && name && image` (port of fetchSeriesVillagers + filterNewHorizons, lib/nookipedia.js:22-36); portrait resolution in batches of 50 titles `File:<image>` via `action=query&prop=imageinfo&iiprop=url`, `delayMs` (default 250) between batches (port of lib/nookipedia.js:38-70); `normalise` + NON_PORTRAIT verbatim; cache key `ac_roster_v1`, TTL 24 h; selectors port of lib/nookipedia.js:152-174. No top-level storage/fetch access.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/roster.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/roster.js tests/roster.test.mjs
git commit -m "feat: browser-side Nookipedia roster with localStorage cache"
```

---

### Task 3: Commands module (pipeline port)

**Files:**
- Create: `js/commands.js`
- Test: `tests/commands.test.mjs`

**Interfaces:**
- Consumes: `findVillager`, `randomVillager`, `playableVillagers` from `./roster.js`.
- Produces: `sanitiseText(raw: string, maxLength: number): string`; `isAllowed(flags: object, permissions: object): boolean`; `parseCommand(rawText: string, villagers: Villager[], config: object, { exclude }?): { ok: true, job: { villager, message } } | { ok: false, reason }`; `holdMsFor(message: string): number`; `createQueue({ minGapMs, onJob, onIdle }): { enqueue(job): number, pendingCount(): number, cooldownRemaining(user): number, markUsed(user, windowMs): void, snapshot(): object, stop(): void }`.

- [ ] **Step 1: Write the failing tests**

`tests/commands.test.mjs` (fixture villager list of 3, one `isPortrait:false`):
- `sanitiseText`: strips URL, `@mention`, emoji; collapses whitespace; respects maxLength.
- `isAllowed`: everyone→all allowed; only-mod → mod+broadcaster pass, plain user fails.
- `parseCommand`: named villager + rest becomes message; unknown name → random; no text → villager phrase fallback; named no-portrait with `requirePortrait` → `{ ok:false, reason:'no-portrait' }`; `exclude` avoids the excluded villager when alternatives exist.
- `holdMsFor`: floor 1800, ceiling 9000.
- `createQueue` with `minGapMs: 0`: two enqueued jobs fire `onJob` in order (await ~20 ms); `cooldownRemaining` > 0 after `markUsed`, 0 for other users; `snapshot().pending` correct.

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/commands.test.mjs`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `js/commands.js`**

Direct port of lib/chat-command.js:7-119 (regexes, sanitise, isAllowed, parseCommand, holdMsFor, createQueue) with `parseCommand` taking the roster selectors already imported by the caller — keep `parseCommand` importing from `./roster.js` as lib did from `./nookipedia.js`. Pure module, no DOM.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/commands.test.mjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/commands.js tests/commands.test.mjs
git commit -m "feat: client-side command pipeline (sanitise, parse, cooldown queue)"
```

---

### Task 4: Bridge module (Supabase Realtime room)

**Files:**
- Create: `js/bridge.js`

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_KEY` from `./config.js`.
- Produces: `createBridge(room: string)` → `{ connect(): Promise<void>, leave(): Promise<void>, sendHello(payload): void, sendState(payload): void, sendSet(payload): void, sendSay(payload): void, onStatus(fn), onHello(fn), onState(fn), onSet(fn), onSay(fn), isConnected(): boolean }`. `connect()` resolves on `SUBSCRIBED`, rejects with `TIMED_OUT` (15 s) / `CHANNEL_ERROR` / `CLOSED`. Broadcast config `{ config: { broadcast: { self: false } } }`; supabase-js dynamically imported from the pinned CDN URL inside `connect` (no top-level import — keeps the file parseable by `node --check` and loadable without network).

- [ ] **Step 1: Write `js/bridge.js`**

Structural port of miguelium-wisdom/js/bridge.js:77-143: same `createBridge` shape, same 15 s subscribe timeout, same status constants — but events `hello`, `state`, `set`, `say` (listen helper identical to miguelium's `listen`). Dynamic import specifier: `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm`.

- [ ] **Step 2: Verify syntax and structural parity**

Run: `node --check js/bridge.js`
Expected: no output (parses).
Then diff the control flow against miguelium-wisdom/js/bridge.js: confirm identical subscribe/timeout/status handling, only event names differ.

- [ ] **Step 3: Commit**

```bash
git add js/bridge.js
git commit -m "feat: supabase realtime room bridge (hello/state/set/say)"
```

---

### Task 5: TTS vendors and sprite switch to pinned CDNs

**Files:**
- Move: `public/js/tts.js` → `js/tts.js`, `public/js/voice.js` → `js/voice.js` (voice.js unchanged)
- Modify: `js/tts.js:1-16` (imports + sprite constants), `js/tts.js:57-89` (`loadEngine` preload)

**Interfaces:**
- Consumes: none new.
- Produces: exports `loadEngine`, `speak`, `unlockAudio`, `audioState`, `playerAudioState` from `js/tts.js`. `reportState` is deleted here — the Task 6 overlay rewrite replaces it with `bridge.sendState`, and the old `public/` copy dies in Task 7. `loadEngine()` keeps its singleton/promise semantics; sprite URL constants become `SPRITE_WAV`/`SPRITE_MAP` absolute pinned URLs.

- [ ] **Step 1: Resolve and pin the sprite commit sha**

Run:
```powershell
(Invoke-RestMethod 'https://api.github.com/repos/izure1/animalese-tts/commits/main').sha
```
Expected: 40-char sha — record it; all sprite URLs in code use `https://raw.githubusercontent.com/izure1/animalese-tts/<sha>/docs/sounds/…`.

- [ ] **Step 2: Probe the pinned URLs for CORS, status, and bytes**

Run for both `english-sprite.wav` and `english-sprite.json`:
```powershell
$r = Invoke-WebRequest -Uri '<pinned-url>' -Headers @{ Origin = 'https://example.github.io' } -UseBasicParsing
$r.StatusCode; $r.Headers['Access-Control-Allow-Origin']; $r.RawContentLength
```
Expected: `200`, `*`, `1279244` (wav) / `2023` (json). If any differ — stop and report (Review Focus 5).

- [ ] **Step 3: Modify `js/tts.js`**

- Vendor import → `https://cdn.jsdelivr.net/npm/animalese-tts@1.1.3/dist/animalese.browser.mjs`.
- `SPRITE_WAV`/`SPRITE_MAP` → the pinned URLs from Step 1.
- `loadEngine`: fetch the map JSON; fetch the wav as a blob and validate `blob.size === 1279244` (log a warning and continue if not — upstream mismatch should be visible, not silent); map URL → object URL for `new WebSampler(objectUrl, map)`; validate map parses (current code already does `.json()`).
- Delete `reportState` (unused after Task 6; `sendBeacon` path is gone in the static build).

- [ ] **Step 4: Verify**

Run: `node --check js/tts.js`
Expected: parses.
Confirm `js/voice.js` untouched.

- [ ] **Step 5: Commit**

```bash
git add js/tts.js
git commit -m "feat: pinned CDN vendors and runtime sprite fetch with byte validation"
```

---

### Task 6: Overlay page

**Files:**
- Move: `public/css/overlay.css` → `css/overlay.css`
- Create: `overlay.html` (root, based on public/overlay.html), `js/overlay.js`, `js/chat.js` (the old `public/js/overlay.js` and `public/js/chat.js` copies are deleted with `public/` in Task 7)
- Delete: `public/overlay.html`, `public/css/overlay.css` after the move

**Interfaces:**
- Consumes: `overlayParams`, `validateKey` (Task 1), `loadRoster` (Task 2), `sanitiseText`, `isAllowed`, `parseCommand`, `holdMsFor`, `createQueue` (Task 3), `createBridge` (Task 4), engine exports (Task 5).
- Produces: `js/chat.js` exports `startChat({ channel, getSettings, onCommand }): void` — wires `ComfyJS.onCommand` (global from the CDN script tag), prefix/permission gate via `getSettings()`, calls `onCommand({ user, text, flags })`. `js/overlay.js` is an entry module (no exports); it owns the pipeline function `enqueueSay({ user, text, flags, villagerName = null, excludeVillager = null })` used by chat, room `say`, and local replacement.

- [ ] **Step 1: Move files and fix paths**

Move `public/css/overlay.css` → `css/overlay.css`; write new `overlay.html` at repo root based on public/overlay.html: stylesheet link relative (`css/overlay.css`), ComfyJS from `https://cdn.jsdelivr.net/npm/comfy.js@1.1.29/dist/comfy.min.js`, module script `js/overlay.js`; setup div kept with a single generic headline/detail that JS fills per reason. Delete the two originals under `public/`.

- [ ] **Step 2: Rewrite `js/chat.js`**

Thin port of public/js/chat.js:41-65: `startChat({ channel, getSettings, onCommand })` sets `ComfyJS.onCommand` → checks `command.toLowerCase() === getSettings().prefix.toLowerCase()` and `isAllowed(flags, getSettings().permissions)` → `onCommand({ user, text: message, flags })`; `ComfyJS.Init(channel, null, null, false)`; `onConnected`/`onError` logged to console (status goes through the bridge from overlay.js). No fetches.

- [ ] **Step 3: Rewrite `js/overlay.js`**

Boot flow:
1. `overlayParams(location.hash)` → missing key → setup screen reason `missing-key`; missing channel → `missing-channel`; channel `yourusername` → `placeholder`; `validateKey(key)` false → `invalid-key`. Show `#setup` with reason-specific text, `document.title` suffix, return (port of public/js/overlay.js:19-26 behavior).
2. `await unlockAudio()`; `loadEngine().catch(console.error)` (unchanged semantics).
3. `loadRoster()` with retry: loop `try { roster = await loadRoster() } catch { await sleep(5000) }` until success — commands are ignored until roster is loaded (Review Focus 1).
4. Settings: start from cached `ac_livecfg_<channel>` merged over `DEFAULT_SETTINGS`; `getSettings()` returns the live object. `mergeSettings` = per-top-level-key merge over `DEFAULT_SETTINGS`, with `permissions` merged key-wise (unknown keys dropped — the old server's deepMerge rejection semantics).
5. Bridge: `createBridge(key)`; `onHello` → `sendSet`-reply is dashboard-side; overlay sends `sendHello({ at })` on `SUBSCRIBED`; `onSet(({ settings }) => { live = mergeSettings(settings); save to liveCfgStore })`; bridge failure → log warning, continue without room (Review Focus 4); chat/TTS never await the bridge.
6. `startChat({ channel, getSettings, onCommand: (m) => enqueueSay(m) })`.
7. State reporter: `sendState({ at, audio: playerAudioState(), queue: queue.snapshot() })` every 4000 ms and immediately after each job starts/finishes; only when `bridge.isConnected()`.
8. `enqueueSay`: port of the server path — `villagerName` given → find + portrait check; else `parseCommand(text, roster.villagers, live, { exclude })`; cooldown via `queue.cooldownRemaining(user)`; build job (port of server.js:152-161: id, user, flags, villager, message, `holdMs: holdMsFor(message)`, at) → `markUsed` + `enqueue`.
9. `onJob(job)` renderer: near-verbatim port of public/js/overlay.js:162-219 (portrait cache/load, typewriter, card show/hide) — `requestReplacement` becomes local: re-run `enqueueSay({ user: job.user, text: job.message, flags: { broadcaster: true }, excludeVillager: job.villager.name })` instead of POSTing (port of public/js/overlay.js:221-243 flow); on parse failure keep the current portrait-less fallback behavior.
10. `window.animalese.say(name, text)` debug helper kept, routed to `enqueueSay` with `villagerName`.

- [ ] **Step 4: Verify**

Run: `node --check js/overlay.js && node --test tests/`
Expected: all unit tests still pass; overlay.js parses.
Serve locally and fetch both pages (from repo root):
```powershell
npx --yes serve -l 8090 .
# then: Invoke-WebRequest http://localhost:8090/overlay.html → 200
```
Manual checklist (hand to operator or run in a browser): overlay with `#c=test&k=<valid24key>` reaches roster-load + Supabase connect attempts; `#` empty shows setup screen; a `!ac` line with the dashboard closed still speaks (cached settings).

- [ ] **Step 5: Commit**

```bash
git add -A js/ overlay.html css/ public/
git commit -m "feat: static overlay with local pipeline and room status"
```

---

### Task 7: Dashboard page

**Files:**
- Create: `index.html` (based on public/control.html styles/sections)
- Rewrite: `js/control.js` (new root file; the old `public/js/control.js` copy dies with `public/` below)
- Delete: `public/` entirely (`git rm -r public` — removes control.html and the old `js/` copies: chat.js, control.js, overlay.js, tts.js, voice.js)

**Interfaces:**
- Consumes: everything from Tasks 1-4 (keys, roster, commands for `isAllowed`/defaults, bridge); no TTS on the dashboard side.
- Produces: none (entry module).

- [ ] **Step 1: Write `index.html`**

Port public/control.html structure + inline styles, plus from miguelium-wisdom/dashboard.html: the `.status` dot row, `.keybar`, `.msg` flash, preview iframe panel. Sections: header (title + status dot + keybar); "Channel" field (`#channel`, normalized on save); keybar (`#keynone`/`#keyval`, `#btn-copy` "Copy OBS URL" disabled until channel+key, `#btn-key` "Generate key"/"Change key"); preview iframe (`#preview`, hidden until channel+key); "Say something" (villager select `#cVillager`, message `#cMessage`, `#cSay`, `#sayNote`); "Chat command" info table (prefix `!ac`, cooldown, max length — read from live settings); "Settings" (`[data-perm]` checkboxes, `#vCooldown` seconds, `#vMaxLen`, `#vPortrait` requirePortrait checkbox, `#save` + `#saveNote`). Script `js/control.js` (module), ComfyJS tag NOT needed here. All asset paths relative.

- [ ] **Step 2: Rewrite `js/control.js`**

- On load: `savedChannel()` → input; adopt-hash flow (`adoptHashParams(location.hash)` then `history.replaceState` clean — port of cartas-cotemon/dashboard.html:382-387); key = `savedKey(channel)`; render keybar; if channel+key → start bridge + preview (`overlayUrl`) + load settings.
- Channel change → save, reload key/settings state, restart bridge, update preview.
- `#btn-key` → confirm dialog (copy ported from miguelium-wisdom/dashboard.html:275-289, English), `generateKey()`, save, restart bridge, copy URL, flash.
- `#btn-copy` → `copyText(overlayUrl(channel, key))` (clipboard + textarea fallback, port of miguelium dashboard.html:197-210), flash.
- Settings: load `ac_cfg_<channel>` over `DEFAULT_SETTINGS`; render into form; `#save` → validate/collect (port of public/js/control.js:112-143: seconds→ms, clamp 1-500), save to storage, `bridge.sendSet`, flash.
- Bridge: `onHello` → `sendSet(current settings)` (late-joiner sync); `onState` → update dot/TTL timer (live if < 12 s since last state, else "overlay not connected"), audio value, queue line (port of public/js/control.js:19-37 semantics); `onSay` → ignore (dashboard never receives its own, `self:false`).
- `#cSay` → `bridge.sendSay({ villagerName: value || null, text })`, flash "sent — watch your overlay" (no synchronous answer anymore); villager select populated from `loadRoster()` (shared cache), portrait-disabled options port of public/js/control.js:73-90.

- [ ] **Step 3: Verify**

Run: `node --check js/control.js`
Serve and fetch: `http://localhost:8090/` → 200, contains "Generate key".
Manual checklist: generate key → URL copied; open the copied URL in a second tab → overlay adopts nothing (overlay reads its own hash), dashboard preview iframe mirrors it; save settings with overlay open → overlay settings apply on next `set`; status dot goes live when overlay tab open.

- [ ] **Step 4: Commit**

```bash
git add index.html js/control.js public/
git commit -m "feat: dashboard with key generator, OBS URL copy, and room sync"
```

---

### Task 8: Cleanup, README, .gitignore

**Files:**
- Delete: `server.js`, `lib/`, `scripts/`, `data/`, `public/` (if anything remains), `package.json`, `package-lock.json`
- Modify: `.gitignore`, `README.md`

**Interfaces:**
- Consumes: nothing; pure cleanup (the operator explicitly asked to remove what the static build no longer needs).

- [ ] **Step 1: Delete dead server-era files**

```powershell
git rm -r server.js lib scripts data package.json package-lock.json
```
Expected: working tree keeps only static assets, js/, css/, tests/, docs/, README, .gitignore (`public/` was already removed in Task 7). (`node_modules/` is untracked/ignored — remove the folder from disk too: `Remove-Item -Recurse -Force node_modules`.)

- [ ] **Step 2: Trim `.gitignore`**

Final content:
```
*.log
.DS_Store
```

- [ ] **Step 3: Rewrite `README.md`**

Sections: what it is (keep opening line spirit); **Deploy** — fork/enable GitHub Pages (Settings → Pages → branch `main`, root), open `https://<user>.github.io/animalese-overlay/`; **Setup** — open dashboard → enter Twitch channel → Generate key → Copy OBS URL → paste in OBS Browser source (1280×720, 60 fps, Control audio via OBS, Audio Mixer → Monitor and Output); **Chat commands** table (kept from current README); **How isolation works** — one paragraph: key names a Supabase Realtime room, per-channel settings in browser storage, roster fetched live from Nookipedia (cached 24 h), sprite fetched from the animalese-tts repo (never committed); **Note** — Supabase free projects pause after ~1 week without activity; resume from the Supabase dashboard if the overlay stops connecting; **Credits** (keep, add that the audio sprite loads from izure1/animalese-tts at runtime); keep the Nintendo disclaimer.

- [ ] **Step 4: Final verification sweep**

Run:
```powershell
node --test tests/
Get-ChildItem -Recurse js,css -Include *.js | ForEach-Object { node --check $_.FullName }
```
Expected: all tests pass; all files parse.
Then grep for stale references — must return nothing relevant:
```
grep -rn "/api/\|/vendor/\|/sounds/\|server\.js\|express" js/ *.html README.md
```
Expected: no matches (README mentions none of these).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove server-era files, rewrite README for static deploy"
```
