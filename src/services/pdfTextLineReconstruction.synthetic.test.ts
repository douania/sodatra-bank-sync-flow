import assert from 'node:assert/strict';
import test from 'node:test';

import { reconstructPdfTextLines } from './pdfTextLineReconstruction';

test('les tokens PDF positionnés sont regroupés par ligne et triés horizontalement', () => {
  const text = reconstructPdfTextLines([
    { str: '100', transform: [1, 0, 0, 1, 80, 700] },
    { str: 'BDK', transform: [1, 0, 0, 1, 10, 700] },
    { str: 'TOTAL', transform: [1, 0, 0, 1, 10, 680] },
  ]);
  assert.equal(text, 'BDK 100\nTOTAL');
});

test('la tolérance verticale conserve des baselines proches sur une même ligne', () => {
  const text = reconstructPdfTextLines([
    { str: 'OPENING', transform: [1, 0, 0, 1, 10, 700] },
    { str: 'BALANCE', transform: [1, 0, 0, 1, 70, 698.5] },
  ]);
  assert.equal(text, 'OPENING BALANCE');
});

test('un flux mixte sans coordonnées complètes est refusé fail-closed', () => {
  assert.throws(() => reconstructPdfTextLines([
    { str: 'BDK', transform: [1, 0, 0, 1, 10, 700] },
    { str: 'RAPPORT', hasEOL: true },
    { str: 'TOTAL', hasEOL: true },
  ]), /PDF_TEXT_POSITION_INCOMPLETE/);
});

test('un écart de colonne PDF est conservé par une tabulation', () => {
  const text = reconstructPdfTextLines([
    { str: '1 000 000', transform: [1, 0, 0, 1, 10, 700], width: 40 },
    { str: '900 000', transform: [1, 0, 0, 1, 100, 700], width: 35 },
  ]);
  assert.equal(text, '1 000 000\t900 000');
});

test('deux colonnes numériques restent séparées même avec un écart inférieur au seuil visuel', () => {
  const text = reconstructPdfTextLines([
    { str: '1 000 000', transform: [1, 0, 0, 1, 10, 700], width: 40 },
    { str: '900 000', transform: [1, 0, 0, 1, 58, 700], width: 35 },
  ]);
  assert.equal(text, '1 000 000\t900 000');
});

test('une frontière numérique sans largeur exploitable est refusée fail-closed', () => {
  assert.throws(() => reconstructPdfTextLines([
    { str: '100', transform: [1, 0, 0, 1, 10, 700] },
    { str: '0', transform: [1, 0, 0, 1, 30, 700] },
  ]), /PDF_NUMERIC_TOKEN_BOUNDARY_AMBIGUOUS/);
});
