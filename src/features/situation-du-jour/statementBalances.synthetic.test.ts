import assert from 'node:assert/strict';
import test from 'node:test';

import { csvStatementBytes, excelStatementBytes } from './situationSyntheticFixtures';
import type { SyntheticMovement } from './situationSyntheticFixtures';
import { buildAccountBalances, consolidateBalances, evaluateStatement } from './statementBalances';
import type { StatementInput } from './statementBalances';

const D = '2026-06-03';
const TODAY = '2026-06-08';
const evaluate = (file: StatementInput, date = D, today = TODAY) => evaluateStatement(file, date, today);

function bdk(name = '040626 SYNTHETIC BDK ONLINE.csv', closingShift = 0): StatementInput {
  return {
    name,
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 + closingShift }],
    }),
  };
}

const ATB_MOVES: SyntheticMovement[] = [{ date: '2026-06-02', amount: 300 }, { date: '2026-06-03', amount: -120 }];

function atb(attestation?: StatementInput['attestation'], headerText?: string, movements = ATB_MOVES, name = '040626 SYNTHETIC ATB ONLINE.xls'): StatementInput {
  return { name, attestation, bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements, headerText }) };
}

test('clôture à D prouvée, identité et devise corroborées par le contenu (CSV)', () => {
  const evaluation = evaluate(bdk());
  assert.equal(evaluation.admissible, true);
  assert.equal(evaluation.amount, 1050);
  assert.equal(evaluation.balanceDate, D);
  assert.equal(evaluation.identityProof, 'CONTENT');
  assert.equal(evaluation.currencyProof, 'CONTENT');
  assert.deepEqual(evaluation.reasons, []);
});

test('relevé Excel : à revoir sans attestation d’identité, admissible une fois attesté', () => {
  const without = evaluate(atb());
  assert.equal(without.admissible, false);
  assert.equal(without.amount, null);
  assert.equal(without.needsIdentityAttestation, true);
  assert.deepEqual(without.reasons, ['IDENTITY_NOT_CORROBORATED']);

  const attested = evaluate(atb({ identityAttested: true }));
  assert.equal(attested.admissible, true);
  assert.equal(attested.amount, 5180);
  assert.equal(attested.identityProof, 'OPERATOR');
  assert.equal(attested.currencyProof, 'CONTENT');
});

test('BRIDGE : la devise absente du fichier exige une attestation distincte', () => {
  const file = (attestation?: StatementInput['attestation']): StatementInput => ({
    name: '040626 SYNTHETIC BRIDGE ONLINE.xlsx',
    attestation,
    bytes: excelStatementBytes({ bank: 'BRIDGE', opening: 900, movements: [{ date: '2026-06-03', amount: 100 }] }),
  });
  const identityOnly = evaluate(file({ identityAttested: true }));
  assert.equal(identityOnly.admissible, false);
  assert.deepEqual(identityOnly.reasons, ['CURRENCY_NOT_CORROBORATED']);
  assert.equal(evaluate(file({ identityAttested: true, currencyAttested: 'EUR' })).admissible, false);
  const both = evaluate(file({ identityAttested: true, currencyAttested: 'XOF' }));
  assert.equal(both.admissible, true);
  assert.equal(both.amount, 1000);
  assert.equal(both.currencyProof, 'OPERATOR');
});

test('rupture de solde : exclue où qu’elle soit dans le relevé, y compris après D', () => {
  const bis = (movements: SyntheticMovement[], breakChain: boolean): StatementInput => ({
    name: '050626 SYNTHETIC BIS ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({ bank: 'BIS', opening: 100, movements, breakChain }),
  });
  const moves = [{ date: '2026-06-02', amount: 10 }, { date: '2026-06-03', amount: 20 }, { date: '2026-06-04', amount: 5 }];
  // Témoin : la même forme sans rupture est admissible.
  const sound = evaluate(bis(moves, false));
  assert.equal(sound.admissible, true);
  assert.equal(sound.amount, 130);
  // Rupture sur la journée qui SUIT D : D porte des mouvements, la clôture de D n'est plus prouvée.
  const brokenAfter = evaluate(bis(moves, true));
  assert.equal(brokenAfter.admissible, false);
  assert.equal(brokenAfter.amount, null);
  assert.deepEqual(brokenAfter.reasons, ['BALANCE_CHAIN_BROKEN']);
  // Rupture sur D elle-même.
  const brokenAt = evaluate(bis(moves.slice(0, 2), true));
  assert.equal(brokenAt.admissible, false);
  assert.ok(brokenAt.reasons.includes('BALANCE_CHAIN_BROKEN'));
});

test('ligne antidatée dans un CSV : la chaîne reconstituée par journée ne tient plus', () => {
  const evaluation = evaluate({
    name: '050626 SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-05', opening: 1000,
      movements: [{ date: '2026-06-02', amount: 100 }, { date: '2026-06-03', amount: 50 }, { date: '2026-06-01', amount: -400 }],
    }),
  });
  assert.equal(evaluation.admissible, false);
  assert.equal(evaluation.amount, null);
  assert.ok(evaluation.reasons.includes('BALANCE_CHAIN_BROKEN'));
});

test('relevé à revoir par le lecteur et dépassement de la limite quotidienne : exclus', () => {
  const needsReview = evaluate({
    name: '040626 SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000, declaredClosingOverride: 4242,
      movements: [{ date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }],
    }),
  });
  assert.equal(needsReview.admissible, false);
  assert.deepEqual(needsReview.reasons, ['STATEMENT_NEEDS_REVIEW']);

  const tooLong = evaluate({
    name: '040626 SYNTHETIC BIS ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({ bank: 'BIS', opening: 100, movements: [{ date: '2026-01-05', amount: 10 }, { date: '2026-06-03', amount: 20 }] }),
  });
  assert.equal(tooLong.admissible, false);
  assert.deepEqual(tooLong.reasons, ['PERIOD_OVER_DAILY_LIMIT']);
});

test('doublon : le même solde déposé deux fois n’est compté qu’une fois', () => {
  const balances = buildAccountBalances([evaluate(bdk()), evaluate(bdk('040626 COPIE BDK ONLINE.csv'))]);
  const account = balances.find((balance) => balance.bank === 'BDK')!;
  assert.equal(account.status, 'AVAILABLE');
  assert.equal(account.amount, 1050);
  assert.deepEqual(account.sources.map((source) => source.role).sort(), ['duplicate', 'retained']);
  assert.equal(consolidateBalances(balances)[0].amount, 1050);
});

test('même relevé déposé sous deux banques : aucun des deux n’est compté', () => {
  const sameBytes = buildAccountBalances([evaluate(bdk()), evaluate(bdk('040626 SYNTHETIC ORA ONLINE.csv'))]);
  for (const bank of ['BDK', 'ORA'] as const) {
    const account = sameBytes.find((balance) => balance.bank === bank)!;
    assert.equal(account.status, 'TO_REVIEW', bank);
    assert.equal(account.amount, null, bank);
    assert.deepEqual(account.reasons, ['SAME_STATEMENT_UNDER_SEVERAL_BANKS'], bank);
  }
  const total = consolidateBalances(sameBytes)[0];
  assert.equal(total.status, 'UNAVAILABLE');
  assert.equal(total.amount, null);

  // Même compte, contenu différent (autre export) : toujours un conflit.
  const sameAccount = buildAccountBalances([evaluate(bdk()), evaluate(bdk('040626 SYNTHETIC ORA ONLINE.csv', 7))]);
  assert.equal(sameAccount.find((balance) => balance.bank === 'ORA')!.status, 'TO_REVIEW');
  assert.equal(consolidateBalances(sameAccount)[0].amount, null);

  // Deux comptes distincts sous deux banques : les deux soldes sont comptés.
  const ora: StatementInput = {
    name: '040626 SYNTHETIC ORA ONLINE.csv',
    bytes: csvStatementBytes({ periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 300, accountSuffix: '11', movements: [{ date: '2026-06-03', amount: 25 }] }),
  };
  assert.equal(consolidateBalances(buildAccountBalances([evaluate(bdk()), evaluate(ora)]))[0].amount, 1050 + 325);
});

test('conflit : deux relevés contradictoires sont signalés et exclus', () => {
  const balances = buildAccountBalances([evaluate(bdk()), evaluate(bdk('040626 AUTRE BDK ONLINE.csv', 5))]);
  const account = balances.find((balance) => balance.bank === 'BDK')!;
  assert.equal(account.status, 'TO_REVIEW');
  assert.equal(account.amount, null);
  assert.deepEqual(account.reasons, ['CONFLICTING_STATEMENTS']);
  assert.deepEqual(account.sources.map((source) => source.role), ['conflict', 'conflict']);
  assert.equal(consolidateBalances(balances)[0].status, 'UNAVAILABLE');
});

test('sous-total PARTIEL par devise avec les comptes manquants nommés', () => {
  const balances = buildAccountBalances([evaluate(bdk()), evaluate(atb({ identityAttested: true })), evaluate(atb(undefined, undefined, ATB_MOVES, '040626 SECOND ATB ONLINE.xls'))]);
  const total = consolidateBalances(balances)[0];
  assert.equal(total.currency, 'XOF');
  assert.equal(total.status, 'PARTIAL');
  assert.equal(total.amount, 1050 + 5180);
  assert.deepEqual(total.includedBanks, ['BDK', 'ATB']);
  assert.deepEqual(total.missingBanks, ['ORA', 'BICIS', 'BIS', 'BRIDGE', 'NSIA', 'SGBS']);
  assert.deepEqual(balances.find((balance) => balance.bank === 'NSIA')!.reasons, ['NO_READER_FOR_BANK']);
  assert.deepEqual(balances.find((balance) => balance.bank === 'ORA')!.reasons, ['NO_STATEMENT']);
});

test('sans solde admissible, le résultat est indisponible et ne porte aucun chiffre', () => {
  const total = consolidateBalances(buildAccountBalances([evaluate(atb())]))[0];
  assert.equal(total.status, 'UNAVAILABLE');
  assert.equal(total.amount, null);
  assert.equal(total.missingBanks.length, 8);
  const empty = consolidateBalances(buildAccountBalances([]))[0];
  assert.equal(empty.status, 'UNAVAILABLE');
  assert.equal(empty.amount, null);
});

test('journée non close : jour du relevé, jour en cours, nom de fichier daté dans le futur', () => {
  const sameDay = evaluate(bdk(), '2026-06-04');
  assert.equal(sameDay.admissible, false);
  assert.ok(sameDay.reasons.includes('DAY_NOT_CLOSED'));
  // D = aujourd'hui : la journée en cours n'est jamais close, quel que soit le nom du fichier.
  const todayIsD = evaluate(atb({ identityAttested: true }), D, D);
  assert.equal(todayIsD.admissible, false);
  assert.deepEqual(todayIsD.reasons, ['DAY_NOT_CLOSED']);
  // Même avec une ligne datée du lendemain (fichier incohérent), la journée en cours reste ouverte.
  const futureLine = evaluate(atb({ identityAttested: true }, undefined, [...ATB_MOVES, { date: '2026-06-04', amount: 1 }]), D, D);
  assert.equal(futureLine.admissible, false);
  assert.ok(futureLine.reasons.includes('DAY_NOT_CLOSED'));
  // Une ligne datée après aujourd'hui ne prouve jamais la clôture d'une journée passée.
  const lineAfterToday = evaluate(
    atb({ identityAttested: true }, undefined, [{ date: D, amount: 300 }, { date: '2026-06-20', amount: 5 }], 'SYNTHETIC ATB ONLINE.xls'),
    D, '2026-06-04',
  );
  assert.equal(lineAfterToday.admissible, false);
  assert.equal(lineAfterToday.amount, null);
  assert.deepEqual(lineAfterToday.reasons, ['STATEMENT_NEEDS_REVIEW']);
  // Une date de nom de fichier postérieure à aujourd'hui ne prouve aucune clôture.
  const futureName = evaluate(atb({ identityAttested: true }, undefined, ATB_MOVES, '311299 SYNTHETIC ATB ONLINE.xls'));
  assert.equal(futureName.admissible, false);
  assert.deepEqual(futureName.reasons, ['DAY_NOT_CLOSED']);
  // Témoin : le même fichier sous un nom daté au plus tard aujourd'hui est admissible.
  assert.equal(evaluate(atb({ identityAttested: true })).admissible, true);
});

test('date non couverte : jamais de solde', () => {
  const before = evaluate(bdk(), '2026-05-20');
  assert.equal(before.admissible, false);
  assert.ok(before.reasons.includes('DATE_NOT_COVERED'));
});

test('jour sans mouvement : report seulement si la couverture est prouvée', () => {
  const csv: StatementInput = {
    name: '060626 SYNTHETIC ORA ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-06', opening: 400,
      movements: [{ date: '2026-06-01', amount: 60 }, { date: '2026-06-05', amount: 10 }],
    }),
  };
  const carried = evaluate(csv);
  assert.equal(carried.admissible, true);
  assert.equal(carried.amount, 460);
  assert.equal(carried.balanceDate, '2026-06-01');

  // Excel sans période déclarée ni ligne postérieure : D n'est pas couverte.
  const single = [{ date: '2026-06-01', amount: 300 }];
  const uncovered = evaluate(atb({ identityAttested: true }, undefined, single));
  assert.equal(uncovered.admissible, false);
  assert.ok(uncovered.reasons.includes('DATE_NOT_COVERED'));
  // La même forme avec une période déclarée dans l'en-tête : D est couverte.
  const declared = evaluate(atb({ identityAttested: true }, 'De 01 juin 2026 au 04 juin 2026', single));
  assert.equal(declared.admissible, true);
  assert.equal(declared.amount, 5300);
  assert.equal(declared.balanceDate, '2026-06-01');
});

test('période déclarée d’un relevé Excel : formule exacte, englobant les lignes, au plus 45 jours', () => {
  const single = [{ date: '2026-06-01', amount: 300 }];
  const withHeader = (headerText: string) => evaluate(atb({ identityAttested: true }, headerText, single));
  // Témoins : les deux formules de période reconnues.
  assert.equal(withHeader('Période : Du 01/06/2026 au 04/06/2026').admissible, true);
  assert.equal(withHeader('De 01 juin 2026 au 04 juin 2026').admissible, true);
  for (const header of [
    'Compte ouvert le 01/06/2026, situation au 04/06/2026',
    'Du 02/06/2026 au 04/06/2026',
    'Du 01/01/2026 au 04/06/2026',
  ]) {
    const evaluation = withHeader(header);
    assert.equal(evaluation.admissible, false, header);
    assert.deepEqual(evaluation.reasons, ['DATE_NOT_COVERED'], header);
  }
});

test('chaîne au centime près, raccordée aux soldes déclarés ; soldes courants obligatoires', () => {
  const small = evaluate({
    name: '050626 SYNTHETIC BIS ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({
      bank: 'BIS', opening: 100, breakChain: true, breakChainBy: 0.4,
      movements: [{ date: '2026-06-02', amount: 10 }, { date: '2026-06-03', amount: 20 }, { date: '2026-06-04', amount: 5 }],
    }),
  });
  assert.equal(small.admissible, false);
  assert.ok(small.reasons.includes('BALANCE_CHAIN_BROKEN'));

  const openingMismatch = evaluate({
    name: '040626 SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000, declaredOpeningOverride: 900,
      movements: [{ date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }],
    }),
  });
  assert.equal(openingMismatch.admissible, false);
  assert.equal(openingMismatch.amount, null);

  const noBalances = evaluate({
    name: '040626 SYNTHETIC BRIDGE ONLINE.xlsx',
    attestation: { identityAttested: true, currencyAttested: 'XOF' },
    bytes: excelStatementBytes({ bank: 'BRIDGE', opening: 900, movements: [{ date: '2026-06-03', amount: 100 }], omitBalances: true }),
  });
  assert.equal(noBalances.admissible, false);
  assert.equal(noBalances.amount, null);
});

test('un libellé d’opération ne passe jamais pour une période déclarée', () => {
  const bridge = (movementLabel?: string): StatementInput => ({
    name: '040626 SYNTHETIC BRIDGE ONLINE.xlsx',
    attestation: { identityAttested: true, currencyAttested: 'XOF' },
    bytes: excelStatementBytes({ bank: 'BRIDGE', opening: 900, movements: [{ date: '2026-06-01', amount: 100 }], movementLabel }),
  });
  for (const label of [undefined, 'SYNTHETIC DU 01/06/2026 AU 30/06/2026']) {
    const evaluation = evaluate(bridge(label));
    assert.equal(evaluation.admissible, false, String(label));
    assert.deepEqual(evaluation.reasons, ['DATE_NOT_COVERED'], String(label));
  }
  // Même piège sous l'en-tête des opérations d'un relevé ATB.
  const atbTrap: StatementInput = {
    name: '040626 SYNTHETIC ATB ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: [{ date: '2026-06-01', amount: 300 }], movementLabel: 'SYNTHETIC DU 01/06/2026 AU 30/06/2026' }),
  };
  assert.deepEqual(evaluate(atbTrap).reasons, ['DATE_NOT_COVERED']);
});

test('banque sans lecteur ou format inattendu : refus explicite', () => {
  const nsia = evaluate({ name: '040626 SYNTHETIC NSIA ONLINE.xlsx', bytes: new ArrayBuffer(8) });
  assert.deepEqual(nsia.reasons, ['NO_READER_FOR_BANK']);
  const wrongFormat = evaluate({ name: '040626 SYNTHETIC BDK ONLINE.xlsx', bytes: new ArrayBuffer(8) });
  assert.deepEqual(wrongFormat.reasons, ['FORMAT_NOT_SUPPORTED_FOR_BANK']);
  const garbage = evaluate({ name: '040626 SYNTHETIC ATB ONLINE.xls', bytes: new ArrayBuffer(8), attestation: { identityAttested: true } });
  assert.deepEqual(garbage.reasons, ['PARSER_REFUSED']);
});
