import assert from 'node:assert/strict';
import {
  closeSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';

import * as XLSX from 'xlsx';

import {
  hasValidDocumentSignature,
  isPathInsideRepository,
  parseQualificationCliArguments,
  QualificationCliError,
  runQualificationCli,
} from '../../scripts/qualifyOperationalImportRealFile';
import type { OperationalBankCode } from './bankIdentity';
import { bankReportSectionExtractor } from './bankReportSectionExtractor';
import { extractBankReport, extractClientReconciliation } from './extractionService';
import { qualifyOperationalImportRealFileText } from './operationalImportRealFileQualification';

const nominalFixtures: Record<OperationalBankCode, string> = {
  BDK: 'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
  ATB: 'ATB RAPPORT 05/08/2026\nSOLDE OUVERTURE 05/08/2026 1 000 000\nSOLDE CLOTURE COMPTABLE: 900 000',
  BICIS: 'BICIS RAPPORT 05/08/2026\nSOLDE INITIAL 05/08/2026 1 000 000\nSOLDE FINAL COMPTABLE: 900 000',
  ORA: 'ORABANK RAPPORT 05/08/2026\nBALANCE OPENING 05/08/2026 1 000 000\nBALANCE CLOSING BOOK: 900 000',
  SGBS: 'SGBS RAPPORT 05/08/2026\nSOLDE OUVERTURE 05/08/2026 1 000 000\nSOLDE FERMETURE LIVRE: 900 000',
  BIS: 'BIS RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\nCLOSING BALANCE BOOK: 900 000',
};

for (const [bank, fixture] of Object.entries(nominalFixtures) as [OperationalBankCode, string][]) {
  test(`${bank}: le contrat nominal extrait date et soldes explicites`, async () => {
    const result = await bankReportSectionExtractor.extractBankReportSections(fixture, bank);
    assert.equal(result.success, true, result.errors?.join(' '));
    assert.equal(result.data?.bank, bank);
    assert.equal(result.data?.date, '2026-08-05');
    assert.equal(result.data?.openingBalance, 1000000);
    assert.equal(result.data?.closingBalance, 900000);
  });
}

test('le contrat bancaire refuse texte aplati, banque incohérente et date invalide', async () => {
  const flattened = nominalFixtures.BDK.split('\n').join(' ');
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(flattened, 'BDK')).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(nominalFixtures.ATB, 'BDK')).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    nominalFixtures.BDK.split('05/08/2026').join('31/02/2026'),
    'BDK',
  )).success, false);
});

test('le contrat bancaire refuse les soldes absents ou invalides et les sections vides', async () => {
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nDOCUMENT SANS SOLDE',
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000,50',
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    `${nominalFixtures.BDK}\nDEPOSIT NOT YET CLEARED\nAUCUNE LIGNE EXPLOITABLE`,
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    `${nominalFixtures.BDK}\nDEPOSIT NOT YET CLEARED\n31/02/2026 123 REGLEMENT FACTURE CLIENT 100`,
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    nominalFixtures.BDK.replace('1 000 000', '12O000'),
    'BDK',
  )).success, false);
  assert.equal((await bankReportSectionExtractor.extractBankReportSections(
    nominalFixtures.BDK.replace('900 000', '9O0000'),
    'BDK',
  )).success, false);
});

test('un solde ne peut pas absorber le début chiffré de la ligne suivante', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\n18/05/2026 AUTRE LIGNE\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.openingBalance, 1000000);
});

test('une colonne numérique PDF voisine reste séparée du solde', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT 05/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\t900 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.openingBalance, 1000000);
});

test('la date d’en-tête doit concorder avec celle du solde d’ouverture', async () => {
  const mismatch = await bankReportSectionExtractor.extractBankReportSections(
    'BDK RAPPORT EDITE LE 12/08/2026\nOPENING BALANCE 05/08/2026 1 000 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(mismatch.success, false);

  const dateBeforeBank = await bankReportSectionExtractor.extractBankReportSections(
    '18/05/2026 BDK\nOPENING BALANCE 18/05/2026 1 000 000\nCLOSING BALANCE as per Book: C=(A-B) 900 000',
    'BDK',
  );
  assert.equal(dateBeforeBank.success, true, dateBeforeBank.errors?.join(' '));
  assert.equal(dateBeforeBank.data?.date, '2026-05-18');
});

test('BDK: un rapport avec sections exploitables est accepté', async () => {
  const report = [
    nominalFixtures.BDK,
    'DEPOSIT NOT YET CLEARED',
    '05/08/2026 123 REGLEMENT FACTURE CLIENT 100',
    'CHECK Not yet cleared',
    '05/08/2026 456 BENEFICIAIRE 50',
    'BANK FACILITY',
    'SPN 1000 400 600',
    'IMPAYE',
    '05/08/2026 05/08/2026 IMPAYE CL001 CLIENT 25',
  ].join('\n');
  const result = await bankReportSectionExtractor.extractBankReportSections(report, 'BDK');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.depositsNotCleared.length, 1);
  assert.equal(result.data?.checksNotCleared?.length, 1);
  assert.equal(result.data?.bankFacilities.length, 1);
  assert.equal(result.data?.impayes.length, 1);
});

test('les lignes de section refusent un montant OCR suffixé au lieu de persister son préfixe', async () => {
  for (const section of [
    [
      'DEPOSIT NOT YET CLEARED',
      '05/08/2026 123 REGLEMENT FACTURE CLIENT 100',
      '05/08/2026 124 REGUL IMPAYE CLIENT 12O000',
    ],
    [
      'CHECK Not yet cleared',
      '05/08/2026 456 BENEFICIAIRE 50',
      '05/08/2026 457 BENEFICIAIRE 12O000',
    ],
    ['BANK FACILITY', 'SPN 1000 400 600', 'AUTRE 1000 400 6O0'],
    [
      'IMPAYE',
      '05/08/2026 05/08/2026 IMPAYE CL001 CLIENT 25',
      '05/08/2026 05/08/2026 IMPAYE CL002 CLIENT 2O',
    ],
  ]) {
    for (const lines of [section.slice(0, 1).concat(section[2]), section]) {
      const result = await bankReportSectionExtractor.extractBankReportSections(
        [nominalFixtures.BDK, ...lines].join('\n'),
        'BDK',
      );
      assert.equal(result.success, false, lines.join(' — '));
    }
  }
});

test('BDK: REGUL IMPAYE dans un dépôt ne déclare pas silencieusement la section impayés', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections([
    nominalFixtures.BDK,
    'DEPOSIT NOT YET CLEARED',
    '05/08/2026 123 REGUL IMPAYE CLIENT 100',
  ].join('\n'), 'BDK');

  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.depositsNotCleared.length, 1);
  assert.equal(result.data?.impayes.length, 0);
});

test('ATB: une section dépôts exploitable utilise le dernier groupe comme montant', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections([
    nominalFixtures.ATB,
    'DEPOTS NON CREDITES',
    '05/08/2026 123 CLIENT SYNTHETIQUE 100',
  ].join('\n'), 'ATB');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.depositsNotCleared[0]?.montant, 100);
});

test('ORA: l’unique date d’un impayé reste explicite et exploitable', async () => {
  const result = await bankReportSectionExtractor.extractBankReportSections([
    nominalFixtures.ORA,
    'UNPAID ITEMS',
    '05/08/2026 UNPAID CL001 CLIENT SYNTHETIQUE 25',
  ].join('\n'), 'ORA');
  assert.equal(result.success, true, result.errors?.join(' '));
  assert.equal(result.data?.impayes[0]?.dateRetour, undefined);
  assert.equal(result.data?.impayes[0]?.dateEcheance, '2026-08-05');
});

test('les anciens points d’entrée permissifs restent explicitement désactivés', () => {
  assert.equal(extractBankReport(nominalFixtures.BDK, 'BDK').success, false);
  assert.equal(extractClientReconciliation('CLIENT 100').success, false);
});

test('le harness réel rend une preuve bancaire agrégée sans données financières brutes', async () => {
  const rawText = [
    nominalFixtures.BDK,
    'DEPOSIT NOT YET CLEARED',
    '05/08/2026 123 REGLEMENT FACTURE CLIENT_SENSIBLE 777777',
  ].join('\n');
  const result = await qualifyOperationalImportRealFileText({
    caseId: 'BDK-R1',
    family: 'BDK',
    format: 'PDF',
    sourceFileName: 'BDK_R1.pdf',
    extractedText: rawText,
    inputSha256: 'a'.repeat(64),
    byteLength: 1234,
  });

  assert.equal(result.success, true);
  assert.equal(result.decision, 'LOCAL_CONTRACT_PASS_REQUIRES_STAGING_REVIEW');
  assert.equal(result.evidence.depositCount, 1);
  assert.equal(result.persistenceAttempted, false);
  assert.equal(result.environmentAccessed, false);
  assert.equal(result.promotionAuthorized, false);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /CLIENT_SENSIBLE|777777|900 ?000|1 ?000 ?000/);
});

test('le harness réel refuse l’identité bancaire incohérente sans exposer le contenu', async () => {
  const rawText = `${nominalFixtures.ATB}\nLIGNE CONFIDENTIELLE 888888`;
  const result = await qualifyOperationalImportRealFileText({
    caseId: 'BDK-R2',
    family: 'BDK',
    format: 'XLSX',
    sourceFileName: 'BDK_R2.xlsx',
    extractedText: rawText,
    inputSha256: 'b'.repeat(64),
    byteLength: 4321,
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.errorCodes, ['BANK_IDENTITY_UNCORROBORATED']);
  assert.doesNotMatch(JSON.stringify(result), /CONFIDENTIELLE|888888|ATB RAPPORT/);
});

test('le harness réel résume Fund Position sans montant, banque de détail ou date brute', async () => {
  const rawText = [
    'FUND POSITION 29/02/2024',
    'DOCUMENT DE QUALIFICATION SYNTHETIQUE ANONYMISE',
    'Book balance',
    'BDK\t100\t0\t100\t0\t100',
    'TOTAL FUND AVAILABLE 100',
    'GRAND TOTAL 0',
  ].join('\n');
  const result = await qualifyOperationalImportRealFileText({
    caseId: 'FUND-R1',
    family: 'FUND_POSITION',
    format: 'XLS',
    sourceFileName: 'FUND_POSITION_R1.xls',
    extractedText: rawText,
    inputSha256: 'c'.repeat(64),
    byteLength: 987,
  });

  assert.equal(result.success, true);
  assert.equal(result.evidence.bankDetailCount, 1);
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /29\/02\/2024|BOOK BALANCE|TOTAL FUND|"BDK"/i);
});

test('le harness réel échoue fermé sur un contenu insuffisant', async () => {
  const result = await qualifyOperationalImportRealFileText({
    caseId: 'BIS-R1',
    family: 'BIS',
    format: 'PDF',
    sourceFileName: 'BIS_R1.pdf',
    extractedText: 'BIS',
    inputSha256: 'd'.repeat(64),
    byteLength: 3,
  });

  assert.equal(result.success, false);
  assert.deepEqual(result.errorCodes, ['CONTENT_TOO_SHORT']);
  assert.equal(result.decision, 'FAIL_CLOSED');
});

test('la CLI exige l’attestation, un chemin absolu hors dépôt et reste sans écriture', () => {
  assert.throws(
    () => parseQualificationCliArguments([
      '--family', 'BDK', '--case-id', 'BDK-R1', '--file', 'relative.pdf',
    ]),
    (error: unknown) => error instanceof QualificationCliError
      && error.code === 'ANONYMIZATION_ATTESTATION_REQUIRED',
  );
  assert.throws(
    () => parseQualificationCliArguments([
      '--family', 'BDK', '--case-id', 'BDK-R1', '--file', 'relative.pdf', '--anonymized',
    ]),
    (error: unknown) => error instanceof QualificationCliError
      && error.code === 'INPUT_PATH_MUST_BE_ABSOLUTE',
  );
  assert.equal(isPathInsideRepository(process.cwd(), process.cwd()), true);
  assert.equal(isPathInsideRepository(resolveOutsideRepository(), process.cwd()), false);

  const cliSource = readFileSync('scripts/qualifyOperationalImportRealFile.ts', 'utf8');
  const qualificationSource = readFileSync(
    'src/services/operationalImportRealFileQualification.ts',
    'utf8',
  );
  assert.match(cliSource, /INPUT_PATH_MUST_BE_OUTSIDE_REPOSITORY/);
  assert.match(cliSource, /ANONYMIZATION_ATTESTATION_REQUIRED/);
  assert.match(cliSource, /isPathInsideRepository\(args\.inputPath/);
  assert.match(cliSource, /canonicalRepositoryRoot/);
  assert.doesNotMatch(
    `${cliSource}\n${qualificationSource}`,
    /\b(?:writeFile\w*|appendFile\w*|createWriteStream|openSync|unlink\w*|rename\w*|mkdir\w*|rmSync|fetch|supabase|databaseService|saveReport)\b/i,
  );
});

test('la CLI refuse réellement chemins internes, nœuds, tailles, signatures et archives invalides', async () => {
  const insideRepository = await executeQualificationCli([
    '--family', 'BDK', '--case-id', 'BDK-R3', '--file', resolve('package.json'), '--anonymized',
  ]);
  assert.equal(insideRepository.exitCode, 2);
  assert.equal(insideRepository.payload.errorCode, 'INPUT_PATH_MUST_BE_OUTSIDE_REPOSITORY');

  const temporaryRoot = mkdtempSync(join(tmpdir(), 'sodatra-real-file-qualification-'));
  try {
    const directoryPath = join(temporaryRoot, 'BDK_DIRECTORY.pdf');
    mkdirSync(directoryPath);
    const directoryResult = await executeQualificationCli(cliArguments(directoryPath, 'BDK-R4'));
    assert.equal(directoryResult.payload.errorCode, 'INPUT_FILE_NOT_REGULAR');

    const emptyPath = join(temporaryRoot, 'BDK_EMPTY.pdf');
    writeFileSync(emptyPath, '');
    const emptyResult = await executeQualificationCli(cliArguments(emptyPath, 'BDK-R5'));
    assert.equal(emptyResult.payload.errorCode, 'INPUT_FILE_EMPTY');

    const oversizedPath = join(temporaryRoot, 'BDK_OVERSIZED.pdf');
    const oversizedHandle = openSync(oversizedPath, 'w');
    try {
      ftruncateSync(oversizedHandle, 25 * 1024 * 1024 + 1);
    } finally {
      closeSync(oversizedHandle);
    }
    const oversizedResult = await executeQualificationCli(cliArguments(oversizedPath, 'BDK-R6'));
    assert.equal(oversizedResult.payload.errorCode, 'INPUT_FILE_TOO_LARGE');

    const disguisedPdfPath = join(temporaryRoot, 'BDK_DISGUISED.pdf');
    writeFileSync(disguisedPdfPath, 'NOT A PDF');
    const disguisedPdfResult = await executeQualificationCli(cliArguments(disguisedPdfPath, 'BDK-R7'));
    assert.equal(disguisedPdfResult.payload.errorCode, 'INPUT_FILE_SIGNATURE_MISMATCH');

    const invalidArchivePath = join(temporaryRoot, 'BDK_LIMIT.xlsx');
    const invalidArchive = Buffer.alloc(26);
    invalidArchive.writeUInt32LE(0x04034b50, 0);
    invalidArchive.writeUInt32LE(0x06054b50, 4);
    writeFileSync(invalidArchivePath, invalidArchive);
    const invalidArchiveResult = await executeQualificationCli(
      cliArguments(invalidArchivePath, 'BDK-R8'),
    );
    assert.equal(invalidArchiveResult.payload.errorCode, 'DOCUMENT_RESOURCE_LIMIT_EXCEEDED');

    const validWorkbookPath = join(temporaryRoot, 'BDK_SHORT.xlsx');
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['BDK']]), 'DATA');
    writeFileSync(validWorkbookPath, XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' }));
    const validWorkbookResult = await executeQualificationCli(
      cliArguments(validWorkbookPath, 'BDK-R9'),
    );
    assert.equal(validWorkbookResult.exitCode, 1);
    assert.deepEqual(validWorkbookResult.payload.errorCodes, ['CONTENT_TOO_SHORT']);

    const truncatedWorkbookPath = join(temporaryRoot, 'BDK_TOO_MANY_ROWS.xlsx');
    const truncatedWorkbook = XLSX.utils.book_new();
    const rows = Array.from(
      { length: 20_001 },
      (_, index) => [index === 0 ? 'BDK' : `SYNTHETIC_ROW_${index}`],
    );
    XLSX.utils.book_append_sheet(
      truncatedWorkbook,
      XLSX.utils.aoa_to_sheet(rows),
      'DATA',
    );
    writeFileSync(
      truncatedWorkbookPath,
      XLSX.write(truncatedWorkbook, { bookType: 'xlsx', type: 'buffer' }),
    );
    const truncatedWorkbookResult = await executeQualificationCli(
      cliArguments(truncatedWorkbookPath, 'BDK-R10'),
    );
    assert.equal(truncatedWorkbookResult.exitCode, 2);
    assert.equal(
      truncatedWorkbookResult.payload.errorCode,
      'DOCUMENT_RESOURCE_LIMIT_EXCEEDED',
    );

    const resultsWithSourceNames: Array<[
      Awaited<ReturnType<typeof executeQualificationCli>>,
      string,
    ]> = [
      [directoryResult, 'BDK_DIRECTORY.pdf'],
      [emptyResult, 'BDK_EMPTY.pdf'],
      [oversizedResult, 'BDK_OVERSIZED.pdf'],
      [disguisedPdfResult, 'BDK_DISGUISED.pdf'],
      [invalidArchiveResult, 'BDK_LIMIT.xlsx'],
      [validWorkbookResult, 'BDK_SHORT.xlsx'],
      [truncatedWorkbookResult, 'BDK_TOO_MANY_ROWS.xlsx'],
    ];
    for (const [result, sourceFileName] of resultsWithSourceNames) {
      assert.equal(result.payload.containsRawBankingData, false);
      const serialized = JSON.stringify(result.payload);
      assert.doesNotMatch(serialized, /sodatra-real-file-qualification/i);
      assert.equal(serialized.includes(sourceFileName), false);
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
});

test('les signatures PDF, XLSX et XLS sont vérifiées avant parsing', () => {
  assert.equal(hasValidDocumentSignature(Buffer.from('%PDF-1.7'), 'PDF'), true);
  assert.equal(hasValidDocumentSignature(Buffer.from('NOTPDF'), 'PDF'), false);
  assert.equal(hasValidDocumentSignature(Buffer.from([0x50, 0x4b, 0x03, 0x04]), 'XLSX'), true);
  assert.equal(hasValidDocumentSignature(
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
    'XLS',
  ), true);
});

function cliArguments(filePath: string, caseId: string): string[] {
  return ['--family', 'BDK', '--case-id', caseId, '--file', filePath, '--anonymized'];
}

async function executeQualificationCli(argv: readonly string[]): Promise<{
  exitCode: number;
  payload: Record<string, unknown>;
}> {
  let output = '';
  const exitCode = await runQualificationCli(argv, payload => {
    output += payload;
  });
  return { exitCode, payload: JSON.parse(output) as Record<string, unknown> };
}

function resolveOutsideRepository(): string {
  return process.platform === 'win32' ? 'C:\\qualification-secure\\sample.pdf' : '/qualification-secure/sample.pdf';
}
