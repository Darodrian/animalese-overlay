const WIKI = 'https://nookipedia.com/w/api.php';

export const ROSTER_STORE = 'ac_roster_v1';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 50;
const BATCH_DELAY_MS = 250;

const CARGO_FIELDS = 'name,image,phrase,quote,personality,species,gender,nh';

const NON_PORTRAIT = /amiibo| PC\.png$|icon/i;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiGet(params, fetchImpl) {
  // MediaWiki solo emite cabeceras CORS cuando la peticion lleva origin=*;
  // las peticiones preflight no estan habilitadas, asi que GET simple y sin cabeceras.
  const url = `${WIKI}?${new URLSearchParams({ ...params, origin: '*' })}`;
  const res = await fetchImpl(url);
  if (!res.ok) throw new Error(`Nookipedia HTTP ${res.status} for ${params.action}`);
  return res.json();
}

function titleKey(title) {
  return title.replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

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

export async function buildRoster({ fetchImpl = fetch, delayMs = BATCH_DELAY_MS } = {}) {
  const data = await apiGet(
    { action: 'cargoquery', format: 'json', limit: '500', tables: 'villager', fields: CARGO_FIELDS },
    fetchImpl,
  );
  if (!Array.isArray(data.cargoquery)) throw new Error('Unexpected cargoquery response');
  const series = data.cargoquery.map((row) => row.title);
  const newHorizons = series.filter((v) => v.nh === '1' && v.name && v.image);

  const titles = newHorizons.map((v) => `File:${v.image}`);
  const resolved = new Map();

  for (let i = 0; i < titles.length; i += BATCH_SIZE) {
    const chunk = titles.slice(i, i + BATCH_SIZE);
    const q = await apiGet(
      {
        action: 'query',
        format: 'json',
        prop: 'imageinfo',
        iiprop: 'url',
        titles: chunk.join('|'),
      },
      fetchImpl,
    );

    const pages = q?.query?.pages ?? {};
    for (const page of Object.values(pages)) {
      const info = page?.imageinfo?.[0];
      if (info) resolved.set(titleKey(page.title), info.url);
    }

    if (i + BATCH_SIZE < titles.length && delayMs > 0) await sleep(delayMs);
  }

  const villagers = [];
  for (const v of newHorizons) {
    const imageUrl = resolved.get(titleKey(`File:${v.image}`));
    if (imageUrl) villagers.push(normalise({ ...v, imageUrl }));
  }
  villagers.sort((a, b) => a.name.localeCompare(b.name));

  return {
    generated: new Date().toISOString(),
    source: 'nookipedia cargo + imageinfo',
    counts: {
      series: series.length,
      newHorizons: newHorizons.length,
      resolved: villagers.length,
      portraits: villagers.filter((v) => v.isPortrait).length,
    },
    villagers,
  };
}

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    return s && typeof s.getItem === 'function' ? s : null;
  } catch {
    return null;
  }
}

function readCache(storage) {
  try {
    const s = storage ?? safeStorage();
    if (!s) return null;
    return JSON.parse(s.getItem(ROSTER_STORE) || 'null');
  } catch {
    return null;
  }
}

function writeCache(storage, cache) {
  try {
    const s = storage ?? safeStorage();
    if (s) s.setItem(ROSTER_STORE, JSON.stringify(cache));
  } catch {
    // modo privado
  }
}

export async function loadRoster({ force = false, storage, fetchImpl, delayMs } = {}) {
  const cached = readCache(storage);
  const age = cached?.generated ? Date.now() - Date.parse(cached.generated) : Infinity;
  const hasCache = Boolean(cached?.villagers?.length);
  const fresh = hasCache && age < CACHE_TTL_MS;

  if (!force && fresh) return { ...cached, stale: false };

  const refresh = buildRoster({ fetchImpl, delayMs })
    .then((built) => {
      writeCache(storage, built);
      return built;
    })
    .catch((err) => {
      if (hasCache) return null;
      throw err;
    });

  if (hasCache) {
    // stale-while-revalidate: sirve la cache vieja ya y refresca en segundo plano
    refresh.catch(() => {});
    return { ...cached, stale: true };
  }

  const built = await refresh;
  return { ...built, stale: false };
}

export function findVillager(villagers, query) {
  if (!query) return null;
  const q = String(query).trim().toLowerCase();
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
