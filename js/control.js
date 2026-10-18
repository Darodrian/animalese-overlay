import { savedChannel, saveChannel, savedKey, saveKey, hasKey, generateKey, adoptHashParams, overlayUrl } from './keys.js';
import { DEFAULT_SETTINGS, cfgStore } from './config.js';
import { loadRoster } from './roster.js';
import { createBridge } from './bridge.js';

const $ = (id) => document.getElementById(id);

const STATE_TTL = 12000;

const good = (t) => `<span class="good">${t}</span>`;
const bad = (t) => `<span class="bad">${t}</span>`;
const warn = (t) => `<span class="warn">${t}</span>`;

let channel = savedChannel();
let key = '';
let config = null;
let bridge = null;
let roomGen = 0;
let lastStateAt = 0;
let flashTimer = null;

// La clave llega en el hash cuando el panel se abre desde la URL copiada.
// Se adopta y se limpia el hash: a partir de aqui manda localStorage.
if (adoptHashParams(location.hash)) {
  history.replaceState(null, '', location.pathname + location.search);
  channel = savedChannel();
}
key = savedKey(channel);

function setDot(kind, text) {
  $('dot-ov').className = 'dot' + (kind ? ' ' + kind : '');
  $('status-ov').textContent = text;
}

function flash(text) {
  const msg = $('msg');
  msg.textContent = text;
  msg.hidden = false;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    msg.hidden = true;
    msg.textContent = '';
  }, 5000);
}

function showKey() {
  const has = !!key;
  $('keyval').textContent = key;
  $('keyval').hidden = !has;
  $('keynone').hidden = has;
  $('btn-copy').disabled = !has || !channel;
  $('btn-key').textContent = has ? 'Change key' : 'Generate key';
}

function updatePreview() {
  if (channel && key) {
    $('preview').src = overlayUrl(channel, key);
    $('preview').hidden = false;
    $('preview-note').textContent = 'Live preview: what you see here is what OBS shows.';
  } else {
    $('preview').hidden = true;
    $('preview-note').textContent = 'Generate a key to see here the same overlay you put in OBS.';
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
    } catch {
      // sin portapapeles
    }
    ta.remove();
  }
}

// ---- ajustes ----

function loadSettings() {
  let raw = null;
  try {
    raw = JSON.parse(localStorage.getItem(cfgStore(channel)) || 'null');
  } catch {
    raw = null;
  }
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    ...DEFAULT_SETTINGS,
    ...src,
    permissions: { ...DEFAULT_SETTINGS.permissions, ...(src.permissions ?? {}) },
  };
}

const num = (el) => {
  if (el.value.trim() === '') return null;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : null;
};

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));

function renderConfig() {
  $('cPrefix').textContent = `!${config.prefix}`;
  $('cCooldown').textContent = `${config.userCooldownMs / 1000}s`;
  $('cMaxLen').textContent = `${config.maxLength} chars`;

  for (const box of document.querySelectorAll('[data-perm]')) {
    box.checked = Boolean(config.permissions[box.dataset.perm]);
  }
  $('vCooldown').value = Math.round(config.userCooldownMs / 1000);
  $('vMaxLen').value = config.maxLength;
  $('vPortrait').checked = Boolean(config.requirePortrait);
}

$('save').addEventListener('click', () => {
  const note = $('saveNote');
  if (!channel) {
    note.innerHTML = bad('set your channel first');
    return;
  }

  const permissions = {};
  for (const box of document.querySelectorAll('[data-perm]')) {
    permissions[box.dataset.perm] = box.checked;
  }

  config = {
    prefix: config?.prefix ?? DEFAULT_SETTINGS.prefix,
    permissions,
    userCooldownMs: (num($('vCooldown')) ?? 30) * 1000,
    minGapMs: config?.minGapMs ?? DEFAULT_SETTINGS.minGapMs,
    maxLength: clampInt(num($('vMaxLen')) ?? DEFAULT_SETTINGS.maxLength, 1, 500),
    requirePortrait: $('vPortrait').checked,
  };

  try {
    localStorage.setItem(cfgStore(channel), JSON.stringify(config));
  } catch {
    note.innerHTML = warn('saved in memory only (storage unavailable)');
  }

  renderConfig();
  if (bridge?.isConnected()) bridge.sendSet({ settings: config });
  note.innerHTML = good('saved. running overlays pick this up without a reload.');
});

// ---- sala ----

async function startRoom() {
  const gen = ++roomGen;
  if (bridge) {
    await bridge.leave();
    bridge = null;
  }
  lastStateAt = 0;
  if (gen !== roomGen) return;
  if (!channel || !key) {
    setDot('', 'No room yet');
    return;
  }

  setDot('busy', 'Connecting...');
  try {
    const b = createBridge(key);
    b.onStatus((s) => {
      if (s === 'CHANNEL_ERROR') setDot('err', 'Key rejected');
      else if (s === 'CLOSED') setDot('', 'Room closed');
    });
    b.onHello(() => {
      lastStateAt = Date.now();
      setDot('live', 'Overlay connected');
      // Confirma los ajustes guardados por si el overlay se abrio recien.
      b.sendSet({ settings: config });
    });
    b.onState((payload) => renderState(payload));
    await b.connect();
    if (gen !== roomGen) {
      await b.leave();
      return;
    }
    bridge = b;
    b.sendSet({ settings: config });
    setDot('busy', 'Waiting for overlay...');
  } catch (err) {
    if (gen !== roomGen) return;
    const m = err?.message ?? '';
    setDot(
      'err',
      m === 'CHANNEL_ERROR' ? 'Key rejected' : m === 'TIMED_OUT' ? 'No response' : 'Could not connect to the room',
    );
  }
}

function renderState(payload) {
  lastStateAt = Date.now();
  setDot('live', 'Overlay connected');

  const audio = payload.audio ?? 'unknown';
  $('sAudio').innerHTML =
    audio === 'running' ? good('running') : bad(`${audio} — no sound will play`);

  const q = payload.queue ?? { playing: false, pending: 0 };
  $('sQueue').textContent = q.playing
    ? `speaking, ${q.pending} waiting`
    : q.pending
      ? `${q.pending} waiting`
      : 'idle';
}

setInterval(() => {
  if (bridge?.isConnected() && lastStateAt && Date.now() - lastStateAt > STATE_TTL) {
    setDot('', 'Overlay not connected');
  }
}, 5000);

// ---- canal y clave ----

$('channel').addEventListener('change', () => {
  saveChannel($('channel').value);
  channel = savedChannel();
  key = savedKey(channel);
  config = loadSettings();
  showKey();
  renderConfig();
  startRoom();
  updatePreview();
  loadVillagers();
});

$('btn-key').addEventListener('click', async () => {
  if (!channel) {
    flash('Type your channel first');
    return;
  }
  const had = hasKey(channel);
  const msg = had
    ? 'A new key will be generated.\n\nYour overlay will stop syncing until you paste the new URL into OBS (Browser Source > URL). You will have to copy it again.'
    : 'A key will be generated for your overlay.\n\nThen copy it with "Copy OBS URL" and paste it into the OBS browser source.';
  if (!confirm(msg)) return;
  key = generateKey();
  saveKey(channel, key);
  showKey();
  await startRoom();
  updatePreview();
  await copyText(overlayUrl(channel, key));
  flash(had ? 'New key generated and URL copied. Update OBS.' : 'Key generated and URL copied. Paste it into OBS.');
});

$('btn-copy').addEventListener('click', async () => {
  await copyText(overlayUrl(channel, key));
  flash('OBS URL copied');
});

// ---- decir algo ----

$('cSay').addEventListener('click', () => {
  const note = $('sayNote');
  if (!bridge?.isConnected()) {
    note.innerHTML = bad('overlay is not connected to the room');
    return;
  }
  const villager = $('cVillager').value;
  const text = $('cMessage').value;
  bridge.sendSay({ villagerName: villager || null, text });
  note.innerHTML = good('sent — watch your overlay');
});

async function loadVillagers() {
  const sel = $('cVillager');
  try {
    const r = await loadRoster();
    const previous = sel.value;
    sel.innerHTML =
      '<option value="">Random</option>' +
      r.villagers
        .map((x) => {
          const playable = !config?.requirePortrait || x.isPortrait;
          return `<option value="${x.name}"${playable ? '' : ' disabled'}>${x.name} &mdash; ${x.personality}${playable ? '' : ' (no portrait)'}</option>`;
        })
        .join('');
    if (previous && sel.querySelector(`option[value="${CSS.escape(previous)}"]:not(:disabled)`)) {
      sel.value = previous;
    }
  } catch (err) {
    flash(`villager list unavailable: ${err?.message ?? err}`);
  }
}

// ---- inicio ----

$('channel').value = channel;
config = loadSettings();
showKey();
renderConfig();
updatePreview();
startRoom();
loadVillagers();
