import { resolveChannel, startChat } from './chat.js';
import {
  loadEngine,
  speak,
  unlockAudio,
  audioState,
  playerAudioState,
  reportState,
} from './tts.js';

const $ = (id) => document.getElementById(id);
const card = $('card');
const stage = $('stage');
const portrait = $('portrait');
const name = $('name');
const bubble = $('bubble');
const message = $('message');

const channel = resolveChannel();
if (!channel.ok) {
  $('setup').classList.add('show');
  document.title = `Animalese Overlay - ${channel.reason}`;
  reportState({ audio: 'skipped', reason: channel.reason });
} else {
  boot(channel.channel);
}

async function boot(channelName) {
  await unlockAudio();

  loadEngine().catch((err) => console.error('[overlay] sprite load failed', err));

  startChat({
    onState: (s) => {
      if (s.state === 'connected') reportState({ audio: audioState() });
      if (s.state === 'queued') console.log(`[overlay] ${s.user} -> ${s.villager}`);
    },
  });

  connectEvents();

  setInterval(() => {
    reportState({ audio: playerAudioState(), channel: channelName });
  }, 4000);
}

let events = null;

function connectEvents() {
  if (events) events.close();
  events = new EventSource('/api/events');

  events.addEventListener('job', (e) => {
    try {
      onJob(JSON.parse(e.data));
    } catch (err) {
      console.error('[overlay] bad job payload', err);
    }
  });

  events.onerror = () => {};
}

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
        img.decode().then(() => resolve(img), () => resolve(img));
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
        requestReplacement(job);
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

  hideTimer = setTimeout(() => {
    card.classList.remove('show');
    portrait.classList.remove('shake');
  }, 1700);
}

function requestReplacement(job) {
  fetch('/api/say', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      user: job.user,
      text: job.message,
      flags: { broadcaster: true },
      excludeVillager: job.villager.name,
    }),
  })
    .then((res) => (res.ok ? res.json() : null))
    .then((data) => {
      if (data && !data.ok) {
        generation += 1;
        portrait.hidden = true;
        name.textContent = displayName(job);
        startTypewriter(job.message, job.holdMs || 1800);
        card.classList.add('show');
      }
    })
    .catch((err) => console.error('[overlay] replacement failed', err));
}

Object.assign(window, {
  animalese: {
    say: (villagerName, text) =>
      onJob({
        user: 'control',
        villager: { name: villagerName, imageUrl: '' },
        message: text,
      }),
    audio: audioState,
  },
});
