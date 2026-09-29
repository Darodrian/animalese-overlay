const PLACEHOLDER_CHANNEL = 'yourusername';

export function resolveChannel() {
  const raw = (new URLSearchParams(location.search).get('channel') ?? '').trim();
  if (!raw) return { ok: false, channel: '', reason: 'missing' };
  if (raw.toLowerCase() === PLACEHOLDER_CHANNEL) {
    return { ok: false, channel: raw, reason: 'placeholder' };
  }
  return { ok: true, channel: raw.toLowerCase(), reason: null };
}

function allowedBy(flags, permissions) {
  return Boolean(
    (flags.broadcaster && permissions.broadcaster) ||
      (flags.mod && permissions.mod) ||
      (flags.vip && permissions.vip) ||
      (flags.subscriber && permissions.subscriber),
  );
}

export function startChat({ prefix = 'ac', onCommand, onState }) {
  const ComfyJS = window.ComfyJS;
  if (!ComfyJS) {
    onState?.({ state: 'error', detail: 'comfy.js failed to load' });
    return;
  }

  let permissions = { broadcaster: true, mod: true, vip: true, subscriber: true };
  fetch('/api/config')
    .then((r) => r.json())
    .then((c) => {
      permissions = c.permissions ?? permissions;
      prefix = c.command?.prefix ?? prefix;
    })
    .catch(() => {});

  ComfyJS.onConnected = () => onState?.({ state: 'connected' });
  ComfyJS.onError = (err) => onState?.({ state: 'error', detail: String(err?.message ?? err) });

  ComfyJS.onCommand = (user, command, message, flags, extra) => {
    if (command.toLowerCase() !== prefix.toLowerCase()) return;
    if (!allowedBy(flags ?? {}, permissions)) return;

    fetch('/api/say', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user,
        text: message,
        flags,
        channel: extra?.channel,
      }),
    })
      .then((r) => r.json().then((b) => ({ status: r.status, body: b })))
      .then(({ status, body }) => {
        if (status === 200) onState?.({ state: 'queued', user, villager: body.job?.villager?.name });
        else if (status === 429) onState?.({ state: 'cooldown', user, retryAfterMs: body.retryAfterMs });
      })
      .catch((err) => onState?.({ state: 'error', detail: err.message }));
  };

  const channel = new URLSearchParams(location.search).get('channel');
  ComfyJS.Init(channel, null, null, false);
  onState?.({ state: 'connecting' });
}
