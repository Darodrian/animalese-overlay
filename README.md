# Animalese Overlay

An OBS browser source that picks a random Animal Crossing villager and speaks
Twitch chat messages in their voice.

---

## Local setup

```
npm ci
npm run setup
npm run refresh
npm start
```

`setup` downloads the audio sprite into `public/sounds/`, `refresh` rebuilds
the villager roster into `data/villagers.json`. Both are one-shot commands and
are not needed again unless the upstream data changes.

The server listens on `PORT` (default 8787) and serves the overlay, the control
panel, and the API from a single origin.

---

## Deploying

Suitable for any host that runs a Node process and gives you a disk-less
container. Node 22 or newer.

- Build command: `npm ci && npm run setup`
- Start command: `npm start`

**The build requires outbound network access to GitHub.** `setup` fetches the
audio sprite from a raw GitHub URL and exits non-zero if that fails, so a
deploy is rejected rather than shipping without audio.

`setup` also asserts the sprite is exactly 1,279,244 bytes and that it is a
valid RIFF/WAVE file. If the upstream audio is ever regenerated at a different
length, the build fails loudly instead of quietly serving a mismatched sprite.

The villager roster is committed to the repository rather than fetched at
build time, because Nookipedia sits behind a CDN that rejects requests from
some datacenter IP ranges with HTTP 403. Running `npm run refresh` during a
build from a Render container fails for this reason. Instead, regenerate it
locally and commit the result whenever you want current data:

```
npm run refresh
git add data/villagers.json
```

The sprite is not committed, since it is Nintendo game audio. It is rebuilt
on every deploy and discarded with the build container afterwards.

### Configuration

`data/config.json` is committed and holds the deployed defaults: the command
prefix, per-user cooldown, message length limit, and which chat roles may
trigger speech. There are no credentials in it. Twitch authentication happens
in the OBS browser source, never on the server.

Edits made from the control panel are written to disk and take effect for
running overlays immediately, but on a host with an ephemeral filesystem they
do not survive a redeploy or spin-down. Treat the committed file as the source
of truth and change it there when you want a setting to persist.

Note that `command.minGapMs` is read once during startup, so changing it
requires a restart.

### Deployment notes

`PUT /api/config` and `GET /api/status` are unauthenticated. Anyone who knows
the public URL can change your chat permissions and cooldown settings, and
`/api/status` returns your full config. That is fine for a private overlay on
an unguessable URL; it is not fine on a shared or guessable host.

---

## Credits and licensing

- **Animal Crossing audio.** `public/sounds/english-sprite.wav` is Nintendo
  property. It is downloaded at build time from
  [`animalese-tts`](https://github.com/izure1/animalese-tts) and is not
  committed to this repository or redistributed by it.
- **`animalese-tts`** is MIT licensed, copyright izure.
- **Villager data** comes from
  [Nookipedia](https://nookipedia.com/wiki/Nookipedia:General_disclaimer).
  Nookipedia's text content is licensed CC BY-SA 4.0 (CC BY-SA 3.0 for
  content submitted before January 1, 2025). Villager names, phrases, and
  other data are committed here in `data/villagers.json`. The file stores only
  image *URLs* pointing back to Nookipedia; no images are redistributed.

Not affiliated with or endorsed by Nintendo. Animal Crossing is a trademark of
Nintendo.

---

## OBS setup

1. Add a **Browser** source, set its URL to
   `/overlay?channel=yourusername`, and swap
   `yourusername` for your Twitch channel.
2. Then 1280×720, 60 fps.
3. Tick **Control audio via OBS**.
4. Audio Mixer → Browser Source → Monitor = **Monitor**.
