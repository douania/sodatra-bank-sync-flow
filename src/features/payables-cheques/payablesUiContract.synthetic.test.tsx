import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chequeAmountWords, groupDigits } from './amountInWords';
import { ChequePrintSheet } from './ChequePrintSheet';
import { wrapWords, type ChequeContentFields } from './chequeLayout';

const profile = {
  profile_code: 'ORA_CHQ_170X95', bank: 'ORA', state: 'ACTIVE',
  page: { width_mm: 170, height_mm: 95 }, font: { family: 'Courier New', size_pt: 10 }, offset: { x_mm: 0, y_mm: 0 },
  fields: {
    beneficiary: { x_mm: 25, y_mm: 38, max_chars: 48 }, amount_figures: { x_mm: 130, y_mm: 18, max_chars: 18 },
    amount_words: { x_mm: 25, y_mm: 26, max_chars: 60, lines: 2, line_gap_mm: 6 },
    issue_date: { x_mm: 130, y_mm: 48, max_chars: 10 }, place: { x_mm: 100, y_mm: 48, max_chars: 20 },
  },
  place_label: 'Dakar', amount_words_suffix: 'francs CFA', amount_words_case: 'UPPER', printer_model: 'Synthetic',
};
function fields(amount: number, beneficiary = 'Bénéficiaire fictif'): ChequeContentFields {
  const words = chequeAmountWords(amount, 'francs CFA', 'UPPER');
  return {
    account: 'a', cheque_number: '0001234', currency: 'XOF', beneficiary, amount: String(amount), amount_figures: groupDigits(amount),
    amount_words: words, amount_words_lines: wrapWords(words, 60) ?? [], issue_date: '2026-10-25', issue_date_text: '25/10/2026',
    place: 'Dakar', profile_code: 'ORA_CHQ_170X95', profile_version_id: 'p',
  };
}

test('le calque imprimé ne contient que les champs à remplir, en millimètres, sans signature', () => {
  const html = renderToStaticMarkup(<ChequePrintSheet fields={fields(250_000)} layout={profile} mode="print" />);
  assert.match(html, /@page \{ size: 170mm 95mm; margin: 0; \}/);
  assert.match(html, /payables-cheque-print-root/);
  const fieldsRendered = [...html.matchAll(/data-field="([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(fieldsRendered, ['amount_figures', 'amount_words_1', 'beneficiary', 'issue_date', 'place']);
  assert.match(html, /left:25mm;top:38mm/);
  assert.doesNotMatch(html, /signature|0001234|<img/i);
});

test('l’aperçu refuse un débordement au lieu de tronquer', () => {
  const html = renderToStaticMarkup(<ChequePrintSheet fields={fields(1000, 'B'.repeat(49))} layout={profile} mode="preview" />);
  assert.match(html, /role="alert"/);
  assert.doesNotMatch(html, /data-field=/);
});

const featureDir = new URL('./', import.meta.url);
const sources = readdirSync(featureDir).filter((f) => /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && f !== 'sqlCorpus.ts')
  .map((f) => [f, readFileSync(new URL(f, featureDir), 'utf8')] as const);

test('afterprint ne déclenche jamais l’enregistrement d’un résultat', () => {
  const panel = readFileSync(new URL('./ChequesPanel.tsx', import.meta.url), 'utf8');
  const listener = /addEventListener\('afterprint', (\w+), \{ once: true \}\)/.exec(panel);
  assert.ok(listener, 'afterprint listener present');
  const handler = new RegExp(`const ${listener[1]} = \\(\\) => \\{([\\s\\S]*?)\\n\\s*\\};`).exec(panel);
  assert.ok(handler, 'afterprint handler body found');
  assert.match(handler[1], /dispatch\(\{ type: 'AFTERPRINT' \}\)/);
  assert.doesNotMatch(handler[1], /recordPrintOutcome|mutate/);
  // Écouteur retiré à la fermeture déclarée et au démontage.
  assert.ok((panel.match(/removeEventListener\('afterprint'/g) ?? []).length >= 2, 'afterprint listener is cleaned up');
});

test('aucune variable d’environnement hors de la cible d’exécution, aucun secret', () => {
  for (const [file, text] of sources) {
    if (file !== 'payablesRuntimeTarget.ts') assert.doesNotMatch(text, /import\.meta\.env/, file);
    assert.doesNotMatch(text, /service_role|SERVICE_ROLE|sk_live|BEGIN PRIVATE KEY/, file);
    if (file !== 'payablesRuntimeTarget.ts') assert.doesNotMatch(text, /leakcdbbawzysfqyqsnr/, file);
  }
});

test('route protégée et menu contrôlé par la même garde', () => {
  const app = readFileSync(new URL('../../App.tsx', import.meta.url), 'utf8');
  const layout = readFileSync(new URL('../../components/Layout.tsx', import.meta.url), 'utf8');
  assert.match(app, /<Route path="\/payables-cheques" element=\{<ProtectedRoute><PayablesChequesRoute \/><\/ProtectedRoute>\} \/>/);
  assert.match(app, /PayablesChequesGateProvider/);
  assert.match(layout, /item\.href !== '\/payables-cheques' \|\| payablesGate\.status === 'allowed'/);
  assert.doesNotMatch(layout, /currentPayablesRuntimeVerdict/);
});
