import path from 'node:path';
import express from 'express';

import { ROOT, PUBLIC_DIR } from './lib/paths.js';
import { loadConfig, saveConfig } from './lib/config.js';
import { loadVillagers, findVillager, randomVillager, playableVillagers } from './lib/nookipedia.js';
import { isAllowed, parseCommand, holdMsFor, sanitiseText, createQueue } from './lib/chat-command.js';

const PORT = Number(process.env.PORT ?? 8787);

const app = express();
app.use(express.json({ limit: '64kb' }));

let villagers = [];
let villagerMeta = { generated: null, counts: {}, stale: false };

async function ensureVillagers({ force = false } = {}) {
  const cache = await loadVillagers({ force });
  villagers = cache.villagers;
  villagerMeta = { generated: cache.generated, counts: cache.counts ?? {}, stale: !!cache.stale };
  return cache;
}

const clients = new Set();

function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(frame);
}

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  res.write(`event: hello\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  clients.add(res);

  const ping = setInterval(() => res.write(`: ping\n\n`), 20_000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
});

const queue = createQueue({
  minGapMs: (await loadConfig()).command.minGapMs,
  onJob: (job) => broadcast('job', job),
  onIdle: (pending) => broadcast('queue', { pending }),
});

app.get('/api/villagers', async (req, res) => {
  const config = await loadConfig();
  if (!villagers.length) await ensureVillagers();
  res.json({
    count: villagers.length,
    rosterCount: playableVillagers(villagers, config.requirePortrait).length,
    generated: villagerMeta.generated,
    stale: villagerMeta.stale,
    names: villagers.map((v) => v.nameLower),
    ...(req.query.full === '1' ? { villagers } : {}),
  });
});

app.get('/api/villager', async (req, res) => {
  const config = await loadConfig();
  const named = findVillager(villagers, req.query.name);
  if (named && config.requirePortrait && !named.isPortrait) {
    return res.status(404).json({ error: 'villager has no portrait', villager: named.name });
  }
  const v = named ?? randomVillager(villagers, { requirePortrait: config.requirePortrait });
  if (!v) return res.status(503).json({ error: 'village data not loaded yet' });
  res.json(v);
});

app.get('/api/status', async (req, res) => {
  if (!villagers.length) await ensureVillagers();
  const config = await loadConfig();
  res.json({
    ok: true,
    placeholderChannel: config.placeholderChannel,
    villagerCount: villagers.length,
    rosterCount: playableVillagers(villagers, config.requirePortrait).length,
    villagerGenerated: villagerMeta.generated,
    villagerStale: villagerMeta.stale,
    counts: villagerMeta.counts,
    queue: queue.snapshot(),
    overlays: clients.size,
    overlayStates: [...overlayStates.entries()].map(([page, state]) => ({ page, ...state })),
    config,
  });
});

app.post('/api/say', async (req, res) => {
  const config = await loadConfig();
  const {
    user = 'unknown',
    text = '',
    flags = {},
    villagerName = null,
    excludeVillager = null,
  } = req.body ?? {};

  if (!villagers.length) await ensureVillagers();

  if (!isAllowed(flags, config.permissions)) {
    return res.status(403).json({ ok: false, reason: 'not-allowed' });
  }

  const remaining = queue.cooldownRemaining(user);
  if (remaining > 0) {
    return res.status(429).json({ ok: false, reason: 'cooldown', retryAfterMs: remaining });
  }

  let parsed;
  if (villagerName) {
    const v = findVillager(villagers, villagerName);
    if (v) {
      if (config.requirePortrait && !v.isPortrait) {
        return res.json({ ok: false, reason: 'no-portrait' });
      }
      parsed = {
        ok: true,
        job: {
          villager: {
            name: v.name,
            phrase: v.phrase,
            personality: v.personality,
            species: v.species,
            gender: v.gender,
            imageUrl: v.imageUrl,
            isPortrait: v.isPortrait,
          },
          message: sanitiseText(text, config.command.maxLength) || v.phrase || v.name,
        },
      };
    } else if (config.requirePortrait) {
      return res.status(404).json({ ok: false, reason: 'unknown-villager' });
    }
  }

  parsed ??= parseCommand(text, villagers, config, { exclude: excludeVillager });

  if (!parsed.ok) {
    const status = parsed.reason === 'no-villagers' ? 503 : 200;
    return res.status(status).json({ ok: false, reason: parsed.reason });
  }

  const { villager, message } = parsed.job;
  const job = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    user,
    flags,
    villager,
    message,
    holdMs: holdMsFor(message),
    at: new Date().toISOString(),
  };

  queue.markUsed(user, config.command.userCooldownMs);
  const depth = queue.enqueue(job);
  res.json({ ok: true, job, depth });
});

const overlayStates = new Map();

app.post('/api/overlay-state', express.text({ type: '*/*', limit: '4kb' }), (req, res) => {
  let payload = {};
  try {
    payload = JSON.parse(req.body || '{}');
  } catch {}
  const id = payload.page || 'overlay';
  overlayStates.set(id, { ...payload, at: new Date().toISOString() });
  res.status(204).end();
});

app.get('/api/config', async (req, res) => res.json(await loadConfig()));

app.put('/api/config', async (req, res) => {
  try {
    const patch = req.body ?? {};
    const { config: saved, rejected } = await saveConfig(patch);
    res.json({ ok: true, config: saved, rejected });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

const VENDOR = {
  'animalese-tts.mjs': 'animalese-tts/dist/animalese.browser.mjs',
  'comfy.min.js': 'comfy.js/dist/comfy.min.js',
};
for (const [route, rel] of Object.entries(VENDOR)) {
  const abs = path.join(ROOT, 'node_modules', ...rel.split('/'));
  app.get(`/vendor/${route}`, (req, res) => res.sendFile(abs));
}

app.use(
  express.static(PUBLIC_DIR, {
    index: 'control.html',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.wav')) res.setHeader('content-type', 'audio/wav');
    },
  }),
);

app.get('/overlay', (req, res) => res.sendFile(path.join(PUBLIC_DIR, 'overlay.html')));

app.use((req, res) => res.status(404).json({ ok: false, error: 'not found', path: req.path }));

try {
  await ensureVillagers();
  console.log(
    `[villagers] ${villagers.length} loaded (${villagerMeta.counts.portraits ?? '?'} portraits, generated ${villagerMeta.generated})`,
  );
} catch (err) {
  console.error(`[villagers] FAILED to load: ${err.message}`);
  console.error('           run "npm run refresh" once network is available');
}

app.listen(PORT, () => {
  console.log(`[server]   http://localhost:${PORT}`);
  console.log(`[server]   overlay : http://localhost:${PORT}/overlay?channel=yourusername`);
  console.log(`[server]   control : http://localhost:${PORT}/`);
  if (!villagers.length) console.log('[server]   warning: no villagers loaded, /api/say will 503');
});
