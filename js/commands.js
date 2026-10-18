import { findVillager, randomVillager } from './roster.js';

const URL_RE = /\bhttps?:\/\/\S+/gi;
const MENTION_RE = /@\w+/g;
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu;

export function sanitiseText(raw, maxLength) {
  return String(raw ?? '')
    .replace(URL_RE, ' ')
    .replace(MENTION_RE, ' ')
    .replace(EMOJI_RE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

export function isAllowed(flags = {}, permissions = {}) {
  return Boolean(
    permissions.everyone ||
      (flags.broadcaster && permissions.broadcaster) ||
      (flags.mod && permissions.mod) ||
      (flags.vip && permissions.vip) ||
      (flags.subscriber && permissions.subscriber),
  );
}

export function parseCommand(rawText, villagers, config, { exclude = null } = {}) {
  const maxLength = config.maxLength;
  const requirePortrait = Boolean(config.requirePortrait);
  const text = sanitiseText(rawText, maxLength);

  const [first, ...rest] = text ? text.split(' ') : [];
  const named = first ? findVillager(villagers, first) : null;

  if (named && requirePortrait && !named.isPortrait) {
    return { ok: false, reason: 'no-portrait' };
  }

  const villager = named ?? randomVillager(villagers, { requirePortrait, exclude });
  if (!villager) return { ok: false, reason: 'no-villagers' };

  let message = named ? rest.join(' ').trim() : text;
  if (!message) message = villager.phrase || villager.quote || villager.name;

  return {
    ok: true,
    job: {
      villager: {
        name: villager.name,
        phrase: villager.phrase,
        personality: villager.personality,
        species: villager.species,
        gender: villager.gender,
        imageUrl: villager.imageUrl,
        isPortrait: villager.isPortrait,
      },
      message: sanitiseText(message, maxLength) || villager.name,
    },
  };
}

export function holdMsFor(message) {
  return Math.min(9000, Math.max(1800, 1500 + message.length * 85));
}

export function createQueue({ minGapMs = 0, onJob, onIdle } = {}) {
  const pending = [];
  const cooldowns = new Map();
  let gapMs = minGapMs;
  let draining = false;
  let timer = null;
  let timerDelay = 0;
  let timerSetAt = 0;
  let current = null;

  function finishCurrent() {
    draining = false;
    current = null;
    timer = null;
    pump();
  }

  function pump() {
    if (draining) return;
    const next = pending.shift();
    if (!next) {
      onIdle?.(pending.length);
      return;
    }
    draining = true;
    current = next;
    onIdle?.(pending.length);
    onJob?.(next);
    timerDelay = Math.max(next.holdMs ?? 0, gapMs);
    timerSetAt = Date.now();
    timer = setTimeout(finishCurrent, timerDelay);
  }

  return {
    enqueue(job) {
      pending.push(job);
      onIdle?.(pending.length);
      pump();
      return pending.length;
    },
    pendingCount: () => pending.length,
    cooldownRemaining(user) {
      const last = cooldowns.get(String(user).toLowerCase());
      return last ? Math.max(0, last - Date.now()) : 0;
    },
    markUsed(user, windowMs) {
      cooldowns.set(String(user).toLowerCase(), Date.now() + windowMs);
    },
    setMinGap(ms) {
      gapMs = ms;
      // acorta el timer en vuelo si el nuevo hueco ya permite arrancar
      if (draining && timer !== null) {
        const elapsed = Date.now() - timerSetAt;
        const remainingHold = Math.max(0, (current?.holdMs ?? 0) - elapsed);
        const delay = Math.max(remainingHold, ms);
        if (delay < timerDelay - elapsed) {
          clearTimeout(timer);
          timerDelay = delay;
          timerSetAt = Date.now();
          timer = setTimeout(finishCurrent, delay);
        }
      }
    },
    snapshot() {
      const shape = (j) => ({ user: j.user, villager: j.villager?.name, message: j.message });
      return {
        playing: draining,
        pending: pending.length,
        items: [...(current ? [shape(current)] : []), ...pending.map(shape)],
      };
    },
    stop() {
      if (timer) clearTimeout(timer);
      timer = null;
      draining = false;
      current = null;
      pending.length = 0;
    },
  };
}
