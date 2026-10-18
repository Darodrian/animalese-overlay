import test from 'node:test';
import assert from 'node:assert/strict';

import {
  sanitiseText,
  isAllowed,
  parseCommand,
  holdMsFor,
  createQueue,
} from '../js/commands.js';

const VILLAGERS = [
  { name: 'Ace', nameLower: 'ace', phrase: 'pttt', quote: 'qq', isPortrait: false },
  { name: 'Celeste', nameLower: 'celeste', phrase: 'frfr', quote: '', isPortrait: true },
  { name: 'Bob', nameLower: 'bob', phrase: ' nya', quote: '', isPortrait: true },
];

const CONFIG = {
  maxLength: 120,
  requirePortrait: true,
  permissions: { everyone: true, broadcaster: true, mod: true, vip: true, subscriber: true },
};

test('sanitiseText strips urls, mentions and emoji, and respects maxLength', () => {
  const out = sanitiseText('hi @someone https://x.y/z 😀 end', 120);
  assert.equal(out, 'hi end');
  assert.equal(sanitiseText('a'.repeat(200), 10).length, 10);
});

test('isAllowed follows the permissions matrix', () => {
  const everyone = { everyone: true };
  assert.equal(isAllowed({}, everyone), true);

  const modsOnly = { everyone: false, mod: true, broadcaster: true };
  assert.equal(isAllowed({ mod: true }, modsOnly), true);
  assert.equal(isAllowed({ broadcaster: true }, modsOnly), true);
  assert.equal(isAllowed({ subscriber: true }, modsOnly), false);
  assert.equal(isAllowed({}, modsOnly), false);
});

test('parseCommand picks a named villager and keeps the rest as message', () => {
  const parsed = parseCommand('Celeste hello there', VILLAGERS, CONFIG);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.job.villager.name, 'Celeste');
  assert.equal(parsed.job.message, 'hello there');
});

test('parseCommand falls back to a portrait-eligible random villager', () => {
  for (let i = 0; i < 30; i += 1) {
    const parsed = parseCommand('hello', VILLAGERS, CONFIG);
    assert.equal(parsed.ok, true);
    assert.notEqual(parsed.job.villager.name, 'Ace');
  }
});

test('parseCommand rejects a named villager without portrait when required', () => {
  const parsed = parseCommand('Ace hello', VILLAGERS, CONFIG);
  assert.deepEqual(parsed, { ok: false, reason: 'no-portrait' });
});

test('parseCommand allows a named no-portrait villager when not required', () => {
  const parsed = parseCommand('Ace hello', VILLAGERS, { ...CONFIG, requirePortrait: false });
  assert.equal(parsed.ok, true);
  assert.equal(parsed.job.villager.name, 'Ace');
});

test('parseCommand with empty text uses the catchphrase', () => {
  const single = [{ name: 'Celeste', nameLower: 'celeste', phrase: 'frfr', quote: '', isPortrait: true }];
  const parsed = parseCommand('', single, CONFIG);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.job.message, 'frfr');
});

test('parseCommand honours the exclude list', () => {
  for (let i = 0; i < 30; i += 1) {
    const parsed = parseCommand('hello', VILLAGERS, CONFIG, { exclude: 'Celeste' });
    assert.equal(parsed.job.villager.name, 'Bob');
  }
});

test('holdMsFor stays within bounds', () => {
  assert.equal(holdMsFor(''), 1800);
  assert.equal(holdMsFor('x'.repeat(500)), 9000);
  assert.ok(holdMsFor('hello world') > 1800);
});

test('queue paces jobs in order through onJob', async () => {
  const seen = [];
  const queue = createQueue({ minGapMs: 0, onJob: (job) => seen.push(job.user) });
  queue.enqueue({ user: 'a', holdMs: 0 });
  queue.enqueue({ user: 'b', holdMs: 0 });
  await new Promise((r) => setTimeout(r, 40));
  assert.deepEqual(seen, ['a', 'b']);
});

test('cooldowns are tracked per user', () => {
  const queue = createQueue({ minGapMs: 1000 });
  assert.equal(queue.cooldownRemaining('alice'), 0);
  queue.markUsed('alice', 30_000);
  assert.ok(queue.cooldownRemaining('alice') > 0);
  assert.equal(queue.cooldownRemaining('bob'), 0);
});

test('setMinGap changes pacing for jobs not yet started', async () => {
  const queue = createQueue({ minGapMs: 5_000 });
  queue.enqueue({ user: 'a', holdMs: 0 });
  await new Promise((r) => setTimeout(r, 10));
  queue.setMinGap(0);
  queue.enqueue({ user: 'b', holdMs: 0 });
  const t0 = Date.now();
  while (queue.snapshot().pending > 0 && Date.now() - t0 < 500) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(queue.snapshot().pending, 0);
  assert.ok(Date.now() - t0 < 1000, 'second job should not wait the original 5s gap');
  queue.stop();
});

test('snapshot reports playing and pending', async () => {
  const queue = createQueue({ minGapMs: 200 });
  queue.enqueue({ user: 'a', holdMs: 100 });
  const snap = queue.snapshot();
  assert.equal(snap.playing, true);
  assert.equal(snap.pending, 0);
  assert.equal(snap.items[0].user, 'a');
  queue.stop();
});
