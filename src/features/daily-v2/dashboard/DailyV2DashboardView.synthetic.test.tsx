import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { DailyV2DashboardAccessGate, DailyV2DashboardView } from './DailyV2DashboardView';
import { resolveDashboardAccess } from './dailyV2DashboardRead';
import { buildDashboardSnapshot } from './dailyV2DashboardModel';
import { DailyV2DashboardPanel } from './DailyV2DashboardPanel';

test('render gate never evaluates data-backed child for blocked/pending roles', () => {
  for (const roles of [[], ['user'], ['manager'], ['admin'], ['auditor']]) {
    for (const session of [false, true]) for (const target of [false, true]) for (const pending of [false, true])
    for (const loading of [false, true]) for (const fetching of [false, true]) for (const error of [false, true]) {
      let renders = 0;
      const allowed = session && target && !pending && !loading && !fetching && !error && roles.some((role) => role === 'admin' || role === 'auditor');
      const status = resolveDashboardAccess({ session, loading, targetAllowed: target, pending, fetching, error, roles });
      const markup = renderToStaticMarkup(<DailyV2DashboardAccessGate status={status} renderAuthorized={() => { renders++; return <p>Protected metrics</p>; }} />);
      assert.equal(renders, allowed ? 1 : 0); assert.equal(markup.includes('Protected metrics'), allowed);
    }
  }
});
test('idle/loading/error states contain no prior balances or technical errors', () => {
  for (const status of ['idle', 'loading', 'error'] as const) {
    const markup = renderToStaticMarkup(<DailyV2DashboardView state={{ status }} />);
    assert.doesNotMatch(markup, /<table|Synthèse|Dernier solde/);
    assert.match(markup, /role="(?:status|alert)"/);
  }
});
test('empty render explicitly distinguishes absence of coverage from zero money', async () => {
  const snapshot = await buildDashboardSnapshot({ asOfDate: '2026-06-30', flowStartDate: '2026-06-01' }, [], 0, '2026-07-01T00:00:00Z');
  const markup = renderToStaticMarkup(<DailyV2DashboardView state={{ status: 'ready', snapshot }} />);
  assert.match(markup, /Aucune position connue/); assert.match(markup, /ne signifie pas un solde nul/);
  assert.match(markup, /pas un inventaire exhaustif/); assert.doesNotMatch(markup, /0\.00/);
});
test('render displays dates, observed coverage, stale positions, exact money and safe aliases only', async () => {
  const snapshot = await buildDashboardSnapshot({ asOfDate: '2026-06-30', flowStartDate: '2026-06-01' }, [{
    id: '00000000-0000-4000-8000-000000000001', accounting_date: '2026-06-20', bank: 'BDK', currency: 'XOF',
    account_fingerprint: 'synthetic-fingerprint-private', line_count: 1,
    day_total_debits: 0.1, day_total_credits: 0.3, opening_balance_derived: 10,
    closing_balance_derived: 10.2, validation_status: 'valid', aggregates_status: 'derived', ingested_at: '2026-06-21T00:00:00Z',
  }], 1, '2026-07-01T00:00:00Z');
  const markup = renderToStaticMarkup(<DailyV2DashboardView state={{ status: 'ready', snapshot }} />);
  assert.match(markup, /2026-06-20/); assert.match(markup, /10 jours avant la date demandée/);
  assert.match(markup, /10\.20 XOF/); assert.match(markup, /0\.20 XOF/);
  assert.match(markup, /1\/30 jours calendaires observés/); assert.match(markup, /C-[a-f0-9]{16}/);
  assert.match(markup, /pas une position certifiée à date commune/);
  assert.match(markup, /Aucun total de soldes par devise/);
  assert.match(markup, /1\/30 journées-compte calendaires observées/);
  assert.doesNotMatch(markup, /synthetic-fingerprint|00000000-0000|account_fingerprint|ingested_at|Déposer|Promouvoir|Exporter/);
});

test('real Panel renders supplied filters and loading gate without data work during SSR', () => {
  let calls = 0;
  const markup = renderToStaticMarkup(<DailyV2DashboardPanel initialInput={{ asOfDate: '2026-06-30', flowStartDate: '2026-06-01', bank: 'BDK' }} generate={async () => { calls++; throw Error('must not read in SSR'); }} />);
  assert.equal(calls, 0); assert.match(markup, /value="2026-06-30"/); assert.match(markup, /value="BDK"/);
  assert.match(markup, /UTC par défaut/); assert.match(markup, /Lecture des journées validées/);
  assert.match(markup, /derniers filtres soumis/);
  assert.doesNotMatch(markup, /<table/);
});
test('volume and invalid-filter refusals give correct remedies with no financial results', () => {
  const volume = renderToStaticMarkup(<DailyV2DashboardView state={{ status: 'error', failure: 'volume' }} />);
  assert.match(volume, /filtrez par banque ou devise/); assert.match(volume, /fixe à 400 jours/);
  assert.match(volume, /raccourcir la période de flux ne réduit pas/); assert.doesNotMatch(volume, /<table/);
  const filters = renderToStaticMarkup(<DailyV2DashboardView state={{ status: 'error', failure: 'filters' }} />);
  assert.match(filters, /banque et devise/); assert.match(filters, /12 caractères maximum/);
});
