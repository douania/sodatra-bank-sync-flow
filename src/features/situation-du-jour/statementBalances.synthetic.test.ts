import assert from 'node:assert/strict';
import test from 'node:test';

import { csvStatementBytes, excelStatementBytes } from './situationSyntheticFixtures';
import type { SyntheticMovement } from './situationSyntheticFixtures';
import { buildAccountBalances, consolidateBalances, evaluateStatement } from './statementBalances';
import type { StatementInput } from './statementBalances';

const D = '2026-06-03';
const TODAY = '2026-06-08';
const evaluate = (file: StatementInput, date = D, today = TODAY) => evaluateStatement(file, date, today);

/** Attestation d'identité de l'opérateur : exigée pour tout relevé, CSV compris. */
const ATTESTED: StatementInput['attestation'] = { identityAttested: true };

function bdk(name = 'SYNTHETIC BDK ONLINE.csv', closingShift = 0, accountSuffix?: string, attestation: StatementInput['attestation'] | null = ATTESTED): StatementInput {
  return {
    name,
    attestation: attestation ?? undefined,
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

test('relevé CSV : clôture à D prouvée, devise lue dans le contenu, identité attestée par l’opérateur', () => {
  const evaluation = evaluate(bdk());
  assert.equal(evaluation.admissible, true);
  assert.equal(evaluation.amount, 1050);
  assert.equal(evaluation.balanceDate, D);
  assert.equal(evaluation.identityProof, 'OPERATOR');
  assert.equal(evaluation.currencyProof, 'CONTENT');
  assert.deepEqual(evaluation.reasons, []);
  // Le compte lu dans le contenu est montré masqué à l'opérateur, jamais en clair.
  assert.equal(typeof evaluation.accountLabel, 'string');
  assert.equal(evaluation.accountLabel!.includes('00000000000'), false);
  assert.equal(evaluation.accountKey!.includes('01401'), false);
});

test('le nom du fichier ne prouve pas la banque : sans attestation, un CSV reste à revoir', () => {
  // Le même contenu, nommé BDK ou ORA : le nom seul désigne la banque, aucun solde n'est prouvé.
  for (const name of ['SYNTHETIC BDK ONLINE.csv', 'SYNTHETIC ORA ONLINE.csv']) {
    const unattested = evaluate(bdk(name, 0, undefined, null));
    assert.equal(unattested.admissible, false, name);
    assert.equal(unattested.amount, null, name);
    assert.equal(unattested.identityProof, null, name);
    assert.equal(unattested.needsIdentityAttestation, true, name);
    assert.deepEqual(unattested.reasons, ['IDENTITY_NOT_CORROBORATED'], name);
    const balances = buildAccountBalances([unattested]);
    assert.equal(balances.every((balance) => balance.status !== 'AVAILABLE' && balance.amount === null), true, name);
    assert.equal(consolidateBalances(balances)[0].amount, null, name);
  }
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
    attestation: ATTESTED,
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-05', opening: 1000,
      movements: [{ date: '2026-06-02', amount: 100 }, { date: '2026-06-03', amount: 50 }, { date: '2026-06-01', amount: -400 }],
    }),
  });
  assert.equal(antidated.admissible, false);
  assert.ok(antidated.reasons.includes('BALANCE_CHAIN_BROKEN'));

  const csv = (overrides: { declaredClosingOverride?: number; declaredOpeningOverride?: number }) => evaluate({
    name: 'SYNTHETIC BDK ONLINE.csv',
    attestation: ATTESTED,
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

test('limite quotidienne : une période de plus de 45 jours exclut le relevé, quelle que soit son écriture', () => {
  const LONG = 'Du 01/01/2026 au 04/06/2026';
  const moves = [...ATB_MOVES, { date: '2026-06-04', amount: 1 }];
  const withHeader = (extra: { headerText?: string; headerCells?: string[]; titleCells?: string[] }) => evaluate({
    name: 'SYNTHETIC ATB ONLINE.xls',
    attestation: ATTESTED,
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: moves, ...extra }),
  });
  // Témoin : sans annonce de période, ce relevé est admissible (journée close par la ligne du 04/06).
  assert.equal(withHeader({}).admissible, true);
  const cases: Array<[string, { headerText?: string; headerCells?: string[]; titleCells?: string[] }]> = [
    ['même annonce dans deux cellules', { headerCells: [LONG, LONG] }],
    ['annonce répartie sur plusieurs cellules', { headerCells: ['Période', 'Du', '01/01/2026', 'Au', '04/06/2026'] }],
    ['années sur deux chiffres', { headerText: 'Du 01/01/26 au 04/06/26' }],
    ['préambule ressemblant à un en-tête d’opérations', { titleCells: ['Date édition', 'Solde initial', 'Solde final'], headerText: LONG }],
    ['mois en toutes lettres avec « 1er »', { headerText: 'Période du 1er janvier 2026 au 4 juin 2026' }],
    ['annonce en colonne J', { headerCells: [...new Array(9).fill(''), LONG] }],
    ['mot « période » et tiret', { headerText: 'Période : 01/01/2026 - 04/06/2026' }],
    ['deux dates reliées par un tiret, sans autre mot', { headerText: '01/01/2026 - 04/06/2026' }],
    ['mot « période » suivi de deux dates dans trois cellules', { headerCells: ['Période', '01/01/2026', '04/06/2026'] }],
    ['formule « du … au … » interrompue par une mention', { headerText: 'Relevé du 01/01/2026 (inclus) au 04/06/2026' }],
    ['deux annonces contradictoires dont une longue', { headerCells: ['Du 01/06/2026 au 04/06/2026', LONG] }],
    ['annonce à trois dates', { headerText: 'Période du 01/01/2026 au 04/06/2026, édité le 04/06/2026' }],
    ['première date sans année, en lettres', { headerText: 'Période du 1er janvier au 4 juin 2026' }],
    ['première date sans année, en chiffres', { headerText: 'Du 01/01 au 04/06/2026' }],
    ['date de début et date de fin sur deux lignes', { titleCells: ['Date début', '01/01/2026'], headerCells: ['Date fin', '04/06/2026'] }],
    ['début et fin dans une seule cellule', { headerText: 'Date début : 01/01/2026 ; date fin : 04/06/2026' }],
    ['mois et année seulement', { headerText: 'Période : janvier 2026 à juin 2026' }],
    ['année en premier, séparée par des barres', { headerText: 'Du 2026/01/01 au 2026/06/04' }],
    ['écriture anglaise', { headerText: 'From January 1, 2026 to June 4, 2026' }],
    ['formule « entre … et … »', { headerText: 'Opérations entre le 01/01/2026 et le 04/06/2026' }],
    ['préambule portant référence, date et solde', { titleCells: ['Référence relevé', 'Date édition', 'Solde initial'], headerText: LONG }],
    ['préambule en une seule cellule', { titleCells: ['Date et solde de référence'], headerText: LONG }],
    // Refus prudent assumé : toute date de l'en-tête éloignée des lignes exclut le relevé, même sans rapport avec la période.
    ['date ancienne sans rapport avec la période', { headerText: 'Compte ouvert le 15/01/2019' }],
    ['date d’édition très postérieure aux lignes', { headerText: 'Edité le 15/09/2026' }],
    // Période écrite sous une première ligne ressemblant à un en-tête d'opérations : elle compte pour le refus.
    ['période longue sous un faux en-tête d’opérations', { titleCells: ['Date', 'Montant', 'Solde'], headerText: LONG }],
  ];
  for (const [label, extra] of cases) {
    const evaluation = withHeader(extra);
    assert.equal(evaluation.admissible, false, label);
    assert.equal(evaluation.amount, null, label);
    assert.deepEqual(evaluation.reasons, ['PERIOD_OVER_DAILY_LIMIT'], label);
  }
});

test('période déclarée ambiguë ou mal formée : elle ne prouve aucune clôture', () => {
  // Dernière ligne à D : seule une période déclarée lisible sans ambiguïté peut prouver la clôture.
  const withCells = (headerCells: string[]) => evaluate({
    name: 'SYNTHETIC ATB ONLINE.xls',
    attestation: ATTESTED,
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: ATB_MOVES, headerCells }),
  });
  // Témoins : une annonce unique, écrite en entier, sur deux chiffres d'année ou répétée à l'identique.
  for (const cells of [
    ['Du 01/06/2026 au 04/06/2026'], ['Du 01/06/26 au 04/06/26'],
    ['Période', 'Du', '01/06/2026', 'Au', '04/06/2026'], ['Période : du 1er juin au 4 juin 2026'],
  ]) {
    assert.equal(withCells(cells).admissible, true, cells.join(' | '));
  }
  for (const cells of [
    ['Du 01/06/2026 au 04/06/2026', 'Du 01/06/2026 au 04/06/2026'],
    ['Du 01/06/2026 au 04/06/2026', 'Du 01/06/2026 au 05/06/2026'],
    ['Du 04/06/2026 au 01/06/2026'],
    ['Période du 01/06/2026 au 04/06/2026, édité le 05/06/2026'],
  ]) {
    const evaluation = withCells(cells);
    assert.equal(evaluation.admissible, false, cells.join(' | '));
    assert.equal(evaluation.amount, null, cells.join(' | '));
    assert.deepEqual(evaluation.reasons, ['DAY_NOT_CLOSED'], cells.join(' | '));
  }
});

test('une mention datée qui n’est pas une période ne prouve ni clôture ni couverture', () => {
  // Dernière ligne à D : seule une formule de période stricte, écrite dans le relevé, peut clore la journée.
  const withHeader = (extra: { headerText?: string; headerCells?: string[] }, movements = ATB_MOVES, date = D) => evaluate({
    name: 'SYNTHETIC ATB ONLINE.xls',
    attestation: ATTESTED,
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements, ...extra }),
  }, date);
  // Témoin : la formule stricte prouve la clôture.
  assert.equal(withHeader({ headerText: 'Du 02/06/2026 au 04/06/2026' }).admissible, true);
  // Témoins : un préambule sans montant, ou tenu dans une seule cellule, n'est pas l'en-tête des opérations ;
  // la formule stricte écrite dessous reste donc lue comme preuve.
  for (const titleCells of [['Référence relevé', 'Date édition', 'Solde initial'], ['Date, montant et solde de référence']]) {
    const preamble = evaluate({
      name: 'SYNTHETIC ATB ONLINE.xls',
      attestation: ATTESTED,
      bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: ATB_MOVES, titleCells, headerText: 'Du 02/06/2026 au 04/06/2026' }),
    });
    assert.equal(preamble.admissible, true, titleCells.join(' | '));
    assert.equal(preamble.amount, 5180, titleCells.join(' | '));
  }
  const traps: Array<{ headerText?: string; headerCells?: string[] }> = [
    { headerText: 'Relevé de compte au 03/06/2026, prochain arrêté 04/06/2026' },
    { headerText: 'Extrait de compte - solde au 03/06/2026 - date de valeur 04/06/2026' },
    { headerText: 'Date opération - date valeur : 03/06/2026 - 04/06/2026' },
    { headerText: 'Solde de la veille 02/06/2026 ; mise à jour prévue au 04/06/2026' },
    { headerCells: ['Date de valeur', '02/06/2026', 'Echéance au', '04/06/2026'] },
    { headerText: 'Réf. dossier 02-06-26 - 04-06-26' },
    { headerText: 'Extrait de compte généré le 02/06/2026 ; validité du code au 04/06/2026' },
    { headerCells: ['Date de dernière connexion', '02/06/2026', 'Session valable jusqu’au', '04/06/2026'] },
    { headerText: 'Période de validité du certificat : 02/06/2026 ; expire le 04/06/2026' },
    { headerText: '02/06/2026 - 04/06/2026' },
    { headerText: 'Date de valeur 02/06/2026 au 04/06/2026' },
    { headerText: 'Du 02/06/2026, prochain arrêté 04/06/2026' },
    { headerText: 'Du 02/06/2026 au 04/06/2026 sous réserve' },
    // Le libellé qui dit ce qu'est la plage est dans la même cellule…
    { headerText: 'Valeur du 02/06/2026 au 04/06/2026' },
    { headerText: 'Période précédente : du 02/06/2026 au 04/06/2026' },
    // … ou dans une cellule voisine de la même ligne.
    { headerCells: ['Validité de la session', 'du 02/06/2026 au 04/06/2026'] },
    { headerCells: ['Prochain relevé', 'du 02/06/2026 au 04/06/2026'] },
    { headerCells: ['Autorisation de découvert', 'du 02/06/2026 au 04/06/2026', 'taux 12 %'] },
    { headerCells: ['du 02/06/2026 au 04/06/2026', '(validité)'] },
  ];
  for (const trap of traps) {
    const label = trap.headerText ?? trap.headerCells!.join(' | ');
    const evaluation = withHeader(trap);
    assert.equal(evaluation.admissible, false, label);
    assert.equal(evaluation.amount, null, label);
    assert.deepEqual(evaluation.reasons, ['DAY_NOT_CLOSED'], label);
  }
  // Une autre date écrite dans l'en-tête (ici la date d'édition, égale à D) retire à la période sa valeur de preuve.
  const editedOnD = evaluate({
    name: 'SYNTHETIC ATB ONLINE.xls',
    attestation: ATTESTED,
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: ATB_MOVES, titleCells: ['Edité le 03/06/2026'], headerText: 'Du 02/06/2026 au 04/06/2026' }),
  });
  assert.equal(editedOnD.admissible, false);
  assert.equal(editedOnD.amount, null);
  assert.deepEqual(editedOnD.reasons, ['DAY_NOT_CLOSED']);
  // Une formule stricte écrite SOUS une première ligne d'en-tête d'opérations ne prouve rien.
  const belowHeader = evaluate({
    name: 'SYNTHETIC ATB ONLINE.xls',
    attestation: ATTESTED,
    bytes: excelStatementBytes({ bank: 'ATB', opening: 5000, movements: ATB_MOVES, titleCells: ['Date', 'Montant', 'Solde'], headerText: 'Du 02/06/2026 au 04/06/2026' }),
  });
  assert.equal(belowHeader.admissible, false);
  assert.equal(belowHeader.amount, null);
  assert.ok(belowHeader.reasons.includes('DAY_NOT_CLOSED'));
  // Jour sans mouvement : la même mention ne prouve pas davantage la couverture de D.
  const carried = withHeader({ headerText: 'Compte de dépôt ouvert le 01/06/2026 ; prochaine échéance au 04/06/2026' }, [{ date: '2026-06-01', amount: 300 }]);
  assert.equal(carried.admissible, false);
  assert.equal(carried.amount, null);
  assert.ok(carried.reasons.includes('DATE_NOT_COVERED'));
  // Une période écrite au mois près ne désigne aucun jour : elle ne prouve pas la clôture du 31/05.
  const monthly = withHeader({ headerText: 'De mai 2026 au juin 2026' }, [{ date: '2026-05-30', amount: 300 }, { date: '2026-05-31', amount: -120 }], '2026-05-31');
  assert.equal(monthly.admissible, false);
  assert.deepEqual(monthly.reasons, ['DAY_NOT_CLOSED']);
  assert.equal(withHeader({ headerText: 'Du 30/05/2026 au 01/06/2026' }, [{ date: '2026-05-30', amount: 300 }, { date: '2026-05-31', amount: -120 }], '2026-05-31').admissible, true);
});

test('relevé CSV : la période déclarée doit être ordonnée et englober les lignes', () => {
  const csv = (periodStart: string, periodEnd: string, movements: SyntheticMovement[]) => evaluate({
    name: 'SYNTHETIC BDK ONLINE.csv',
    attestation: ATTESTED,
    bytes: csvStatementBytes({ periodStart, periodEnd, opening: 1000, movements }),
  });
  const moves = [{ date: '2026-06-02', amount: 200 }, { date: D, amount: -50 }];
  assert.equal(csv('2026-06-01', '2026-06-04', moves).admissible, true);
  // Lignes étalées sur plus de 45 jours sous une période déclarée de quatre jours.
  const spread = csv('2026-06-01', '2026-06-04', [{ date: '2026-01-05', amount: 10 }, ...moves]);
  assert.equal(spread.admissible, false);
  assert.equal(spread.amount, null);
  assert.ok(spread.reasons.includes('PERIOD_OVER_DAILY_LIMIT'));
  // Lignes sur deux jours sous une période déclarée de plus de 45 jours.
  const longDeclared = csv('2026-01-01', '2026-06-04', moves);
  assert.equal(longDeclared.admissible, false);
  assert.deepEqual(longDeclared.reasons, ['PERIOD_OVER_DAILY_LIMIT']);
  // Une ligne hors de la période déclarée, puis une période inversée.
  for (const evaluation of [csv('2026-06-03', '2026-06-04', moves), csv('2026-06-04', '2026-06-01', moves)]) {
    assert.equal(evaluation.admissible, false);
    assert.equal(evaluation.amount, null);
    assert.ok(evaluation.reasons.includes('STATEMENT_NEEDS_REVIEW'));
  }
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

  // Un seul des deux comptes est admissible (l'autre n'est pas attesté) : son solde ne vaut pas pour la banque.
  const oneAdmissible = [evaluate(bdk()), evaluate(bdk('AUTRE COMPTE BDK ONLINE.csv', 0, '77', null))];
  assert.deepEqual(oneAdmissible.map((evaluation) => evaluation.admissible), [true, false]);
  const lone = buildAccountBalances(oneAdmissible).find((balance) => balance.bank === 'BDK')!;
  assert.equal(lone.status, 'TO_REVIEW');
  assert.equal(lone.amount, null);
  assert.deepEqual(lone.reasons, ['SEVERAL_ACCOUNTS_FOR_BANK']);
});

test('deux comptes qui ne partagent que leurs derniers chiffres restent deux comptes', () => {
  const older = (accountPrefix?: string): StatementInput => ({
    name: 'ANCIEN BDK ONLINE.csv',
    attestation: ATTESTED,
    bytes: csvStatementBytes({ periodStart: '2026-05-20', periodEnd: '2026-05-22', opening: 70, accountPrefix, movements: [{ date: '2026-05-20', amount: 5 }] }),
  });
  // Témoin : même compte, un relevé plus ancien qui ne couvre pas D est simplement écarté.
  const sameAccount = buildAccountBalances([evaluate(bdk()), evaluate(older())]).find((balance) => balance.bank === 'BDK')!;
  assert.equal(sameAccount.status, 'AVAILABLE');
  assert.equal(sameAccount.amount, 1050);
  assert.deepEqual(sameAccount.sources.map((source) => source.role), ['retained', 'excluded']);
  // Même compte exporté sans sa ligne IBAN : toujours le même compte, compté une fois.
  const withoutIban: StatementInput = {
    name: 'SANS IBAN BDK ONLINE.csv',
    attestation: ATTESTED,
    bytes: csvStatementBytes({
      periodStart: '2026-06-01', periodEnd: '2026-06-04', opening: 1000, withIban: false,
      movements: [{ date: '2026-06-01', amount: -100 }, { date: '2026-06-02', amount: 200 }, { date: '2026-06-03', amount: -50 }],
    }),
  };
  const twoExports = [evaluate(bdk()), evaluate(withoutIban)];
  assert.equal(twoExports[0].accountKey, twoExports[1].accountKey);
  const merged = buildAccountBalances(twoExports).find((balance) => balance.bank === 'BDK')!;
  assert.equal(merged.status, 'AVAILABLE');
  assert.deepEqual(merged.sources.map((source) => source.role), ['retained', 'duplicate']);
  // Autre compte terminé par les mêmes chiffres : le solde du premier ne vaut pas pour la banque.
  const collision = buildAccountBalances([evaluate(bdk()), evaluate(older('09999'))]).find((balance) => balance.bank === 'BDK')!;
  assert.equal(collision.status, 'TO_REVIEW');
  assert.equal(collision.amount, null);
  assert.deepEqual(collision.reasons, ['SEVERAL_ACCOUNTS_FOR_BANK']);
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
    attestation: ATTESTED,
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
    attestation: ATTESTED,
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
