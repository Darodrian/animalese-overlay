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

- Build command: `npm ci && npm run setup && npm run refresh`
- Start command: `npm start`

**The build requires outbound network access to two third parties.** `setup`
fetches the audio sprite from GitHub, and `refresh` queries the Nookipedia
API. Both scripts exit non-zero on failure, so a deploy is rejected rather
than shipping without audio or without villagers.

`setup` also asserts the sprite is exactly 1,279,244 bytes and that it is a
valid RIFF/WAVE file. If the upstream audio is ever regenerated at a different
length, the build fails loudly instead of quietly serving a mismatched sprite.

Neither generated asset is committed. They are rebuilt on every deploy and
discarded with the build container afterwards.

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
  other data are regenerated at build time and not committed here.

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
