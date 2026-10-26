// Preuve navigateur de l'isolation d'impression (hors CI). Données
// synthétiques uniquement, aucune connexion distante, aucune imprimante :
//   npx tsx src/features/payables-cheques/printIsolation.proof.ts [navigateur] [--keep]
// Construit une page d'application synthétique avec une longue liste et un
// élément en position fixe, insère le calque d'impression sous <body> comme le
// fait le portail de ChequesPanel, imprime en PDF avec Chromium sans tête et
// exige EXACTEMENT une page au format du profil.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
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

const words = chequeAmountWords(1_234_567, 'francs CFA', 'UPPER');
const fields: ChequeContentFields = {
  account: 'compte-synthetique', cheque_number: '0000001', currency: 'XOF', beneficiary: 'BENEFICIAIRE SYNTHETIQUE',
  amount: '1234567', amount_figures: groupDigits(1_234_567), amount_words: words, amount_words_lines: wrapWords(words, 60) ?? [],
  issue_date: '2026-10-26', issue_date_text: '26/10/2026', place: 'Dakar', profile_code: 'ORA_CHQ_170X95', profile_version_id: 'p',
};

const CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];

function pageCount(pdf: Buffer): number {
  const text = pdf.toString('latin1');
  const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length > 0) return Math.max(...counts);
  return (text.match(/\/Type\s*\/Page(?![s\w])/g) ?? []).length;
}

const argBrowser = process.argv.slice(2).find((a) => !a.startsWith('--'));
const browser = argBrowser ?? CANDIDATES.find((c) => existsSync(c));
if (!browser) {
  console.error('PRINT_ISOLATION_NO_BROWSER');
  process.exit(2);
}

// Application synthétique : longue liste (plusieurs pages si elle était imprimée)
// et un élément en position fixe hors application.
const rows = Array.from({ length: 400 }, (_, i) => `<tr><td>Facture synthétique ${i + 1}</td><td>${(i + 1) * 1000} XOF</td></tr>`);
const app = `<div id="root"><h1>Factures, engagements et chèques émis</h1>`
  + renderToStaticMarkup(React.createElement(ChequePrintSheet, { fields, layout: profile, mode: 'preview' }))
  + `<table>${rows.join('')}</table></div>`
  + `<div id="toaster" style="position:fixed;bottom:0;right:0">Notification synthétique</div>`;
const layer = renderToStaticMarkup(React.createElement(ChequePrintSheet, { fields, layout: profile, mode: 'print' }));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Preuve d'impression</title></head>`
  + `<body style="margin:8px">${app}${layer}</body></html>`;

const dir = mkdtempSync(join(tmpdir(), 'payables-print-proof-'));
const htmlPath = join(dir, 'page.html');
const pdfPath = join(dir, 'page.pdf');
writeFileSync(htmlPath, html, 'utf8');
execFileSync(browser, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--no-pdf-header-footer',
  '--print-to-pdf-no-header', `--user-data-dir=${join(dir, 'profile')}`, `--print-to-pdf=${pdfPath}`,
  pathToFileURL(htmlPath).href,
], { stdio: 'ignore', timeout: 60_000 });
const pdf = readFileSync(pdfPath);
const pages = pageCount(pdf);
const mediaBox = /\/MediaBox\s*\[\s*0\s+0\s+([\d.]+)\s+([\d.]+)\s*\]/.exec(pdf.toString('latin1'));
console.log(`PRINT_ISOLATION_PAGES=${pages}`);
if (mediaBox) {
  const toMm = (pt: string) => Math.round((Number(pt) * 25.4) / 72);
  console.log(`PRINT_ISOLATION_PAGE_MM=${toMm(mediaBox[1])}x${toMm(mediaBox[2])}`);
}
if (process.argv.includes('--keep')) console.log(`PRINT_ISOLATION_PDF=${pdfPath}`);
else rmSync(dir, { recursive: true, force: true });
process.exit(pages === 1 ? 0 : 1);
