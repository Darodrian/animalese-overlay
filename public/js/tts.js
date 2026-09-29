import {
  AnimaleseEngine,
  EnglishAnalyzer,
  WebSampler,
  PitchManager,
  WebPlayer,
} from '/vendor/animalese-tts.mjs';

import { drawVoice, DEFAULT_PUNCTUATIONS } from './voice.js';

const SPRITE_WAV = '/sounds/english-sprite.wav';
const SPRITE_MAP = '/sounds/english-sprite.json';

class VoiceChain {
  constructor() {
    this.pitch = 1.5;
    this.speed = 4;
    this.randomness = 0.1;
    this.melodyRate = 0.05;
    this.melodyAmplitude = 0.1;
    this.#manager = new PitchManager(this);
  }

  #manager;

  setVoice(voice) {
    if (Number.isFinite(voice.pitch)) this.pitch = voice.pitch;
    if (Number.isFinite(voice.speed)) this.speed = voice.speed;
    if (Number.isFinite(voice.randomness)) this.randomness = voice.randomness;
    if (Number.isFinite(voice.melodyRate)) this.melodyRate = voice.melodyRate;
    if (Number.isFinite(voice.melodyAmplitude)) this.melodyAmplitude = voice.melodyAmplitude;
    this.#manager = new PitchManager(this);
  }

  calculatePitch(charIndex) {
    return this.#manager.calculatePitch(charIndex);
  }

  apply(buffer, pitchRatio) {
    return this.#manager.apply(buffer, pitchRatio);
  }
}

let engine = null;
let player = null;
let voiceChain = null;
let loadPromise = null;

export function playerAudioState() {
  try {
    return player?.audioContext?.state ?? 'none';
  } catch {
    return 'none';
  }
}

export async function loadEngine() {
  if (engine) return engine;
  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    const map = await (await fetch(SPRITE_MAP)).json();

    const sampler = new WebSampler(SPRITE_WAV, map);
    voiceChain = new VoiceChain();
    player = new WebPlayer();

    engine = new AnimaleseEngine({
      analyzer: new EnglishAnalyzer(),
      sampler,
      effect: voiceChain,
      spaceDelay: 0.03,
      punctuationDelay: 0.3,
      punctuations: DEFAULT_PUNCTUATIONS,
    });

    await engine.load();
    player.sampleRate = sampler.sampleRate;

    return engine;
  })();

  try {
    return await loadPromise;
  } catch (err) {
    loadPromise = null;
    throw err;
  }
}

async function speakNow(message, { onDuration } = {}) {
  await loadEngine();

  const voice = drawVoice();
  voiceChain.setVoice(voice);

  const cfg = engine.config;
  cfg.spaceDelay = voice.spaceDelay;
  cfg.punctuationDelay = voice.punctuationDelay;
  cfg.punctuations = voice.punctuations;

  const buffers = [];
  for await (const output of engine.synthesize(message).speak()) {
    if (output.buffer?.length) buffers.push(output.buffer);
  }
  const total = buffers.reduce((n, b) => n + b.length, 0);
  if (!total) return { samples: 0, voice };

  onDuration?.(Math.round((total / (player.sampleRate || 48000)) * 1000));

  await player.drainAndPlay(buffers);
  return { samples: total, voice };
}

let chain = Promise.resolve();

export function speak(message, opts) {
  const run = chain.then(() => speakNow(message, opts));
  chain = run.catch(() => {});
  return run;
}

let probe = null;
let unlockTimer = null;
let unlockAttempts = 0;

export function audioState() {
  return probe?.state ?? 'none';
}

export async function unlockAudio({ attempts = 40, intervalMs = 250 } = {}) {
  if (!probe) {
    const Ctor = window.AudioContext ?? window.webkitAudioContext;
    if (!Ctor) return 'unsupported';
    probe = new Ctor();
  }

  clearInterval(unlockTimer);
  unlockAttempts = attempts;

  const nudge = async () => {
    if (probe.state === 'running') {
      clearInterval(unlockTimer);
      unlockTimer = null;
      return true;
    }
    if (unlockAttempts-- <= 0) {
      clearInterval(unlockTimer);
      unlockTimer = null;
      return false;
    }
    try {
      await probe.resume();
    } catch {}
    return probe.state === 'running';
  };

  const onGesture = () => nudge();
  window.addEventListener('pointerdown', onGesture, { passive: true });
  window.addEventListener('keydown', onGesture);

  if (await nudge()) return probe.state;

  unlockTimer = setInterval(() => {
    if (nudge()) {
      window.removeEventListener('pointerdown', onGesture);
      window.removeEventListener('keydown', onGesture);
    }
  }, intervalMs);

  return probe.state;
}

export function reportState(extra = {}) {
  const body = JSON.stringify({ page: location.pathname, audio: audioState(), ...extra });
  if (navigator.sendBeacon) navigator.sendBeacon('/api/overlay-state', body);
  else fetch('/api/overlay-state', { method: 'POST', body }).catch(() => {});
}
