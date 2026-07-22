import assert from 'node:assert/strict';
import test from 'node:test';

import { signInSchema } from './authSignInValidation';

test('sign-in accepts an existing password without applying creation complexity rules', () => {
  const result = signInSchema.safeParse({
    email: 'user@example.com',
    password: 'legacy',
  });

  assert.equal(result.success, true);
});

test('sign-in rejects an empty password before calling the auth provider', () => {
  const result = signInSchema.safeParse({
    email: 'user@example.com',
    password: '',
  });

  assert.equal(result.success, false);
  if ('error' in result) {
    assert.equal(result.error.issues[0]?.message, 'Password is required');
  }
});

test('sign-in keeps email validation', () => {
  const result = signInSchema.safeParse({
    email: 'invalid-email',
    password: 'legacy',
  });

  assert.equal(result.success, false);
  if ('error' in result) {
    assert.equal(result.error.issues[0]?.message, 'Invalid email address');
  }
});
