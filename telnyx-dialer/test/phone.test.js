import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkDestination, normalizeNumber, parsePrefixList } from '../lib/phone.js';

test('normalizes common input formats to E.164', () => {
  assert.equal(normalizeNumber('(555) 123-4567'), '+15551234567');
  assert.equal(normalizeNumber('1 555 123 4567'), '+15551234567');
  assert.equal(normalizeNumber('+44 20 7946 0958'), '+442079460958');
  assert.equal(normalizeNumber('0044 20 7946 0958'), '+442079460958');
  assert.equal(normalizeNumber('020 7946 0958', '44'), '+442079460958');
});

test('rejects things that are not phone numbers', () => {
  assert.equal(normalizeNumber(''), null);
  assert.equal(normalizeNumber('911'), null);
  assert.equal(normalizeNumber('+1234567890123456'), null);
  assert.equal(normalizeNumber(undefined), null);
});

test('applies allowed and blocked prefixes', () => {
  const policy = { allowed: parsePrefixList('+1'), blocked: parsePrefixList('1900, +1976') };
  assert.deepEqual(checkDestination('+15551234567', policy), { ok: true });
  assert.equal(checkDestination('+19005551234', policy).ok, false);
  assert.equal(checkDestination('+442079460958', policy).ok, false);
  assert.equal(checkDestination(null, policy).ok, false);
  assert.equal(checkDestination('+442079460958', { allowed: [], blocked: [] }).ok, true);
});
