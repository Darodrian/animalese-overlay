import fs from 'node:fs/promises';
import { DATA_DIR, CONFIG_FILE } from './paths.js';

export const DEFAULTS = {
  placeholderChannel: 'yourusername',

  command: {
    prefix: 'ac',
    maxLength: 120,
    userCooldownMs: 30_000,
    minGapMs: 1_200,
  },

  permissions: {
    broadcaster: true,
    mod: true,
    vip: true,
    subscriber: true,
  },

  requirePortrait: true,
};

let cache = null;

function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, override, rejected = [], prefix = '') {
  if (!isPlainObject(override)) return base;

  const out = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (!(key in base)) {
      rejected.push(prefix + key);
      continue;
    }
    out[key] = isPlainObject(value) ? deepMerge(base[key], value, rejected, `${prefix}${key}.`) : value;
  }
  return out;
}

export async function loadConfig() {
  if (cache) return cache;
  let stored = null;
  try {
    stored = JSON.parse(await fs.readFile(CONFIG_FILE, 'utf8'));
  } catch {}
  cache = deepMerge(DEFAULTS, stored);
  return cache;
}

export async function saveConfig(patch) {
  const current = await loadConfig();
  const rejected = [];
  const merged = deepMerge(current, patch, rejected);
  cache = merged;
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(CONFIG_FILE, `${JSON.stringify(cache, null, 2)}\n`);
  return { config: cache, rejected };
}

export function getConfigSync() {
  return cache ?? DEFAULTS;
}
