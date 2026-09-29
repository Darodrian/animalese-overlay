import fs from 'node:fs/promises';
import { DATA_DIR, VILLAGERS_CACHE } from './paths.js';

const WIKI = 'https://nookipedia.com/w/api.php';
const UA = 'animalese-overlay/1.0 (self-hosted streaming overlay)';

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 250;

const CARGO_FIELDS = 'name,image,phrase,quote,personality,species,gender,nh';

async function apiGet(params) {
  const url = `${WIKI}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`Nookipedia HTTP ${res.status} for ${params.action}`);
  return res.json();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchSeriesVillagers() {
  const data = await apiGet({
    action: 'cargoquery',
    format: 'json',
    limit: '500',
    tables: 'villager',
    fields: CARGO_FIELDS,
  });
  if (!Array.isArray(data.cargoquery)) throw new Error('Unexpected cargoquery response');
  return data.cargoquery.map((row) => row.title);
}

export function filterNewHorizons(series) {
  return series.filter((v) => v.nh === '1' && v.name && v.image);
}

export async function resolvePortraits(villagers) {
  const titles = villagers.map((v) => `File:${v.image}`);
  const resolved = new Map();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const data = await apiGet({
      action: 'query',
      format: 'json',
      prop: 'imageinfo',
      iiprop: 'url',
      titles: chunk.join('|'),
    });

    const pages = data?.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const info = page?.imageinfo?.[0];
      if (!info) continue;
      resolved.set(titleKey(page.title), info.url);
    }

    if (i + BATCH_SIZE < titles.length) await sleep(BATCH_DELAY_MS);
  }

  const kept = [];
  const missing = [];
  for (const v of villagers) {
    const imageUrl = resolved.get(titleKey(`File:${v.image}`));
    if (imageUrl) kept.push({ ...v, imageUrl });
    else missing.push(v.name);
  }
  return { villagers: kept, missing };
}

function titleKey(title) {
  return title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

const NON_PORTRAIT = /amiibo| PC\.png$|icon/i;

function normaliseGender(raw) {
  const g = String(raw ?? '').trim().toLowerCase();
  return g === 'male' || g === 'female' ? g : '';
}

function normalise(v) {
  return {
    name: v.name,
    nameLower: v.name.toLowerCase(),
    phrase: v.phrase || '',
    quote: v.quote || '',
    personality: v.personality || '',
    species: v.species || '',
    gender: normaliseGender(v.gender),
    image: v.image,
    imageUrl: v.imageUrl,
    isPortrait: !NON_PORTRAIT.test(v.image),
  };
}

export async function buildVillagerCache() {
  const series = await fetchSeriesVillagers();
  const newHorizons = filterNewHorizons(series);
  const { villagers, missing } = await resolvePortraits(newHorizons);

  const normalised = villagers.map(normalise).sort((a, b) => a.name.localeCompare(b.name));

  return {
    generated: new Date().toISOString(),
    source: 'nookipedia cargo + imageinfo',
    counts: {
      series: series.length,
      newHorizons: newHorizons.length,
      resolved: normalised.length,
      unresolvedImages: missing.length,
      portraits: normalised.filter((v) => v.isPortrait).length,
    },
    villagers: normalised,
  };
}

async function readCache() {
  try {
    return JSON.parse(await fs.readFile(VILLAGERS_CACHE, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(cache) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(VILLAGERS_CACHE, JSON.stringify(cache, null, 2));
}

export async function loadVillagers({ maxAgeMs = CACHE_TTL_MS, force = false } = {}) {
  const cached = await readCache();
  const age = cached?.generated ? Date.now() - Date.parse(cached.generated) : Infinity;
  const fresh = cached?.villagers?.length && age < maxAgeMs;

  if (!force && fresh) return { ...cached, stale: false };

  try {
    const built = await buildVillagerCache();
    await writeCache(built);
    return { ...built, stale: false };
  } catch (err) {
    if (cached?.villagers?.length) {
      console.warn(`[nookipedia] refresh failed (${err.message}); serving cache from ${cached.generated}`);
      return { ...cached, stale: true };
    }
    throw err;
  }
}

export function findVillager(villagers, query) {
  if (!query) return null;
  const q = query.trim().toLowerCase();
  return villagers.find((v) => v.nameLower === q) ?? null;
}

export function playableVillagers(villagers, requirePortrait) {
  if (!requirePortrait) return villagers;
  return villagers.filter((v) => v.isPortrait);
}

export function randomVillager(villagers, { requirePortrait = false, exclude = null } = {}) {
  let pool = playableVillagers(villagers, requirePortrait);
  if (!pool.length) return null;

  if (exclude) {
    const key = String(exclude).toLowerCase();
    const trimmed = pool.filter((v) => v.nameLower !== key);
    if (trimmed.length) pool = trimmed;
  }

  return pool[Math.floor(Math.random() * pool.length)];
}
