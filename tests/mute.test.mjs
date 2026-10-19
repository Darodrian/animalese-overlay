import test from 'node:test';
import assert from 'node:assert/strict';

import { setMuted, isMuted } from '../js/mute.js';

test('mute starts unmuted', () => {
  assert.equal(isMuted(), false);
});

test('setMuted(true) mutes and setMuted(false) unmutes', () => {
  setMuted(true);
  assert.equal(isMuted(), true);
  setMuted(false);
  assert.equal(isMuted(), false);
});

test('setMuted coerces non-true values to unmuted', () => {
  setMuted(true);
  setMuted(0);
  assert.equal(isMuted(), false);
  setMuted('');
  assert.equal(isMuted(), false);
});
