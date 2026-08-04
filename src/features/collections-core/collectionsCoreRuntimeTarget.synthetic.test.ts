import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCollectionsCoreRuntimeTarget } from './collectionsCoreRuntimeTarget';

test('autorise explicitement localhost, 127.0.0.1 et IPv6 loopback', () => {
  for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    assert.deepEqual(validateCollectionsCoreRuntimeTarget({ enabled: 'true', supabaseUrl: url }), { allowed: true });
  }
});

test('refuse local si le drapeau explicite manque', () => {
  assert.equal(validateCollectionsCoreRuntimeTarget({ supabaseUrl: 'http://localhost:54321' }).allowed, false);
});

test('refuse staging et production même avec le drapeau local', () => {
  for (const host of ['gbbsqcscryygqlmqncyv.supabase.co', 'leakcdbbawzysfqyqsnr.supabase.co']) {
    assert.equal(validateCollectionsCoreRuntimeTarget({ enabled: 'true', supabaseUrl: `https://${host}` }).allowed, false);
  }
});

test('refuse les hôtes ressemblant à localhost', () => {
  assert.equal(validateCollectionsCoreRuntimeTarget({ enabled: 'true', supabaseUrl: 'https://localhost.evil.test' }).allowed, false);
});

test('refuse les autres adresses IPv6', () => {
  assert.equal(validateCollectionsCoreRuntimeTarget({ enabled: 'true', supabaseUrl: 'http://[::2]:54321' }).allowed, false);
});
