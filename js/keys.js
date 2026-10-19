import { CHANNEL_STORE, keyStore } from './config.js';

// Alfabeto sin 0, 1, o, i, l para evitar confusiones al leerla en voz alta.
const KEY_ALPHABET = '23456789abcdefghjkmnpqrstuvwxyz';
const KEY_RE = /^[23456789abcdefghjkmnpqrstuvwxyz]{24}$/;

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

function store(storage) {
  return storage ?? safeStorage();
}

function storageGet(storage, key, def) {
  try {
    const s = store(storage);
    if (!s) return def;
    const v = s.getItem(key);
    return v === null || v === undefined ? def : v;
  } catch {
    return def;
  }
}

function storageSet(storage, key, value) {
  try {
    const s = store(storage);
    if (s) s.setItem(key, String(value));
  } catch {
    // modo privado
  }
}

export function normChannel(raw) {
  return String(raw ?? '').trim().toLowerCase();
}

export function generateKey(len = 24) {
  const n = KEY_ALPHABET.length;
  const limit = 256 - (256 % n); // descarta los ultimos bytes para no sesgar
  const out = [];
  while (out.length < len) {
    const bytes = new Uint8Array(len * 2);
    crypto.getRandomValues(bytes);
    for (const b of bytes) {
      if (b < limit) out.push(KEY_ALPHABET[b % n]);
      if (out.length === len) break;
    }
  }
  return out.join('');
}

export function validateKey(k) {
  return KEY_RE.test(String(k ?? ''));
}

export function savedChannel(storage) {
  return normChannel(storageGet(storage, CHANNEL_STORE, ''));
}

export function saveChannel(v, storage) {
  storageSet(storage, CHANNEL_STORE, normChannel(v));
}

export function savedKey(channel, storage) {
  return String(storageGet(storage, keyStore(channel), '')).trim();
}

export function saveKey(channel, v, storage) {
  storageSet(storage, keyStore(channel), String(v).trim());
}

export function hasKey(channel, storage) {
  return savedKey(channel, storage).length > 0;
}

export function overlayParams(hash) {
  const params = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  return {
    channel: normChannel(params.get('c')),
    key: String(params.get('k') ?? '').trim(),
  };
}

export function adoptHashParams(hash, storage) {
  const { channel, key } = overlayParams(hash);
  if (!channel || !key) return false;
  saveChannel(channel, storage);
  saveKey(channel, key, storage);
  return true;
}

export function overlayUrl(channel, key) {
  const hash = `c=${encodeURIComponent(normChannel(channel))}&k=${encodeURIComponent(key)}`;
  if (typeof location === 'undefined' || !location?.href) return `overlay.html#${hash}`;
  const base = new URL('overlay.html', location.href);
  base.hash = hash;
  return base.href;
}
