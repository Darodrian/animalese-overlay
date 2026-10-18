import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildRoster,
  loadRoster,
  findVillager,
  randomVillager,
  playableVillagers,
  ROSTER_STORE,
} from '../js/roster.js';

const CARGO_OK = {
  cargoquery: [
    { title: { name: 'Ace', image: 'Ace amiibo.png', phrase: 'pttt', quote: 'qq', personality: 'Lazy', species: 'Cub', gender: 'Male', nh: '1' } },
    { title: { name: 'Bob', image: 'Bob PC.png', phrase: '', quote: '', personality: 'Lazy', species: 'Cat', gender: 'Male', nh: '0' } },
    { title: { name: 'Celeste', image: 'Celeste.png', phrase: 'frfr', quote: '', personality: 'Normal', species: 'Owl', gender: 'Female', nh: '1' } },
  ],
};

const IMAGEINFO_OK = {
  query: {
    pages: {
      1: { title: 'File:Ace amiibo.png', imageinfo: [{ url: 'https://dodo.ac/np/images/ace.png' }] },
      2: { title: 'File:Celeste.png', imageinfo: [{ url: 'https://dodo.ac/np/images/celeste.png' }] },
    },
  },
};

function makeFetch({ cargo = CARGO_OK, imageinfo = IMAGEINFO_OK, urls = [] } = {}) {
  return async (url) => {
    urls.push(url);
    const payload = url.includes('cargoquery') ? cargo : imageinfo;
    return { ok: true, json: async () => payload };
  };
}

function stubStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    raw: map,
  };
}

test('buildRoster filters New Horizons, resolves portraits, and always sends origin=*', async () => {
  const urls = [];
  const roster = await buildRoster({ fetchImpl: makeFetch({ urls }), delayMs: 0 });

  assert.equal(roster.villagers.length, 2);
  assert.deepEqual(roster.villagers.map((v) => v.name), ['Ace', 'Celeste']);

  const ace = roster.villagers[0];
  assert.equal(ace.isPortrait, false);
  assert.equal(ace.imageUrl, 'https://dodo.ac/np/images/ace.png');
  assert.equal(ace.gender, 'male');
  assert.equal(ace.nameLower, 'ace');

  const celeste = roster.villagers[1];
  assert.equal(celeste.isPortrait, true);

  assert.ok(urls.length >= 2);
  for (const url of urls) assert.ok(url.includes('origin=*'), `missing origin=* in ${url}`);
});

test('buildRoster drops villagers whose image does not resolve', async () => {
  const partial = {
    query: {
      pages: { 1: { title: 'File:Ace amiibo.png', imageinfo: [{ url: 'https://dodo.ac/np/images/ace.png' }] } },
    },
  };
  const roster = await buildRoster({ fetchImpl: makeFetch({ imageinfo: partial }), delayMs: 0 });
  assert.deepEqual(roster.villagers.map((v) => v.name), ['Ace']);
});

test('loadRoster serves a fresh cache without touching the network', async () => {
  const cache = {
    generated: new Date().toISOString(),
    counts: {},
    villagers: [{ name: 'Cached', nameLower: 'cached', isPortrait: true }],
  };
  const storage = stubStorage({ [ROSTER_STORE]: JSON.stringify(cache) });
  const urls = [];
  const result = await loadRoster({ storage, fetchImpl: makeFetch({ urls }), delayMs: 0 });

  assert.equal(result.stale, false);
  assert.equal(result.villagers[0].name, 'Cached');
  assert.equal(urls.length, 0);
});

test('loadRoster returns stale data immediately and revalidates in the background', async () => {
  const old = {
    generated: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    counts: {},
    villagers: [{ name: 'Oldster', nameLower: 'oldster', isPortrait: true }],
  };
  const storage = stubStorage({ [ROSTER_STORE]: JSON.stringify(old) });
  const result = await loadRoster({ storage, fetchImpl: makeFetch(), delayMs: 0 });

  assert.equal(result.stale, true);
  assert.equal(result.villagers[0].name, 'Oldster');

  await new Promise((r) => setTimeout(r, 50));
  const saved = JSON.parse(storage.raw.get(ROSTER_STORE));
  assert.equal(saved.villagers[0].name, 'Ace');
});

test('loadRoster with an expired cache and a failing fetch keeps serving stale', async () => {
  const old = {
    generated: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString(),
    counts: {},
    villagers: [{ name: 'Oldster', nameLower: 'oldster', isPortrait: true }],
  };
  const storage = stubStorage({ [ROSTER_STORE]: JSON.stringify(old) });
  const failing = async () => {
    throw new Error('offline');
  };
  const result = await loadRoster({ storage, fetchImpl: failing, delayMs: 0 });
  assert.equal(result.stale, true);
  assert.equal(result.villagers[0].name, 'Oldster');
  await new Promise((r) => setTimeout(r, 20));
});

test('loadRoster with no cache and a failing fetch rejects', async () => {
  const failing = async () => {
    throw new Error('offline');
  };
  await assert.rejects(() => loadRoster({ storage: stubStorage(), fetchImpl: failing, delayMs: 0 }), /offline/);
});

test('loadRoster fails soft when storage throws', async () => {
  const throwing = {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
  const result = await loadRoster({ storage: throwing, fetchImpl: makeFetch(), delayMs: 0 });
  assert.equal(result.stale, false);
  assert.equal(result.villagers[0].name, 'Ace');
});

const V = [
  { name: 'Ace', nameLower: 'ace', isPortrait: false, phrase: 'a' },
  { name: 'Celeste', nameLower: 'celeste', isPortrait: true, phrase: 'c' },
  { name: 'Bob', nameLower: 'bob', isPortrait: true, phrase: 'b' },
];

test('findVillager matches case-insensitively and exactly', () => {
  assert.equal(findVillager(V, '  CELESTE '), V[1]);
  assert.equal(findVillager(V, 'celes'), null);
  assert.equal(findVillager(V, ''), null);
});

test('randomVillager respects requirePortrait and exclude', () => {
  for (let i = 0; i < 20; i += 1) {
    const picked = randomVillager(V, { requirePortrait: true });
    assert.notEqual(picked.name, 'Ace');
  }
  for (let i = 0; i < 20; i += 1) {
    const picked = randomVillager(V, { requirePortrait: true, exclude: 'Celeste' });
    assert.equal(picked.name, 'Bob');
  }
});

test('playableVillagers filters by portrait when required', () => {
  assert.equal(playableVillagers(V, true).length, 2);
  assert.equal(playableVillagers(V, false).length, 3);
});
