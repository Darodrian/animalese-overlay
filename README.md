# animalese-overlay

A text-to-speech chat overlay that drops a random Animal Crossing villager
into your stream and reads chat messages in their voice. Fully static — no
server to run, deploy the repo as plain files.

## Deploy

The repo is designed for GitHub Pages:

1. Fork the repo and enable Pages (Settings → Pages → Deploy from a branch →
   branch `main`, folder `/ (root)`).
2. Open `https://<your-user>.github.io/animalese-overlay/`.

Any static file host works the same way.

## Setup

1. Open the dashboard (the deployed home page).
2. Enter your Twitch channel and press **Generate key** — the OBS URL is
   copied to your clipboard automatically.
3. In OBS, add a **Browser** source and paste the copied URL.
4. Set width to 1280, height to 720, framerate to 60.
5. Tick **Control audio via OBS**.
6. Open the Audio Mixer, right-click the browser source, and set monitoring to
   **Monitor and Output**.

The dashboard also previews the overlay live, lets you send a test line as any
villager, and holds the per-channel settings: who may use the chat command, the
per-user cooldown, message length, and portrait requirements. Settings reach a
running overlay without a reload.

## Chat commands

| Command | Result |
| --- | --- |
| `!ac hello` | a random villager says it |
| `!ac Ribbot hello` | Ribbot says it |
| `!ac` | a random villager's catchphrase |

These commands don't need to be registered with any chatbot. They start working
as soon as the OBS browser source is added.

## How isolation works

Each streamer generates a key, and that key names a private Supabase Realtime
room — chat commands and dashboard settings only ever reach overlays opened
with the same key, so there is no shared global room. Settings are stored per
channel in the browser's localStorage (dashboard side and overlay side), the
villager roster is fetched live from Nookipedia and cached for 24 hours, and
the audio sprite is fetched at runtime from the
[animalese-tts](https://github.com/izure1/animalese-tts) repository, pinned to
a commit — no game audio is committed to this repo.

## Note on Supabase's free tier

Free-tier Supabase projects pause after roughly a week without database
activity. If the overlay stops connecting, resume the project from the
Supabase dashboard — rooms work again immediately after.

## Credits

- [animalese-tts](https://github.com/izure1/animalese-tts) (audio sprite
  loaded from the repo at runtime)
- [Nookipedia](https://nookipedia.com/wiki/Nookipedia)

Not affiliated with or endorsed by Nintendo. Animal Crossing is a trademark of
Nintendo.
