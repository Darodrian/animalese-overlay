import test from 'node:test';
import assert from 'node:assert/strict';

import {
  generateKey,
  validateKey,
  normChannel,
  savedChannel,
  saveChannel,
  savedKey,
  saveKey,
  hasKey,
  overlayParams,
  adoptHashParams,
  overlayUrl,
} from '../js/keys.js';

function stubStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

function throwingStorage() {
  return {
    getItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  };
}

test('generateKey returns 24 chars from the confusion-free alphabet', () => {
  const key = generateKey(24);
  assert.match(key, /^[23456789abcdefghjkmnpqrstuvwxyz]{24}$/);
});

test('generateKey produces different keys across calls', () => {
  assert.notEqual(generateKey(), generateKey());
});

test('validateKey accepts generated keys and rejects bad ones', () => {
  assert.equal(validateKey(generateKey()), true);
  assert.equal(validateKey('a'.repeat(23)), false);
  assert.equal(validateKey('0'.repeat(24)), false);
  assert.equal(validateKey('1'.repeat(24)), false);
  assert.equal(validateKey('l'.repeat(24)), false);
  assert.equal(validateKey('o'.repeat(24)), false);
  assert.equal(validateKey('A'.repeat(24)), false);
  assert.equal(validateKey(''), false);
});

test('normChannel trims and lowercases', () => {
  assert.equal(normChannel('  FooBAR '), 'foobar');
});

test('saveKey and savedKey round-trip per channel', () => {
  const s = stubStorage();
  saveKey('foo', 'k1', s);
  assert.equal(savedKey('foo', s), 'k1');
  assert.equal(hasKey('foo', s), true);
  assert.equal(savedKey('bar', s), '');
  assert.equal(hasKey('bar', s), false);
});

test('saveChannel and savedChannel round-trip', () => {
  const s = stubStorage();
  saveChannel('  MyChan ', s);
  assert.equal(savedChannel(s), 'mychan');
});

test('storage that throws never escapes the helpers', () => {
  const s = throwingStorage();
  assert.doesNotThrow(() => saveKey('foo', 'k', s));
  assert.doesNotThrow(() => saveChannel('foo', s));
  assert.equal(savedKey('foo', s), '');
  assert.equal(savedChannel(s), '');
  assert.equal(hasKey('foo', s), false);
});

test('overlayParams parses the URL fragment', () => {
  assert.deepEqual(overlayParams('#c=MyChan&k=abc'), { channel: 'mychan', key: 'abc' });
  assert.deepEqual(overlayParams(''), { channel: '', key: '' });
});

test('adoptHashParams saves channel and key only when both are present', () => {
  const s = stubStorage();
  assert.equal(adoptHashParams('#c=a&k=b', s), true);
  assert.equal(savedChannel(s), 'a');
  assert.equal(savedKey('a', s), 'b');

  const s2 = stubStorage();
  assert.equal(adoptHashParams('#c=onlychannel', s2), false);
  assert.equal(savedChannel(s2), '');
});

test('overlayUrl ends with overlay.html and the hash pair', () => {
  assert.equal(overlayUrl('foo', 'k'), 'overlay.html#c=foo&k=k');
});
