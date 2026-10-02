# Animalese Overlay

An OBS browser source that picks a random Animal Crossing villager and speaks
Twitch chat messages in their voice.

## OBS setup

1. Add a **Browser** source, set its URL to
   `/overlay?channel=yourusername`, and swap
   `yourusername` for your Twitch channel.
2. Then 1280×720, 60 fps.
3. Tick **Control audio via OBS**.
4. Audio Mixer → Browser Source → Monitor = **Monitor**.

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
