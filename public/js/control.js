const $ = (id) => document.getElementById(id);

let config = null;

const good = (t) => `<span class="good">${t}</span>`;
const bad = (t) => `<span class="bad">${t}</span>`;
const warn = (t) => `<span class="warn">${t}</span>`;

async function poll() {
  try {
    const s = await (await fetch('/api/status')).json();
    config = s.config;
    renderStatus(s);
  } catch (err) {
    $('sOverlays').innerHTML = bad('server unreachable');
  }
}

function renderStatus(s) {
  $('sOverlays').innerHTML = s.overlays
    ? good(`${s.overlays} connected`)
    : warn('none &mdash; add the browser source in OBS');

  const audio = s.overlayStates?.[0]?.audio ?? 'not reporting yet';
  $('sAudio').innerHTML =
    audio === 'running'
      ? good('running')
      : audio === 'skipped'
        ? warn('overlay has no ?channel= set')
        : bad(`${audio} &mdash; no sound will play`);

  $('sQueue').textContent = s.queue.playing
    ? `speaking, ${s.queue.pending} waiting`
    : s.queue.pending
      ? `${s.queue.pending} waiting`
      : 'idle';
}

$('cSay').onclick = async () => {
  const note = $('sayNote');
  const villager = $('cVillager').value;
  const text = $('cMessage').value;
  const btn = $('cSay');
  btn.disabled = true;
  try {
    const res = await fetch('/api/say', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        user: 'control',
        text,
        villagerName: villager || null,
        flags: { broadcaster: true },
      }),
    });
    const body = await res.json();
    if (body.ok) {
      note.innerHTML = good(`queued: ${body.job.villager.name} says "${body.job.message}"`);
    } else if (body.reason === 'cooldown') {
      note.innerHTML = bad(`cooldown, ${Math.ceil(body.retryAfterMs / 1000)}s to go`);
    } else if (body.reason === 'no-portrait') {
      note.innerHTML = bad(`${villager} has no portrait, so it was skipped`);
    } else {
      note.innerHTML = bad(`failed: ${body.reason ?? res.status}`);
    }
  } catch (err) {
    note.innerHTML = bad(err.message);
  } finally {
    btn.disabled = false;
  }
};

async function loadVillagers() {
  const sel = $('cVillager');
  const v = await (await fetch('/api/villagers?full=1')).json();
  const previous = sel.value;

  sel.innerHTML =
    '<option value="">Random</option>' +
    v.villagers
      .map((x) => {
        const playable = !config?.requirePortrait || x.isPortrait;
        return `<option value="${x.name}"${playable ? '' : ' disabled'}>${x.name} &mdash; ${x.personality}${playable ? '' : ' (no portrait)'}</option>`;
      })
      .join('');

  if (previous && sel.querySelector(`option[value="${CSS.escape(previous)}"]:not(:disabled)`)) {
    sel.value = previous;
  }
}

const num = (el) => {
  if (el.value.trim() === '') return null;
  const n = Number(el.value);
  return Number.isFinite(n) ? n : null;
};

const clampInt = (n, lo, hi) => Math.min(hi, Math.max(lo, Math.round(n)));

function renderConfig() {
  $('cPrefix').textContent = `!${config.command.prefix}`;
  $('cCooldown').textContent = `${config.command.userCooldownMs / 1000}s`;
  $('cMaxLen').textContent = `${config.command.maxLength} chars`;

  for (const box of document.querySelectorAll('[data-perm]')) {
    box.checked = Boolean(config.permissions[box.dataset.perm]);
  }
  $('vCooldown').value = Math.round(config.command.userCooldownMs / 1000);
  $('vMaxLen').value = config.command.maxLength;
}

$('save').onclick = async () => {
  const note = $('saveNote');
  const permissions = {};
  for (const box of document.querySelectorAll('[data-perm]')) {
    permissions[box.dataset.perm] = box.checked;
  }

  const patch = {
    permissions,
    command: {
      userCooldownMs: (num($('vCooldown')) ?? 30) * 1000,
      maxLength: clampInt(num($('vMaxLen')) ?? config.command.maxLength, 1, 500),
    },
  };

  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const body = await res.json();
    config = body.config ?? config;
    renderConfig();
    const rejected = body.rejected ?? [];
    note.innerHTML = rejected.length
      ? warn(`saved, but ignored unknown setting(s): ${rejected.join(', ')}`)
      : good('saved. running overlays pick this up without a reload.');
  } catch (err) {
    note.innerHTML = bad(err.message);
  }
};

await poll();
await loadVillagers();
if (config) renderConfig();
setInterval(poll, 2000);
