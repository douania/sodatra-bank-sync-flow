import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLECTIONS_CORE_PRODUCTION_PROJECT_REF,
  COLLECTIONS_CORE_STAGING_PROJECT_REF,
  validateCollectionsCoreRuntimeTarget,
} from './collectionsCoreRuntimeTarget';

test('autorise uniquement les trois loopbacks avec le drapeau local', () => {
  for (const supabaseUrl of ['http://localhost:54321', 'http://127.0.0.1:54321', 'http://[::1]:54321']) {
    assert.deepEqual(
      validateCollectionsCoreRuntimeTarget({ localEnabled: 'true', supabaseUrl }),
      { allowed: true, environment: 'local' },
    );
  }
});

test('refuse local sans drapeau et les cibles locales contradictoires', () => {
  assert.equal(validateCollectionsCoreRuntimeTarget({ supabaseUrl: 'http://localhost:54321' }).allowed, false);
  assert.equal(validateCollectionsCoreRuntimeTarget({
    localEnabled: 'true',
    supabaseUrl: 'http://localhost:54321',
    projectId: COLLECTIONS_CORE_STAGING_PROJECT_REF,
  }).allowed, false);
});

test('autorise seulement l’origine staging exacte et son project ID', () => {
  const verdict = validateCollectionsCoreRuntimeTarget({
    stagingPilotEnabled: 'true',
    supabaseUrl: `https://${COLLECTIONS_CORE_STAGING_PROJECT_REF}.supabase.co`,
    projectId: COLLECTIONS_CORE_STAGING_PROJECT_REF,
  });
  assert.equal(verdict.allowed && verdict.environment, 'staging');
  for (const suffix of [':443', '/rest/v1', '?x=1', '#x']) {
    assert.equal(validateCollectionsCoreRuntimeTarget({
      stagingPilotEnabled: 'true',
      supabaseUrl: `https://${COLLECTIONS_CORE_STAGING_PROJECT_REF}.supabase.co${suffix}`,
      projectId: COLLECTIONS_CORE_STAGING_PROJECT_REF,
    }).allowed, false);
  }
});

test('refuse explicitement production et les hôtes ressemblants', () => {
  assert.equal(validateCollectionsCoreRuntimeTarget({
    stagingPilotEnabled: 'true',
    supabaseUrl: `https://${COLLECTIONS_CORE_PRODUCTION_PROJECT_REF}.supabase.co`,
    projectId: COLLECTIONS_CORE_PRODUCTION_PROJECT_REF,
  }).allowed, false);
  for (const supabaseUrl of ['https://localhost.evil.test', 'http://[::2]:54321']) {
    assert.equal(validateCollectionsCoreRuntimeTarget({ localEnabled: 'true', supabaseUrl }).allowed, false);
  }
});
