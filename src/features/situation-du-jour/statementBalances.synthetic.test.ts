import assert from 'node:assert/strict';
import test from 'node:test';

import { csvStatementBytes, excelStatementBytes } from './situationSyntheticFixtures';
import type { SyntheticMovement } from './situationSyntheticFixtures';
import { buildAccountBalances, consolidateBalances, evaluateStatement } from './statementBalances';
import type { StatementInput } from './statementBalances';

const D = '2026-06-03';
const TODAY = '2026-06-08';
const evaluate = (file: StatementInput, date = D, today = TODAY) => evaluateStatement(file, date, today);

function bdk(name = 'SYNTHETIC BDK ONLINE.csv', closingShift = 0, accountSuffix?: string): StatementInput {
  return {
    name,
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000, accountSuffix,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 + closingShift }],
    }),
  };
}

const ATB_MOVES: SyntheticMovement[] = [{ date: '2026-06-02', amount: 300 }, { date: '2026-06-03', amount: -120 }];
/** En-tête portant une période déclarée qui se termine après D : preuve de clôture issue du relevé. */
const ATB_HEADER = 'De 01 juin 2026 au 04 juin 2026';
const NO_HEADER = '';

function atb(
  attestation?: StatementInput['attestation'],
  headerText: string | undefined = ATB_HEADER,
  movements = ATB_MOVES,
  name = 'SYNTHETIC ATB ONLINE.xls',
  opening = 5000,
): StatementInput {
  return { name, attestation, bytes: excelStatementBytes({ bank: 'ATB', opening, movements, headerText }) };
}

function bridge(attestation: StatementInput['attestation'], movements: SyntheticMovement[], extra: { movementLabel?: string; omitBalances?: boolean } = {}): StatementInput {
  return { name: 'SYNTHETIC BRIDGE ONLINE.xlsx', attestation, bytes: excelStatementBytes({ bank: 'BRIDGE', opening: 900, movements, ...extra }) };
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
  const moves = [{ date: D, amount: 100 }, { date: '2026-06-04', amount: 1 }];
  const identityOnly = evaluate(bridge({ identityAttested: true }, moves));
  assert.equal(identityOnly.admissible, false);
  assert.deepEqual(identityOnly.reasons, ['CURRENCY_NOT_CORROBORATED']);
  assert.equal(evaluate(bridge({ identityAttested: true, currencyAttested: 'EUR' }, moves)).admissible, false);
  const both = evaluate(bridge({ identityAttested: true, currencyAttested: 'XOF' }, moves));
  assert.equal(both.admissible, true);
  assert.equal(both.amount, 1000);
  assert.equal(both.currencyProof, 'OPERATOR');
});

test('clôture : la preuve vient du relevé, jamais du nom du fichier', () => {
  // Dernière ligne à D, aucune période déclarée : renommer le fichier à D+1 ne prouve rien.
  for (const name of ['SYNTHETIC ATB ONLINE.xls', '040626 SYNTHETIC ATB ONLINE.xls', '050626 SYNTHETIC ATB ONLINE.xls']) {
    const renamed = evaluate(atb({ identityAttested: true }, NO_HEADER, ATB_MOVES, name));
    assert.equal(renamed.admissible, false, name);
    assert.equal(renamed.amount, null, name);
    assert.deepEqual(renamed.reasons, ['DAY_NOT_CLOSED'], name);
  }
  // Preuve issue du relevé : période déclarée se terminant après D…
  assert.equal(evaluate(atb({ identityAttested: true })).admissible, true);
  // … ou journée ultérieure raccordée à la chaîne.
  const laterDay = evaluate(atb({ identityAttested: true }, NO_HEADER, [...ATB_MOVES, { date: '2026-06-04', amount: 1 }]));
  assert.equal(laterDay.admissible, true);
  assert.equal(laterDay.amount, 5180);
  // Période déclarée se terminant à D : la journée n'est pas close.
  const endsAtD = evaluate(atb({ identityAttested: true }, 'De 01 juin 2026 au 03 juin 2026'));
  assert.deepEqual(endsAtD.reasons, ['DAY_NOT_CLOSED']);
  // Période déclarée se terminant après aujourd'hui : une date future ne prouve aucune clôture.
  const futureEnd = evaluate(atb({ identityAttested: true }, 'De 01 juin 2026 au 30 juin 2026'), D, '2026-06-04');
  assert.equal(futureEnd.admissible, false);
  assert.deepEqual(futureEnd.reasons, ['DAY_NOT_CLOSED']);
});

test('journée non close : jour du relevé, jour en cours, ligne datée après aujourd’hui', () => {
  const sameDay = evaluate(bdk(), '2026-06-04');
  assert.equal(sameDay.admissible, false);
  assert.ok(sameDay.reasons.includes('DAY_NOT_CLOSED'));
  // D = aujourd'hui : la journée en cours n'est jamais close.
  const todayIsD = evaluate(atb({ identityAttested: true }), D, D);
  assert.equal(todayIsD.admissible, false);
  assert.deepEqual(todayIsD.reasons, ['DAY_NOT_CLOSED']);
  // Une ligne datée après aujourd'hui rend le relevé incohérent et ne prouve aucune clôture.
  const lineAfterToday = evaluate(atb({ identityAttested: true }, NO_HEADER, [{ date: D, amount: 300 }, { date: '2026-06-20', amount: 5 }]), D, '2026-06-04');
  assert.equal(lineAfterToday.admissible, false);
  assert.equal(lineAfterToday.amount, null);
  assert.deepEqual(lineAfterToday.reasons, ['STATEMENT_NEEDS_REVIEW']);
});

test('rupture de solde : exclue où qu’elle soit dans le relevé, au centime près', () => {
  const bis = (movements: SyntheticMovement[], breakChain: boolean, breakChainBy?: number): StatementInput => ({
    name: 'SYNTHETIC BIS ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({ bank: 'BIS', opening: 100, movements, breakChain, breakChainBy }),
  });
  const moves = [{ date: '2026-06-02', amount: 10 }, { date: '2026-06-03', amount: 20 }, { date: '2026-06-04', amount: 5 }];
  // Témoin : la même forme sans rupture est admissible.
  const sound = evaluate(bis(moves, false));
  assert.equal(sound.admissible, true);
  assert.equal(sound.amount, 130);
  // Rupture sur la journée qui SUIT D.
  const brokenAfter = evaluate(bis(moves, true));
  assert.equal(brokenAfter.admissible, false);
  assert.equal(brokenAfter.amount, null);
  assert.deepEqual(brokenAfter.reasons, ['BALANCE_CHAIN_BROKEN']);
  // Rupture de 0,4 : aucune tolérance sur une chaîne de soldes.
  assert.deepEqual(evaluate(bis(moves, true, 0.4)).reasons, ['BALANCE_CHAIN_BROKEN']);
  // Rupture sur D elle-même.
  assert.ok(evaluate(bis(moves.slice(0, 2), true)).reasons.includes('BALANCE_CHAIN_BROKEN'));
});

test('ligne antidatée, solde déclaré faux, soldes courants absents : relevé écarté', () => {
  const antidated = evaluate({
    name: 'SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-05', opening: 1000,
      movements: [{ date: '2026-06-02', amount: 100 }, { date: '2026-06-03', amount: 50 }, { date: '2026-06-01', amount: -400 }],
    }),
  });
  assert.equal(antidated.admissible, false);
  assert.ok(antidated.reasons.includes('BALANCE_CHAIN_BROKEN'));

  const csv = (overrides: { declaredClosingOverride?: number; declaredOpeningOverride?: number }) => evaluate({
    name: 'SYNTHETIC BDK ONLINE.csv',
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000, ...overrides,
      movements: [{ date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }],
    }),
  });
  assert.equal(csv({}).admissible, true);
  assert.deepEqual(csv({ declaredClosingOverride: 4242 }).reasons, ['STATEMENT_NEEDS_REVIEW']);
  const openingMismatch = csv({ declaredOpeningOverride: 900 });
  assert.equal(openingMismatch.admissible, false);
  assert.equal(openingMismatch.amount, null);

  const noBalances = evaluate(bridge({ identityAttested: true, currencyAttested: 'XOF' }, [{ date: D, amount: 100 }, { date: '2026-06-04', amount: 1 }], { omitBalances: true }));
  assert.equal(noBalances.admissible, false);
  assert.equal(noBalances.amount, null);
});

test('limite quotidienne : période des lignes ou période déclarée de plus de 45 jours', () => {
  const byLines = evaluate({
    name: 'SYNTHETIC BIS ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({ bank: 'BIS', opening: 100, movements: [{ date: '2026-01-05', amount: 10 }, { date: '2026-06-03', amount: 20 }, { date: '2026-06-04', amount: 1 }] }),
  });
  assert.deepEqual(byLines.reasons, ['PERIOD_OVER_DAILY_LIMIT']);
  // Les lignes couvrent deux jours, mais la période déclarée dans l'en-tête dépasse 45 jours.
  const byDeclaration = evaluate(atb({ identityAttested: true }, 'Du 01/01/2026 au 04/06/2026'));
  assert.equal(byDeclaration.admissible, false);
  assert.deepEqual(byDeclaration.reasons, ['PERIOD_OVER_DAILY_LIMIT']);
});

test('doublon : le même contenu déposé deux fois n’est compté qu’une fois', () => {
  const balances = buildAccountBalances([evaluate(bdk()), evaluate(bdk('COPIE BDK ONLINE.csv'))]);
  const account = balances.find((balance) => balance.bank === 'BDK')!;
  assert.equal(account.status, 'AVAILABLE');
  assert.equal(account.amount, 1050);
  assert.deepEqual(account.sources.map((source) => source.role).sort(), ['duplicate', 'retained']);
  assert.equal(consolidateBalances(balances)[0].amount, 1050);
});

test('deux comptes distincts ou une identité indécidable pour une banque : à revoir, hors sous-total', () => {
  // Deux CSV de la même banque, même date, même montant, mais deux numéros de compte différents.
  const twoAccounts = buildAccountBalances([evaluate(bdk()), evaluate(bdk('AUTRE COMPTE BDK ONLINE.csv', 0, '77'))]);
  const bdkAccount = twoAccounts.find((balance) => balance.bank === 'BDK')!;
  assert.equal(bdkAccount.status, 'TO_REVIEW');
  assert.equal(bdkAccount.amount, null);
  assert.deepEqual(bdkAccount.reasons, ['SEVERAL_ACCOUNTS_FOR_BANK']);
  assert.equal(consolidateBalances(twoAccounts)[0].status, 'UNAVAILABLE');

  // Deux relevés Excel attestés au contenu différent : aucune identité commune ne les relie.
  const twoExcel = buildAccountBalances([
    evaluate(atb({ identityAttested: true })),
    evaluate(atb({ identityAttested: true }, ATB_HEADER, ATB_MOVES, 'SECOND ATB ONLINE.xls', 9000)),
  ]);
  const atbAccount = twoExcel.find((balance) => balance.bank === 'ATB')!;
  assert.equal(atbAccount.status, 'TO_REVIEW');
  assert.deepEqual(atbAccount.reasons, ['SEVERAL_ACCOUNTS_FOR_BANK']);
  assert.equal(consolidateBalances(twoExcel)[0].amount, null);
});

test('même relevé déposé sous deux banques : aucun des deux n’est compté', () => {
  const sameBytes = buildAccountBalances([evaluate(bdk()), evaluate(bdk('SYNTHETIC ORA ONLINE.csv'))]);
  for (const bank of ['BDK', 'ORA'] as const) {
    const account = sameBytes.find((balance) => balance.bank === bank)!;
    assert.equal(account.status, 'TO_REVIEW', bank);
    assert.equal(account.amount, null, bank);
    assert.deepEqual(account.reasons, ['SAME_STATEMENT_UNDER_SEVERAL_BANKS'], bank);
  }
  assert.equal(consolidateBalances(sameBytes)[0].amount, null);

  // Même compte, contenu différent (autre export) : toujours un conflit.
  const sameAccount = buildAccountBalances([evaluate(bdk()), evaluate(bdk('SYNTHETIC ORA ONLINE.csv', 7))]);
  assert.equal(sameAccount.find((balance) => balance.bank === 'ORA')!.status, 'TO_REVIEW');
  assert.equal(consolidateBalances(sameAccount)[0].amount, null);

  // Deux comptes distincts sous deux banques : les deux soldes sont comptés.
  const ora: StatementInput = {
    name: 'SYNTHETIC ORA ONLINE.csv',
    bytes: csvStatementBytes({ periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 300, accountSuffix: '11', movements: [{ date: D, amount: 25 }] }),
  };
  assert.equal(consolidateBalances(buildAccountBalances([evaluate(bdk()), evaluate(ora)]))[0].amount, 1050 + 325);
});

test('conflit : deux relevés contradictoires du même compte sont signalés et exclus', () => {
  const balances = buildAccountBalances([evaluate(bdk()), evaluate(bdk('AUTRE EXPORT BDK ONLINE.csv', 5))]);
  const account = balances.find((balance) => balance.bank === 'BDK')!;
  assert.equal(account.status, 'TO_REVIEW');
  assert.equal(account.amount, null);
  assert.deepEqual(account.reasons, ['CONFLICTING_STATEMENTS']);
  assert.deepEqual(account.sources.map((source) => source.role), ['conflict', 'conflict']);
  assert.equal(consolidateBalances(balances)[0].status, 'UNAVAILABLE');
});

test('sous-total PARTIEL par devise avec les comptes manquants nommés', () => {
  const balances = buildAccountBalances([evaluate(bdk()), evaluate(atb({ identityAttested: true }))]);
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

test('date non couverte : jamais de solde', () => {
  const before = evaluate(bdk(), '2026-05-20');
  assert.equal(before.admissible, false);
  assert.ok(before.reasons.includes('DATE_NOT_COVERED'));
});

test('jour sans mouvement : report seulement si la couverture est prouvée', () => {
  const csv: StatementInput = {
    name: 'SYNTHETIC ORA ONLINE.csv',
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
  const uncovered = evaluate(atb({ identityAttested: true }, NO_HEADER, single));
  assert.equal(uncovered.admissible, false);
  assert.ok(uncovered.reasons.includes('DATE_NOT_COVERED'));
  // La même forme avec une période déclarée dans l'en-tête : D est couverte et close.
  const declared = evaluate(atb({ identityAttested: true }, ATB_HEADER, single));
  assert.equal(declared.admissible, true);
  assert.equal(declared.amount, 5300);
  assert.equal(declared.balanceDate, '2026-06-01');
});

test('période déclarée d’un relevé Excel : formule exacte et englobant les lignes', () => {
  const single = [{ date: '2026-06-01', amount: 300 }];
  const withHeader = (headerText: string) => evaluate(atb({ identityAttested: true }, headerText, single));
  // Témoins : les deux formules de période reconnues.
  assert.equal(withHeader('Période : Du 01/06/2026 au 04/06/2026').admissible, true);
  assert.equal(withHeader(ATB_HEADER).admissible, true);
  // Deux dates sans formule de période, ou une période qui n'englobe pas les lignes : aucune preuve.
  for (const header of ['Compte ouvert le 01/06/2026, situation au 04/06/2026', 'Du 02/06/2026 au 04/06/2026']) {
    const evaluation = withHeader(header);
    assert.equal(evaluation.admissible, false, header);
    assert.equal(evaluation.amount, null, header);
    assert.ok(evaluation.reasons.includes('DATE_NOT_COVERED'), header);
  }
});

test('un libellé d’opération ne passe jamais pour une période déclarée', () => {
  const trap = 'SYNTHETIC DU 01/06/2026 AU 30/06/2026';
  for (const label of [undefined, trap]) {
    const evaluation = evaluate(bridge({ identityAttested: true, currencyAttested: 'XOF' }, [{ date: '2026-06-01', amount: 100 }], { movementLabel: label }));
    assert.equal(evaluation.admissible, false, String(label));
    assert.ok(evaluation.reasons.includes('DATE_NOT_COVERED'), String(label));
  }
  // Même piège sous l'en-tête des opérations d'un relevé ATB.
  const atbTrap: StatementInput = {
    name: 'SYNTHETIC ATB ONLINE.xls',
    attestation: { identityAttested: true },
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: [{ date: '2026-06-01', amount: 300 }], movementLabel: trap }),
  };
  const trapped = evaluate(atbTrap);
  assert.equal(trapped.admissible, false);
  assert.ok(trapped.reasons.includes('DATE_NOT_COVERED'));
});

test('banque sans lecteur ou format inattendu : refus explicite', () => {
  const nsia = evaluate({ name: 'SYNTHETIC NSIA ONLINE.xlsx', bytes: new ArrayBuffer(8) });
  assert.deepEqual(nsia.reasons, ['NO_READER_FOR_BANK']);
  const wrongFormat = evaluate({ name: 'SYNTHETIC BDK ONLINE.xlsx', bytes: new ArrayBuffer(8) });
  assert.deepEqual(wrongFormat.reasons, ['FORMAT_NOT_SUPPORTED_FOR_BANK']);
  const garbage = evaluate({ name: 'SYNTHETIC ATB ONLINE.xls', bytes: new ArrayBuffer(8), attestation: { identityAttested: true } });
  assert.deepEqual(garbage.reasons, ['PARSER_REFUSED']);
});
