import assert from 'node:assert/strict';
import test from 'node:test';
import { validateCollectionsRuntimeTarget } from './collectionsRuntimeTarget';

for (const url of ['http://127.0.0.1:54321', 'http://localhost:54321', 'http://[::1]:54321']) {
  test(`la cible locale explicitement activée autorise lecture et mutation: ${url}`, () => {
    assert.deepEqual(validateCollectionsRuntimeTarget({ supabaseUrl: url, localEnabled: 'true' }, 'read'), {
      allowed: true,
      target: 'local',
    });
    assert.equal(
      validateCollectionsRuntimeTarget({ supabaseUrl: url, localEnabled: 'TRUE' }, 'mutate').allowed,
      true,
    );
  });
}

test('staging et production restent fermés même avec le drapeau local', () => {
  for (const url of [
    'https://gbbsqcscryygqlmqncyv.supabase.co',
    'https://leakcdbbawzysfqyqsnr.supabase.co',
    'https://example.com',
  ]) {
    assert.equal(validateCollectionsRuntimeTarget({ supabaseUrl: url, localEnabled: 'true' }, 'read').allowed, false);
    assert.equal(validateCollectionsRuntimeTarget({ supabaseUrl: url, localEnabled: 'true' }, 'mutate').allowed, false);
  }
});

test('le drapeau absent ou faux ferme toute cible', () => {
  for (const localEnabled of [undefined, '', 'false']) {
    assert.equal(
      validateCollectionsRuntimeTarget(
        { supabaseUrl: 'http://127.0.0.1:54321', localEnabled },
        'read',
      ).allowed,
      false,
    );
  }
});

test('une URL absente ou invalide échoue fermée', () => {
  assert.equal(validateCollectionsRuntimeTarget({ localEnabled: 'true' }, 'read').allowed, false);
  assert.equal(
    validateCollectionsRuntimeTarget({ supabaseUrl: 'not-a-url', localEnabled: 'true' }, 'mutate').allowed,
    false,
  );
});
