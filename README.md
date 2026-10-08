# animalese-overlay

A text-to-speech chat bot that drops a random Animal Crossing villager into your
stream and reads chat messages in their voice.

## Chat commands

| Command | Result |
| --- | --- |
| `!ac hello` | a random villager says it |
| `!ac Ribbot hello` | Ribbot says it |
| `!ac` | a random villager's catchphrase |

These commands don't need to be registered with any chatbot. They start working
as soon as the OBS browser source is added.

## Control panel

Open [the home page](https://animalese-overlay.onrender.com/) in a browser to
reach the control panel. It shows whether an overlay is connected and whether
audio is running, lets you send a line to a villager you pick, and holds the
settings for who may use the chat command, the per-user cooldown, and the
maximum message length.

## OBS setup

1. In OBS, add a **Browser** source.
2. Set the URL to
   `https://animalese-overlay.onrender.com/overlay.html?channel=yourusername`,
   swapping in your own channel name. Without `?channel=` the overlay won't
   read chat.
3. Set width to 1280, height to 720, framerate to 60.
4. Tick **Control audio via OBS**.
5. Open the Audio Mixer, right-click the browser source, and set monitoring to
   **Monitor and Output**.

## Credits

- [animalese-tts](https://github.com/izure1/animalese-tts)
- [Nookipedia](https://nookipedia.com/wiki/Nookipedia)

Not affiliated with or endorsed by Nintendo. Animal Crossing is a trademark of
Nintendo.
