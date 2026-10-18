import { isAllowed } from './commands.js';

// ComfyJS llega como global desde la etiqueta del CDN en overlay.html.
export function startChat({ channel, getSettings, onCommand }) {
  const ComfyJS = window.ComfyJS;
  if (!ComfyJS) {
    console.error('[chat] comfy.js failed to load');
    return;
  }

  ComfyJS.onConnected = () => console.log(`[chat] connected to #${channel}`);
  ComfyJS.onError = (err) => console.error('[chat]', err?.message ?? err);

  ComfyJS.onCommand = (user, command, message, flags) => {
    const settings = getSettings();
    if (command.toLowerCase() !== String(settings.prefix ?? 'ac').toLowerCase()) return;
    if (!isAllowed(flags ?? {}, settings.permissions)) return;
    onCommand({ user, text: message, flags });
  };

  ComfyJS.Init(channel, null, null, false);
}
