import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { register } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  collectionReportBytes,
  csvStatementBytes,
  excelStatementBytes,
  fundPositionBytes,
  monthlyWorkbookBytes,
  tabName,
} from './situationSyntheticFixtures';

// La cible vue par la route et le menu est fournie par le test (hook de
// résolution Node, jamais une option de production) et calculée par la VRAIE
// garde, importée sans double.
interface Harness { verdict: unknown }
const harness: Harness = { verdict: { allowed: false, reason: 'non initialisé' } };
(globalThis as unknown as { __situationHarness: Harness }).__situationHarness = harness;

const targetStub = 'data:text/javascript,' + encodeURIComponent(`
  export function currentSituationRuntimeVerdict() { return globalThis.__situationHarness.verdict; }
  export function isSituationRuntimeRefused(v) { return v.allowed === false; }`);
register('data:text/javascript,' + encodeURIComponent(`
  export function resolve(specifier, context, nextResolve) {
    if (specifier === './situationRuntimeTarget' && context.parentURL
      && ['/SituationRoute.tsx', '/situationMenu.ts'].some((suffix) => context.parentURL.split('?')[0].endsWith(suffix))) {
      return { shortCircuit: true, url: ${JSON.stringify(targetStub)} };
    }
    return nextResolve(specifier, context);
  }`));

(globalThis as unknown as { React: typeof React }).React = React;
const { SITUATION_PAGE_ORIGIN_REFUSED, SITUATION_PRODUCTION_REFUSED, validateSituationRuntimeTarget } = await import('./situationRuntimeTarget');
const { SituationRoute } = await import('./SituationRoute');
const { isSituationMenuVisible } = await import('./situationMenu');
const { createSituationSession } = await import('./situationSession');
const { classifySituationFile, computeSituation, SituationInputError } = await import('./situationCompute');

const PROD_URL = 'https://leakcdbbawzysfqyqsnr.supabase.co';
const PROD_ID = 'leakcdbbawzysfqyqsnr';
const STAGING_URL = 'https://gbbsqcscryygqlmqncyv.supabase.co';
const STAGING_ID = 'gbbsqcscryygqlmqncyv';
const PAGE = 'http://localhost:8080';
const LOCAL = { pageOrigin: PAGE, supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true' };
const ATB_HEADER = 'De 01 juin 2026 au 04 juin 2026';
const D = '2026-06-03';
const TODAY = '2026-06-05';

test('production toujours refusée, quels que soient les drapeaux', () => {
  const variants = [
    { supabaseUrl: PROD_URL, projectId: PROD_ID },
    { supabaseUrl: PROD_URL, projectId: PROD_ID, localEnabled: 'true', stagingEnabled: 'true' },
    { supabaseUrl: `${PROD_URL}/`, projectId: PROD_ID },
    { supabaseUrl: 'https://LEAKCDBBAWZYSFQYQSNR.supabase.co', projectId: PROD_ID },
    { supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co.', projectId: '' },
    { supabaseUrl: PROD_URL, stagingEnabled: 'true' },
    { supabaseUrl: STAGING_URL, projectId: PROD_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'http://localhost:54321', projectId: PROD_ID, localEnabled: 'true' },
    { supabaseUrl: 'not a url', projectId: PROD_ID, localEnabled: 'true' },
  ];
  for (const input of variants) {
    // Refus identique que la page soit servie en local, sur un hôte distant ou sans origine connue.
    for (const pageOrigin of [PAGE, 'https://app.example.com', undefined]) {
      assert.deepEqual(validateSituationRuntimeTarget({ pageOrigin, ...input }), { allowed: false, reason: SITUATION_PRODUCTION_REFUSED }, JSON.stringify(input));
    }
  }
});

test('origine réelle de la page : boucle locale exigée, hôte distant ou inconnu refusé', () => {
  const localTarget = { supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true' };
  const stagingTarget = { supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'true' };
  // Une page servie ailleurs que sur la boucle locale est refusée, même si le bundle vise un Supabase local.
  for (const pageOrigin of [
    undefined, '', 'not an origin', 'https://app.example.com', 'https://staging.example.com', 'http://192.168.1.20:8080',
    'https://localhost.example.com', 'file:///C:/index.html', 'http://user:secret@localhost:8080',
  ]) {
    for (const target of [localTarget, stagingTarget]) {
      assert.deepEqual(validateSituationRuntimeTarget({ pageOrigin, ...target }), { allowed: false, reason: SITUATION_PAGE_ORIGIN_REFUSED }, String(pageOrigin));
    }
  }
  // Boucle locale, toutes écritures admises.
  for (const pageOrigin of ['http://localhost:8080', 'http://127.0.0.1:5173', 'https://localhost', 'http://[::1]:8080']) {
    assert.deepEqual(validateSituationRuntimeTarget({ pageOrigin, ...localTarget }), { allowed: true, environment: 'local' }, pageOrigin);
  }
});

test('cible inconnue ou contradictoire refusée ; local et staging sur activation explicite', () => {
  assert.deepEqual(validateSituationRuntimeTarget(LOCAL), { allowed: true, environment: 'local' });
  // Poste local dont la session applicative s'appuie sur le staging approuvé : drapeau staging exigé.
  assert.deepEqual(validateSituationRuntimeTarget({ pageOrigin: PAGE, supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'true' }),
    { allowed: true, environment: 'local-with-staging-backend' });
  for (const input of [
    {},
    { supabaseUrl: 'not a url', localEnabled: 'true', stagingEnabled: 'true' },
    { supabaseUrl: 'http://127.0.0.1:54321' },
    { supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'TRUE' },
    { supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true', projectId: STAGING_ID },
    { supabaseUrl: STAGING_URL, projectId: STAGING_ID },
    { supabaseUrl: STAGING_URL, projectId: STAGING_ID, stagingEnabled: 'yes' },
    { supabaseUrl: STAGING_URL, stagingEnabled: 'true' },
    { supabaseUrl: `${STAGING_URL}/rest/v1`, projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'http://gbbsqcscryygqlmqncyv.supabase.co', projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'https://example.supabase.co', projectId: STAGING_ID, stagingEnabled: 'true' },
    { supabaseUrl: 'https://example.com', localEnabled: 'true', stagingEnabled: 'true' },
  ]) {
    assert.equal(validateSituationRuntimeTarget({ pageOrigin: PAGE, ...input }).allowed, false, JSON.stringify(input));
  }
});

test('URL directe refusée et menu masqué en production ou sur cible inconnue ou contradictoire', () => {
  for (const target of [
    { supabaseUrl: PROD_URL, projectId: PROD_ID, localEnabled: 'true', stagingEnabled: 'true' },
    { supabaseUrl: 'https://example.com', stagingEnabled: 'true' },
    { supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true', projectId: STAGING_ID },
    // Hôte distant inconnu dont le bundle vise un Supabase local, drapeau actif.
    { pageOrigin: 'https://app.example.com', supabaseUrl: 'http://127.0.0.1:54321', localEnabled: 'true' },
  ]) {
    harness.verdict = validateSituationRuntimeTarget({ pageOrigin: PAGE, ...target });
    const markup = renderToStaticMarkup(<SituationRoute />);
    assert.match(markup, /Situation du jour non disponible/);
    assert.equal(markup.includes('type="file"'), false, 'aucun dépôt de fichier possible sur une cible refusée');
    assert.equal(isSituationMenuVisible(), false);
  }
  harness.verdict = validateSituationRuntimeTarget(LOCAL);
  const allowed = renderToStaticMarkup(<SituationRoute />);
  assert.match(allowed, /Fichiers du jour/);
  assert.equal(allowed.includes('type="file"'), true);
  assert.equal(isSituationMenuVisible(), true);
});

function syntheticFiles() {
  const made = [
    { name: '040626 SYNTHETIC BDK ONLINE.csv', bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: D, amount: -50 }],
    }) },
    { name: '040626 SYNTHETIC ATB ONLINE.xls', bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, headerText: ATB_HEADER, movements: [{ date: '2026-06-02', amount: 300 }, { date: D, amount: -120 }] }) },
    { name: 'SYNTHETIC BDK 2026.xlsx', bytes: monthlyWorkbookBytes([{
      name: tabName('2026-06-04'), labelDate: D, titleBank: 'BDK', opening: 1050,
      deposits: [{ date: D, dueDate: '2026-09-01', client: 'SYNTHETIC CLIENT A', amount: 700 }],
      cheques: [{ date: D, number: 5550001, amount: 480 }],
    }]) },
    { name: 'SYNTHETIC COLLECTION REPORT.xlsx', bytes: collectionReportBytes([
      { date: '2026-06-02', instrument: { date: '2026-09-01' }, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 700, depositBank: 'BDK' },
      { date: '2026-05-20', instrument: { date: '2026-08-01' }, clientBank: 'SYNTHBANK B', client: 'SYNTHETIC CLIENT B', amount: 5000, depositBank: 'BDK', validity: { date: '2026-05-25' } },
    ]) },
    { name: 'SYNTHETIC FUND POSITION.xlsx', bytes: fundPositionBytes([{ name: tabName('2026-06-04'), reference: { date: D, currency: 'XOF' }, rows: [
      { label: 'BDK', bankBalance: 1050, fundApplied: 500, netBalance: 550, nonValidatedDeposit: 700, position: 1250 },
    ] }]) },
    { name: 'NOTES.xlsx', bytes: monthlyWorkbookBytes([{ name: '040626', labelDate: D, titleBank: 'BDK', opening: 1 }]) },
  ];
  return made.map((file) => ({ name: file.name, size: file.bytes.byteLength, bytes: file.bytes, arrayBuffer: async () => file.bytes }));
}

test('classement des fichiers par leur nom', () => {
  assert.deepEqual(syntheticFiles().map((file) => classifySituationFile(file.name).kind), [
    'STATEMENT', 'STATEMENT', 'MONTHLY_WORKBOOK', 'COLLECTION_REPORT', 'FUND_POSITION', 'UNRECOGNIZED',
  ]);
  assert.equal(classifySituationFile('SYNTHETIC BDK ONLINE.pdf').kind, 'UNRECOGNIZED');
});

test('dépôt, calcul et effacement : tout en mémoire, sans réseau, stockage ni journal', async () => {
  const counters = { network: 0, storage: 0, log: 0 };
  const globals = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};
  const storageTrap = new Proxy({}, { get: () => { counters.storage += 1; return () => null; }, set: () => { counters.storage += 1; return true; } });
  const networkTrap = function networkTrap() { counters.network += 1; throw new Error('network forbidden'); };
  for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) { saved[key] = globals[key]; globals[key] = networkTrap; }
  for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) {
    saved[key] = Object.getOwnPropertyDescriptor(globals, key);
    Object.defineProperty(globals, key, { configurable: true, get: () => storageTrap });
  }
  const consoleMethods = ['log', 'info', 'warn', 'error', 'debug', 'trace', 'table'] as const;
  const savedConsole = consoleMethods.map((method) => console[method]);
  consoleMethods.forEach((method) => { (console as unknown as Record<string, unknown>)[method] = () => { counters.log += 1; }; });

  const files = syntheticFiles();
  let session;
  try {
    session = createSituationSession({ today: () => TODAY, initialAccountingDate: D });
    await session.addFiles(files);
    assert.equal(session.getState().files.length, 6);
    assert.equal(session.getState().result, null);

    session.compute();
    const first = session.getState().result!;
    assert.equal(first.accountingDate, D);
    // BDK prouvé ; ATB à revoir tant que l'identité n'est pas attestée.
    assert.equal(first.balances.find((balance) => balance.bank === 'BDK')!.status, 'AVAILABLE');
    assert.equal(first.balances.find((balance) => balance.bank === 'ATB')!.status, 'TO_REVIEW');
    assert.equal(first.consolidation[0].status, 'PARTIAL');
    assert.equal(first.consolidation[0].amount, 1050);

    session.setAttestation('040626 SYNTHETIC ATB ONLINE.xls', { identityAttested: true });
    assert.equal(session.getState().result, null, 'une attestation invalide le résultat affiché');
    session.compute();
    const second = session.getState().result!;
    assert.equal(second.consolidation[0].amount, 1050 + 5180);
    assert.deepEqual(second.consolidation[0].includedBanks, ['BDK', 'ATB']);
    assert.equal(second.workbooks[0].available, true);
    assert.equal(second.workbooks[0].cheques.declaredTotal, 480);
    // Tombées : le dépôt en attente est une entrée ; l'effet déjà crédité ne l'est pas.
    assert.equal(second.collection!.summary!.expectedInflowsTotal, 700);
    assert.equal(second.collection!.summary!.countByState.CREDITE_DECLARE, 1);
    // Fund Position : l'écart sur les chèques non débités est chiffré.
    const applied = second.fundPosition!.comparisons.find((entry) => entry.indicator === 'FUND_APPLIED_VS_WORKBOOK')!;
    assert.equal(applied.status, 'DIFFERENT');
    assert.equal(applied.delta, 20);

    // Redépôt du même nom : remplacement, jamais un second exemplaire.
    await session.addFiles([files[0]]);
    assert.equal(session.getState().files.length, 6);
    session.compute();
    assert.equal(session.getState().result!.balances.find((balance) => balance.bank === 'BDK')!.amount, 1050);

    session.setAccountingDate('2026-13-45');
    session.compute();
    assert.equal(session.getState().error, 'ACCOUNTING_DATE_INVALID');
    assert.equal(session.getState().result, null);
    session.setAccountingDate('2026-06-09');
    session.compute();
    assert.equal(session.getState().error, 'ACCOUNTING_DATE_IN_FUTURE');

    session.clear();
    assert.deepEqual(session.getState().files, []);
    assert.deepEqual(session.getState().attestations, {});
    assert.equal(session.getState().result, null);
  } finally {
    consoleMethods.forEach((method, index) => { (console as unknown as Record<string, unknown>)[method] = savedConsole[index]; });
    for (const key of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource']) globals[key] = saved[key];
    for (const key of ['localStorage', 'sessionStorage', 'indexedDB']) {
      if (saved[key]) Object.defineProperty(globals, key, saved[key] as PropertyDescriptor); else delete globals[key];
    }
  }
  // Effacement : les octets des fichiers déposés sont remis à zéro.
  for (const file of files) {
    assert.equal(new Uint8Array(file.bytes).every((byte) => byte === 0), true, file.name);
  }
  assert.deepEqual(counters, { network: 0, storage: 0, log: 0 });
});

test('date comptable invalide ou future : refus avant tout calcul', () => {
  assert.throws(() => computeSituation({ files: [], accountingDate: '03/06/2026', today: TODAY }), SituationInputError);
  assert.throws(() => computeSituation({ files: [], accountingDate: '2026-06-06', today: TODAY }), SituationInputError);
  const empty = computeSituation({ files: [], accountingDate: D, today: TODAY });
  assert.equal(empty.consolidation[0].status, 'UNAVAILABLE');
  assert.equal(empty.consolidation[0].amount, null);
  assert.equal(empty.collection, null);
  assert.equal(empty.fundPosition, null);
});

test('deux classeurs pour la même banque : aucun n’alimente les rapprochements', () => {
  const workbook = (name: string) => ({ name, bytes: monthlyWorkbookBytes([{
    name: tabName('2026-06-04'), labelDate: D, titleBank: 'BDK', opening: 1050,
    deposits: [{ date: D, dueDate: '2026-09-01', client: 'SYNTHETIC CLIENT A', amount: 700 }], cheques: [],
  }]) });
  const collection = { name: 'SYNTHETIC COLLECTION REPORT.xlsx', bytes: collectionReportBytes([
    { date: '2026-06-02', instrument: { date: '2026-09-01' }, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 700, depositBank: 'BDK' },
  ]) };
  const result = computeSituation({ files: [workbook('SYNTHETIC BDK 2026.xlsx'), workbook('COPIE BDK 2026.xlsx'), collection], accountingDate: D, today: TODAY });
  assert.equal(result.workbooks.length, 2);
  // Aucun des deux n'affiche de chiffre, et l'ambiguïté est annoncée.
  for (const entry of result.workbooks) {
    assert.equal(entry.available, false);
    assert.equal(entry.reason, 'DUPLICATE_WORKBOOK');
    assert.equal(entry.openingBalance, null);
    assert.equal(entry.bank, 'BDK');
  }
  assert.deepEqual(result.ambiguities, ['SEVERAL_WORKBOOKS_FOR_A_BANK']);
  assert.equal(result.collection!.rows[0].state, 'A_VERIFIER');
  assert.equal(result.collection!.rows[0].checkReason, 'NO_WORKBOOK_FOR_BANK');
  // Même quand un seul des deux est exploitable, aucun n'est retenu.
  const broken = { name: 'COPIE BDK 2026.xlsx', bytes: new Uint8Array([1, 2, 3, 4]).buffer };
  const mixed = computeSituation({ files: [workbook('SYNTHETIC BDK 2026.xlsx'), broken, collection], accountingDate: D, today: TODAY });
  assert.equal(mixed.workbooks.every((entry) => entry.available === false && entry.reason === 'DUPLICATE_WORKBOOK'), true);
  assert.equal(mixed.collection!.rows[0].state, 'A_VERIFIER');
  // Témoin : un seul classeur, le dépôt est reconnu.
  const single = computeSituation({ files: [workbook('SYNTHETIC BDK 2026.xlsx'), collection], accountingDate: D, today: TODAY });
  assert.deepEqual(single.ambiguities, []);
  assert.equal(single.collection!.rows[0].state, 'DEPOSE_EN_ATTENTE');
});

test('deux Collection Reports ou deux Fund Positions : section non calculée et annoncée', () => {
  const collection = (name: string) => ({ name, bytes: collectionReportBytes([
    { date: '2026-06-02', instrument: 4440001, clientBank: 'SYNTHBANK A', client: 'SYNTHETIC CLIENT A', amount: 700, depositBank: 'BDK', validity: { date: '2026-06-03' } },
  ]) });
  const fund = (name: string) => ({ name, bytes: fundPositionBytes([{ name: tabName('2026-06-04'), rows: [{ label: 'BDK', bankBalance: 1, fundApplied: 0, netBalance: 1, nonValidatedDeposit: 0, position: 1 }] }]) });
  const result = computeSituation({
    files: [collection('SYNTHETIC COLLECTION REPORT.xlsx'), collection('COPIE COLLECTION REPORT.xlsx'), fund('SYNTHETIC FUND POSITION.xlsx'), fund('COPIE FUND POSITION.xlsx')],
    accountingDate: D, today: TODAY,
  });
  assert.equal(result.collection, null);
  assert.equal(result.fundPosition, null);
  assert.deepEqual(result.ambiguities, ['SEVERAL_COLLECTION_REPORTS', 'SEVERAL_FUND_POSITIONS']);
});

test('une attestation tombe quand le fichier attesté est remplacé', async () => {
  const name = '040626 SYNTHETIC ATB ONLINE.xls';
  const make = (opening: number) => {
    const bytes = excelStatementBytes({ bank: 'ATB', opening, headerText: ATB_HEADER, movements: [{ date: '2026-06-02', amount: 300 }, { date: D, amount: -120 }] });
    return { name, size: bytes.byteLength, arrayBuffer: async () => bytes };
  };
  const session = createSituationSession({ today: () => TODAY, initialAccountingDate: D });
  await session.addFiles([make(5000)]);
  session.setAttestation(name, { identityAttested: true });
  session.compute();
  assert.equal(session.getState().result!.balances.find((balance) => balance.bank === 'ATB')!.amount, 5180);

  await session.addFiles([make(77_000)]);
  assert.deepEqual(session.getState().attestations, {});
  session.compute();
  const replaced = session.getState().result!.balances.find((balance) => balance.bank === 'ATB')!;
  assert.equal(replaced.status, 'TO_REVIEW');
  assert.equal(replaced.amount, null);
  assert.deepEqual(replaced.reasons, ['IDENTITY_NOT_CORROBORATED']);
});

test('limites de dépôt et effacement pendant une lecture', async () => {
  const small = (name: string) => ({ name, size: 4, arrayBuffer: async () => new Uint8Array([1, 2, 3, 4]).buffer });
  const session = createSituationSession({ today: () => TODAY, initialAccountingDate: D });
  await session.addFiles(Array.from({ length: 41 }, (_, index) => small(`F${index}.xlsx`)));
  assert.equal(session.getState().error, 'TOO_MANY_FILES');
  assert.equal(session.getState().files.length, 0);

  await session.addFiles([{ name: 'HUGE.xlsx', size: 26 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(1) }]);
  assert.equal(session.getState().error, 'FILE_TOO_LARGE');
  assert.equal(session.getState().files.length, 0);

  await session.addFiles([{ name: 'BROKEN.xlsx', arrayBuffer: async () => { throw new Error('unreadable'); } }]);
  assert.equal(session.getState().error, 'FILE_UNREADABLE');

  // « Effacer » pendant qu'un fichier est encore en cours de lecture : il n'est pas rechargé ensuite.
  let release: (bytes: ArrayBuffer) => void = () => undefined;
  const slowBytes = new Uint8Array([5, 6, 7, 8]).buffer;
  const pending = session.addFiles([{ name: 'SLOW.xlsx', arrayBuffer: () => new Promise<ArrayBuffer>((resolve) => { release = resolve; }) }]);
  session.clear();
  release(slowBytes);
  await pending;
  assert.deepEqual(session.getState().files, []);
  assert.equal(new Uint8Array(slowBytes).every((byte) => byte === 0), true);
});

test('branchement : route protégée, menu sous la même garde, variables d’activation exactes', () => {
  const root = fileURLToPath(new URL('../../..', import.meta.url));
  const app = readFileSync(join(root, 'src', 'App.tsx'), 'utf8');
  assert.match(app, /<Route path="\/situation-du-jour" element=\{<ProtectedRoute><SituationRoute \/><\/ProtectedRoute>\} \/>/);
  assert.equal(app.split('SituationDuJourPage').length, 1, 'l’écran n’est jamais monté hors de sa garde');
  const layout = readFileSync(join(root, 'src', 'components', 'Layout.tsx'), 'utf8');
  assert.match(layout, /href: '\/situation-du-jour'/);
  assert.match(layout, /item\.href !== '\/situation-du-jour' \|\| isSituationMenuVisible\(\)/);
  const target = readFileSync(join(root, 'src', 'features', 'situation-du-jour', 'situationRuntimeTarget.ts'), 'utf8');
  for (const name of ['VITE_SITUATION_DU_JOUR_LOCAL_ENABLED', 'VITE_SITUATION_DU_JOUR_STAGING_ENABLED', 'VITE_SUPABASE_URL', 'VITE_SUPABASE_PROJECT_ID']) {
    assert.equal(target.split(`import.meta.env.${name}`).length, 2, name);
  }
});

test('le code de la feature ne référence ni réseau, ni stockage, ni journal, ni Supabase', () => {
  const directory = fileURLToPath(new URL('.', import.meta.url));
  const sources = readdirSync(directory).filter((name) => /\.(ts|tsx)$/.test(name) && !/\.synthetic\.test\.tsx?$/.test(name));
  assert.ok(sources.length >= 10);
  const forbidden = [/\bconsole\s*\./, /\blocalStorage\b/, /\bsessionStorage\b/, /\bindexedDB\b/, /\bfetch\s*\(/, /\bXMLHttpRequest\b/,
    /\bWebSocket\b/, /\bsendBeacon\b/, /document\s*\.\s*cookie/, /supabase\/client/, /from ['"]@\/integrations/];
  for (const name of sources) {
    const code = readFileSync(join(directory, name), 'utf8')
      .split('\n').filter((line) => !line.trim().startsWith('//')).join('\n');
    for (const pattern of forbidden) {
      assert.equal(pattern.test(code), false, `${name} : ${pattern}`);
    }
  }
});
