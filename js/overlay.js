import { overlayParams, validateKey } from './keys.js';
import { DEFAULT_SETTINGS, liveCfgStore } from './config.js';
import { loadRoster, findVillager } from './roster.js';
import { sanitiseText, parseCommand, holdMsFor, createQueue } from './commands.js';
import { createBridge } from './bridge.js';
import { startChat } from './chat.js';
import { loadEngine, speak, unlockAudio, audioState, playerAudioState } from './tts.js';

const PLACEHOLDER_CHANNEL = 'yourusername';

const $ = (id) => document.getElementById(id);
const card = $('card');
const stage = $('stage');
const portrait = $('portrait');
const name = $('name');
const bubble = $('bubble');
const message = $('message');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SETUP_REASONS = {
  'missing-key': {
    headline: 'This overlay needs its key',
    detail:
      'Open the dashboard, generate a key for your channel, then use Copy OBS URL — every streamer has their own room.',
  },
  'missing-channel': {
    headline: 'This overlay needs your channel',
    detail: 'Use Copy OBS URL on the dashboard to get a link that already includes it.',
  },
  placeholder: {
    headline: 'Replace yourusername with your channel',
    detail: 'Use Copy OBS URL on the dashboard to get a link that already includes it.',
  },
  'invalid-key': {
    headline: "That key doesn't look valid",
    detail: 'Use Copy OBS URL on the dashboard to get a fresh link.',
  },
};

function showSetup(reason) {
  const copy = SETUP_REASONS[reason] ?? SETUP_REASONS['invalid-key'];
  $('setup-headline').textContent = copy.headline;
  $('setup-detail').textContent = copy.detail;
  $('setup').classList.add('show');
  document.title = `Animalese Overlay - ${reason}`;
}

const { channel, key } = overlayParams(location.hash);
if (!key) showSetup('missing-key');
else if (!channel) showSetup('missing-channel');
else if (channel === PLACEHOLDER_CHANNEL) showSetup('placeholder');
else if (!validateKey(key)) showSetup('invalid-key');
else boot(channel, key);

// ---- ajustes en vivo ----

const num = (v, def) => (Number.isFinite(Number(v)) ? Number(v) : def);

// Merge por clave de primer nivel sobre DEFAULT_SETTINGS; permissions en particular;
// las claves desconocidas se descartan (misma semantica que el deepMerge del servidor).
function mergeSettings(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const permSrc = src.permissions && typeof src.permissions === 'object' ? src.permissions : {};
  const permissions = {};
  for (const k of Object.keys(DEFAULT_SETTINGS.permissions)) {
    permissions[k] = Boolean(permSrc[k]);
  }
  return {
    prefix: String(src.prefix ?? DEFAULT_SETTINGS.prefix).trim() || DEFAULT_SETTINGS.prefix,
    permissions,
    userCooldownMs: num(src.userCooldownMs, DEFAULT_SETTINGS.userCooldownMs),
    minGapMs: num(src.minGapMs, DEFAULT_SETTINGS.minGapMs),
    maxLength: num(src.maxLength, DEFAULT_SETTINGS.maxLength),
    requirePortrait: Boolean(
      src.requirePortrait === undefined ? DEFAULT_SETTINGS.requirePortrait : src.requirePortrait,
    ),
  };
}

function readCachedSettings(channelName) {
  try {
    return JSON.parse(localStorage.getItem(liveCfgStore(channelName)) || 'null');
  } catch {
    return null;
  }
}

function cacheSettings(channelName, settings) {
  try {
    localStorage.setItem(liveCfgStore(channelName), JSON.stringify(settings));
  } catch {
    // modo privado
  }
}

// ---- estado ----

let live = null;
let roster = null;
let bridge = null;
let jobSeq = 0;

const queue = createQueue({ minGapMs: 1200, onJob });

async function boot(channelName, roomKey) {
  live = mergeSettings(readCachedSettings(channelName));
  queue.setMinGap(live.minGapMs);

  await unlockAudio();
  loadEngine().catch((err) => console.error('[overlay] sprite load failed', err));

  connectRoom(roomKey); // sin await: el chat y el TTS nunca esperan a la sala

  roster = await loadRosterWithRetry();

  startChat({
    channel: channelName,
    getSettings: () => live,
    onCommand: (m) => enqueueSay(m),
  });

  setInterval(reportState, 4000);
}

async function loadRosterWithRetry() {
  for (;;) {
    try {
      const loaded = await loadRoster();
      console.log(`[overlay] roster ready: ${loaded.villagers.length} villagers${loaded.stale ? ' (stale cache)' : ''}`);
      return loaded;
    } catch (err) {
      console.warn('[overlay] roster load failed, retrying in 5s', err?.message ?? err);
      await sleep(5000);
    }
  }
}

async function connectRoom(roomKey) {
  try {
    const b = createBridge(roomKey);
    b.onSet(({ settings }) => {
      live = mergeSettings(settings);
      queue.setMinGap(live.minGapMs);
      cacheSettings(channel, live);
      console.log('[overlay] settings updated from dashboard');
    });
    await b.connect();
    bridge = b;
    b.sendHello({ at: Date.now() });
    reportState();
    console.log('[overlay] room connected');
  } catch (err) {
    bridge = null;
    console.warn('[overlay] room unavailable, continuing without it', err?.message ?? err);
  }
}

function reportState() {
  if (!bridge?.isConnected()) return;
  bridge.sendState({ at: Date.now(), audio: playerAudioState(), queue: queue.snapshot() });
}

// ---- pipeline de comandos ----

function enqueueSay({ user, text, flags = {}, villagerName = null, excludeVillager = null }) {
  const settings = live;
  const userKey = String(user ?? '').toLowerCase();

  if (!roster) {
    console.log('[overlay] roster not ready, ignoring command');
    return false;
  }

  const remaining = queue.cooldownRemaining(userKey);
  if (remaining > 0) {
    console.log(`[overlay] ${user} on cooldown (${Math.ceil(remaining / 1000)}s)`);
    return false;
  }

  let villager;
  let messageText;

  if (villagerName) {
    villager = findVillager(roster.villagers, villagerName);
    if (!villager) {
      console.log(`[overlay] unknown villager: ${villagerName}`);
      return false;
    }
    if (settings.requirePortrait && !villager.isPortrait) {
      console.log(`[overlay] ${villagerName} has no usable portrait`);
      return false;
    }
    messageText = sanitiseText(text, settings.maxLength) || villager.phrase || villager.name;
  } else {
    const parsed = parseCommand(text, roster.villagers, settings, { exclude: excludeVillager });
    if (!parsed.ok) {
      console.log(`[overlay] command rejected: ${parsed.reason}`);
      return false;
    }
    villager = parsed.job.villager;
    messageText = parsed.job.message;
  }

  const job = {
    id: `${Date.now()}-${(jobSeq += 1)}`,
    user: userKey,
    flags,
    villager,
    message: messageText,
    holdMs: holdMsFor(messageText),
    at: Date.now(),
  };

  queue.markUsed(userKey, settings.userCooldownMs);
  queue.enqueue(job);
  console.log(`[overlay] ${userKey} -> ${villager.name}`);
  return true;
}

// ---- render ----

let hideTimer = null;
let typeTimer = null;
let generation = 0;

const portraitCache = new Map();

function loadPortrait(url) {
  const hit = portraitCache.get(url);
  if (hit) return hit;

  const pending = new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (typeof img.decode === 'function') {
        img.decode().then(
          () => resolve(img),
          () => resolve(img),
        );
      } else {
        resolve(img);
      }
    };
    img.onerror = () => reject(new Error(`portrait failed: ${url}`));
    img.src = url;
  }).catch((err) => {
    portraitCache.delete(url);
    throw err;
  });

  portraitCache.set(url, pending);
  return pending;
}

const INTERNAL_USERS = new Set(['control', 'overlay', 'unknown']);

function displayName(job) {
  const user = String(job.user ?? '').trim();
  return !user || INTERNAL_USERS.has(user.toLowerCase()) ? job.villager.name : user;
}

function clearTypewriter() {
  if (typeTimer) {
    clearInterval(typeTimer);
    typeTimer = null;
  }
  message.classList.remove('typing');
}

function startTypewriter(text, durationMs) {
  clearTypewriter();
  const chars = Array.from(text);
  message.textContent = '';
  if (!chars.length) {
    fit();
    return;
  }

  const perChar = Math.max(18, Math.min(durationMs / chars.length, 140));
  message.classList.add('typing');

  let i = 0;
  typeTimer = setInterval(() => {
    i += 1;
    message.textContent = chars.slice(0, i).join('');
    fit();
    if (i >= chars.length) clearTypewriter();
  }, perChar);
}

const PORTRAIT_MAX = 400;
const PORTRAIT_MIN = 80;
const BUBBLE_GAP = 12;
const LEAD_STEPS = [1.22, 1.1, 1];

function fitLeading() {
  const available = stage.getBoundingClientRect().bottom;
  const budget = available - BUBBLE_GAP - PORTRAIT_MIN;

  let step = 0;
  for (; step < LEAD_STEPS.length; step += 1) {
    message.classList.toggle('tight', step === 1);
    message.classList.toggle('tighter', step === 2);
    if (bubble.offsetHeight <= budget) break;
  }
}

function fitPortrait() {
  if (portrait.hidden) return;
  const available = stage.getBoundingClientRect().bottom;
  const free = available - bubble.offsetHeight - BUBBLE_GAP;
  portrait.style.height = `${Math.max(PORTRAIT_MIN, Math.min(PORTRAIT_MAX, free))}px`;
}

function fit() {
  fitLeading();
  fitPortrait();
}

window.addEventListener('resize', fit);

async function onJob(job) {
  const mine = ++generation;
  reportState();

  if (hideTimer) clearTimeout(hideTimer);
  clearTypewriter();
  portrait.classList.remove('shake');
  portrait.style.height = '';
  message.classList.remove('tight', 'tighter');

  const url = job.villager.imageUrl;
  let img = null;

  if (url) {
    try {
      img = await loadPortrait(url);
    } catch (err) {
      console.warn('[overlay]', err.message);
      try {
        img = await loadPortrait(`${url}${url.includes('?') ? '&' : '?'}retry=1`);
      } catch {
        if (!requestReplacement(job)) renderPortraitless(job);
        return;
      }
    }
  }

  if (mine !== generation) return;

  portrait.hidden = !img;
  if (img) portrait.src = img.src;

  name.textContent = displayName(job);
  message.textContent = '';

  card.classList.add('show');
  if (img) portrait.classList.add('shake');

  try {
    await speak(job.message, {
      onDuration: (ms) => {
        if (mine === generation) startTypewriter(job.message, ms);
      },
    });
  } catch (err) {
    console.error('[overlay] speak failed', err);
  }

  if (mine !== generation) return;

  clearTypewriter();
  message.textContent = job.message;
  fit();
  reportState();

  hideTimer = setTimeout(() => {
    card.classList.remove('show');
    portrait.classList.remove('shake');
  }, 1700);
}

// El retrato fallo: pide otro al aldeano sin retrato; si la cola lo rechaza,
// cae al render sin retrato (el viejo fallback de /api/say con !ok).
function requestReplacement(job) {
  return enqueueSay({
    user: job.user,
    text: job.message,
    flags: { broadcaster: true },
    excludeVillager: job.villager.name,
  });
}

function renderPortraitless(job) {
  generation += 1;
  portrait.hidden = true;
  name.textContent = displayName(job);
  startTypewriter(job.message, job.holdMs || 1800);
  card.classList.add('show');
}

Object.assign(window, {
  animalese: {
    say: (villagerName, text) =>
      enqueueSay({ user: 'control', text, flags: { broadcaster: true }, villagerName }),
    audio: audioState,
  },
});
