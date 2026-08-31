import React from 'react';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { DailyV2AccessFeedback } from './DailyV2AccessFeedback';

test('route and standalone page share accessible fail-closed feedback without financial children', () => {
  const checking = renderToStaticMarkup(<DailyV2AccessFeedback state={{ status: 'checking' }} />);
  assert.match(checking, /role="status"/);
  for (const reason of ['session_required', 'runtime_target_rejected', 'role_lookup_failed', 'insufficient_role'] as const) {
    const html = renderToStaticMarkup(<DailyV2AccessFeedback state={{ status: 'blocked', reason }} />);
    assert.match(html, /role="alert"/);
    assert.doesNotMatch(html, /<input|<table|<button/);
  }
  for (const file of ['src/App.tsx', 'src/pages/DailyStatementV2.tsx']) {
    assert.match(readFileSync(file, 'utf8'), /<DailyV2AccessFeedback state=\{accessState\}/);
  }
});
