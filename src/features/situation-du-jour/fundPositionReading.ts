// Volet « Fund Position » : lecture cellule par cellule de l'onglet du jour,
// utilisée comme RÉFÉRENCE COMPARATIVE seulement (son import n'est pas
// réactivé). Les valeurs déclarées et les valeurs recalculées restent
// distinctes. Une cellule absente ou ambiguë est signalée par un code et une
// adresse de cellule, sans jamais recopier le contenu d'une ligne source.
import {
  SITUATION_BANKS,
  SODATRA_CONVENTION,
  amountsEqual,
  cellAddress,
  cellAt,
  cellNumber,
  cellText,
  daysBetween,
  detectBankFromStrictLabel,
  cellIsoDate,
  establishWithConvention,
  findDatesInText,
  findUnreadableDates,
  hiddenSheetNames,
  normalizeLabel,
  plainUpper,
  readExplicitFields,
  readWorkbook,
  sheetNameToIso,
  tokenize,
  usefulBounds,
} from './situationCore';
import type { AmountUnit, FieldProvenance, FieldState, Sheet, SituationBank } from './situationCore';
import type { AccountBalance } from './statementBalances';
import type { WorkbookEncours } from './monthlyWorkbook';

export type FundPositionReason = 'WORKBOOK_UNREADABLE' | 'TAB_ABSENT' | 'TAB_AMBIGUOUS' | 'HEADER_NOT_FOUND';

export const FUND_POSITION_REASON_LABELS: Record<FundPositionReason, string> = {
  WORKBOOK_UNREADABLE: 'Classeur Fund Position illisible',
  TAB_ABSENT: 'Aucun onglet daté après la date comptable',
  TAB_AMBIGUOUS: 'Plusieurs onglets portent la même date',
  HEADER_NOT_FOUND: 'En-tête de la Fund Position introuvable ou ambigu dans l’onglet',
};

export type FundPositionIssueCode =
  | 'CELL_ABSENT'
  | 'CELL_NOT_NUMERIC'
  | 'BANK_ROW_AMBIGUOUS'
  | 'BANK_LABEL_UNKNOWN'
  | 'DECLARED_NET_DIFFERS_FROM_RECALCULATED'
  | 'DECLARED_TOTAL_DIFFERS_FROM_RECALCULATED';

export interface FundPositionIssue {
  code: FundPositionIssueCode;
  /** Adresse de cellule (ex. « C4 ») ; jamais le contenu de la ligne. */
  address: string;
  bank: SituationBank | null;
}

export interface FundPositionCell {
  address: string;
  /** `null` : cellule absente ou non numérique. `0` : zéro explicitement saisi. */
  value: number | null;
}

export interface FundPositionBankRow {
  bank: SituationBank;
  rowNumber: number;
  declared: {
    bankBalance: FundPositionCell;
    fundApplied: FundPositionCell;
    netBalance: FundPositionCell;
    nonValidatedDeposit: FundPositionCell;
    position: FundPositionCell;
  };
  recalculated: {
    /** Bank Balance − Fund Applied, quand les deux sont présents. */
    netBalance: number | null;
    /** Net recalculé + NonValidated Deposit. */
    position: number | null;
  };
}

export interface FundPositionReading {
  available: boolean;
  reason: FundPositionReason | null;
  tabName: string | null;
  tabDate: string | null;
  /**
   * Date de situation ÉTABLIE : le champ explicite « Situation au » quand il est valide ; sinon, quand ce
   * champ est absent, la date comptable CONFIRMÉE par l'opérateur pour l'onglet daté du lendemain. Jamais
   * déduite du seul nom de l'onglet. `null` tant que rien ne l'établit.
   */
  referenceDate: string | null;
  /** D'où vient la date établie : le fichier, ou la confirmation de l'opérateur. */
  dateProof: 'FILE' | 'OPERATOR' | null;
  /**
   * État de la date de position dans l'onglet : champ absent, valide, invalide (répété, mal formé), ou
   * contredit par une autre date écrite dans la zone de position (en-tête et lignes des banques), par un
   * libellé de date de position qu'aucune date lisible ne suit, ou, plus bas, par un libellé de date de position qui ouvre sa cellule.
   */
  dateField: FieldState;
  /** Cellules dont la date écrite contredit la date de position (au plus quelques adresses, pour aller vérifier). */
  dateConflictCells: string[];
  /**
   * Vrai quand la confirmation de l'opérateur peut être demandée : champ « Situation au » ABSENT et onglet
   * lu daté exactement du lendemain calendaire de la date comptable.
   */
  needsDateAttestation: boolean;
  /** Devise ÉTABLIE : champ explicite « Devise », ou convention SODATRA si le champ est absent et non contredit. */
  currency: string | null;
  currencyProvenance: FieldProvenance | null;
  /** Unité ÉTABLIE : champ explicite « Unité », ou convention SODATRA si le champ est absent et non contredit. */
  unit: AmountUnit | null;
  unitProvenance: FieldProvenance | null;
  /** Vrai seulement si la date de situation établie est égale à D. */
  dateComparable: boolean;
  rows: FundPositionBankRow[];
  issues: FundPositionIssue[];
}

/**
 * Confirmation de l'opérateur, tenue en mémoire pour UN fichier : l'onglet nommé présente la situation à
 * cette date comptable. Elle ne vaut ni pour un autre onglet ni pour une autre date, et ne porte que sur
 * la date de la Fund Position.
 */
export interface FundPositionDateAttestation {
  tabName: string;
  accountingDate: string;
}

export type ComparisonStatus = 'EQUAL' | 'DIFFERENT' | 'NOT_COMPARABLE';
export type ComparisonReason = 'SOURCE_UNAVAILABLE' | 'DECLARED_ABSENT' | 'DATE_NOT_COMPARABLE' | 'CURRENCY_NOT_COMPARABLE'
  | 'UNIT_NOT_COMPARABLE';

export const FUND_POSITION_COMPARISON_REASON_LABELS: Record<ComparisonReason, string> = {
  SOURCE_UNAVAILABLE: 'source vérifiée indisponible',
  DECLARED_ABSENT: 'valeur déclarée absente',
  DATE_NOT_COMPARABLE: 'date non établie ou différente',
  CURRENCY_NOT_COMPARABLE: 'devise non établie, ou autre que XOF',
  UNIT_NOT_COMPARABLE: 'unité non établie, ou autre que francs entiers',
};

export interface FundPositionComparison {
  bank: SituationBank;
  indicator: 'BANK_BALANCE_VS_STATEMENT' | 'BANK_BALANCE_VS_WORKBOOK' | 'FUND_APPLIED_VS_WORKBOOK' | 'NON_VALIDATED_VS_WORKBOOK';
  status: ComparisonStatus;
  reason: ComparisonReason | null;
  declared: number | null;
  source: number | null;
  /** Déclaré − source, seulement quand la comparaison est possible. */
  delta: number | null;
}

export const FUND_POSITION_INDICATOR_LABELS: Record<FundPositionComparison['indicator'], string> = {
  BANK_BALANCE_VS_STATEMENT: 'Bank Balance / relevé',
  BANK_BALANCE_VS_WORKBOOK: 'Bank Balance / classeur',
  FUND_APPLIED_VS_WORKBOOK: 'Fund Applied / chèques non débités',
  NON_VALIDATED_VS_WORKBOOK: 'NonValidated Deposit / dépôts en attente',
};

const HEADERS = {
  bankBalance: 'BANK BALANCE',
  fundApplied: 'FUND APPLIED',
  netBalance: 'NET BALANCE',
  nonValidatedDeposit: 'NONVALIDATED DEPOSIT',
} as const;

const BLOCK_END = /DEPOSIT FOR THE DAY|PAYMENT FOR THE DAY|TOTAL FUND AVAILABLE/;

function unavailable(reason: FundPositionReason): FundPositionReading {
  return {
    available: false, reason, tabName: null, tabDate: null, referenceDate: null, dateProof: null, dateField: 'ABSENT', dateConflictCells: [],
    needsDateAttestation: false, currency: null, currencyProvenance: null, unit: null, unitProvenance: null, dateComparable: false,
    rows: [], issues: [],
  };
}

const REFERENCE_SCAN_ROWS = 200;
const REFERENCE_SCAN_COLUMNS = 60;

/** Mots qui disent qu'une date écrite n'est PAS la date de position : échéance, impression, valeur, validité, revue, taux. */
const NON_POSITION_DATE_WORDS: ReadonlySet<string> = new Set([
  'ECHEANCE', 'ECHEANCES', 'MATURITY', 'MATURITE', 'IMPRIME', 'IMPRIMEE', 'IMPRESSION', 'PRINTED', 'PRINT', 'EDITE', 'EDITEE', 'EDITION',
  'VALEUR', 'VALUE', 'VALIDITE', 'VALABLE', 'VALID', 'EXPIRE', 'EXPIRATION', 'REVUE', 'REVIEW', 'TAUX', 'RATE',
]);
/** « Valeur » et « value » ne libellent une date que dans « date de valeur », « value date ». */
const VALUE_DATE_WORDS: ReadonlySet<string> = new Set(['VALEUR', 'VALUE']);
/** Mots d'impression qui, lorsqu'ils gouvernent une date, la font exempter comme date d'impression. */
const PRINT_GOVERNING_WORDS: ReadonlySet<string> = new Set(['IMPRIME', 'IMPRIMEE', 'IMPRESSION', 'PRINTED', 'PRINT', 'EDITE', 'EDITEE', 'EDITION']);
/** Participes qui datent l'impression du document, quel que soit ce qui est imprimé : « Etat imprimé le », « Fund Position printed on ». */
const PRINTED_ON_WORDS: ReadonlySet<string> = new Set(['IMPRIME', 'IMPRIMEE', 'PRINTED', 'EDITE', 'EDITEE']);
/**
 * Mots qui parlent de la production du document — impression, édition, génération, export —, avec leurs
 * accords et le préfixe « ré » : « imprimé », « réimprimés », « impr. », « édition », « généré », « exporté »,
 * « printed », « print », « generated ». Lecture large : elle ne sert qu'à REFUSER (contrôle de la date
 * d'impression) ; l'exemption d'une date, elle, ne se fie qu'au mot qui la gouverne.
 */
const PRINT_WORD = /^(?:RE)?(?:IMPRIME(?:E|S|ES)?|IMPRESSIONS?|IMPR|EDITE(?:E|S|ES)?|EDITIONS?|PRINT(?:ED|ING|S)?|GENERE(?:E|S|ES)?|GENERATED|EXPORTE(?:E|S|ES)?|EXPORTED)$/;
/** Après un mot d'impression, ce qui annonce une date sans la donner : « le N/A », « : ? », « le 02-juin-2026 », « 02-Jun-2026 », « hier », « lundi ». */
const PRINT_DATING_HINT = /^\s*[0-9]|(?:(?<![A-Z])(?:LE|AU|DU|ON|AT)(?![A-Z])|[:=])\s*(?:[0-9?…-]|N\s*[/.]?\s*A(?![A-Z])|TB[ACD](?![A-Z])|NC(?![A-Z])|X{2,}|\.{2,})|(?<![A-Z])(?:HIER|YESTERDAY|TODAY|AUJOURD|LUNDI|MARDI|MERCREDI|JEUDI|VENDREDI|SAMEDI|DIMANCHE|MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY)/;
/** Un mot de liaison ou un deux-points laissé en fin de cellule : la date est attendue dans la cellule de droite. */
const DANGLING_DATE_LINK = /(?:(?<![A-Z])(?:LE|AU|DU|ON|AT)|[:=])[\s.]*$/;
/** « Date d'impression », « Print date » : la cellule annonce une date. */
const DATE_WORD = /(?<![A-Z])DATE[DE]?(?![A-Z])/;
/** Ce qui sépare deux propositions dans une cellule : tiret entouré d'espaces, point-virgule, barre. */
const CLAUSE_BREAK = /\s[-–—]\s|[;|]/;
/** Ce qui tient la place d'une date qu'on n'a pas écrite : « N/A », « TBD », « ? », « à préciser », « xx/xx/xxxx ». */
const DATE_PLACEHOLDER = /^(?:N\s*[/.]?\s*[AD]\.?|NC|TB[ACD]|\?+|-+|\.{2,}|…+|A\s+(?:PRECISER|DEFINIR|CONFIRMER|COMPLETER|RENSEIGNER)|INCONNUE?S?|NEANT|X+(?:[/.-]X+)*|(?:JJ|DD)[/.-].*)$/;
/** Mots qui nomment une facilité ou son contrat : sous le bloc des banques, le solde d'une facilité n'est pas la position. */
const FACILITY_WORDS: ReadonlySet<string> = new Set([
  'FACILITE', 'FACILITES', 'FACILITY', 'FACILITIES', 'DECOUVERT', 'DECOUVERTS', 'OVERDRAFT', 'OVERDRAFTS', 'PRET', 'PRETS', 'LOAN', 'LOANS',
  'EMPRUNT', 'EMPRUNTS', 'LIGNE', 'LIGNES', 'ESCOMPTE', 'CAUTION', 'CAUTIONS', 'GARANTIE', 'GARANTIES', 'ENCOURS', 'OUTSTANDING',
  'CONTRAT', 'CONTRATS', 'CONVENTION', 'CONVENTIONS', 'AVENANT', 'AVENANTS', 'AGREEMENT', 'AGREEMENTS',
  'CMT', 'CCT', 'DAT', 'ENGAGEMENT', 'ENGAGEMENTS',
]);
/**
 * Une facilité en complément DIRECT du mot de position : « Solde du découvert », « Solde DAT », « Situation des
 * engagements », « Soldes au titre de la facilité ». Une facilité citée plus loin (« Soldes hors facilités »,
 * « Soldes et encours », « Soldes, facilités comprises ») ne fait pas de la date celle d'une facilité.
 */
const FACILITY_COMPLEMENT = new RegExp(`(?<![A-Z])(?:SOLDES?|BALANCES?|POSITIONS?|SITUATIONS?|ETAT)\\s+(?:(?:AU\\s+TITRE\\s+)?(?:DU|DE\\s+LA|DE\\s+L['’]|DES|DE|D['’]|OF(?:\\s+THE)?)\\s*)?(?:${Array.from(FACILITY_WORDS).join('|')})(?![A-Z])`);
/** Mots qui disent une facilité mise à part ou comptée avec le reste : « découvert exclu », « hors », « y compris », « net of ». */
const SET_ASIDE_WORDS: ReadonlySet<string> = new Set([
  'HORS', 'SANS', 'EXCLU', 'EXCLUE', 'EXCLUS', 'EXCLUES', 'COMPRIS', 'COMPRISE', 'COMPRISES', 'INCLUS', 'INCLUSE', 'INCLUSES', 'NON',
  'EXCLUDED', 'EXCLUDING', 'EXCL', 'INCLUDED', 'INCLUDING', 'INCL', 'WITHOUT', 'NET',
]);
/** Annonce de note : « NB », « N.B. », « Note », « Nota bene », « Remarque », « Rappel », « P.S. ». */
const NOTE_LEAD_WORDS: ReadonlySet<string> = new Set(['NB', 'N', 'B', 'NOTE', 'NOTES', 'NOTA', 'BENE', 'REMARQUE', 'REMARQUES', 'RAPPEL', 'PS', 'P', 'S']);

/** Mots qui parlent de la position elle-même : un libellé qui en porte un n'exempte jamais sa date. */
const POSITION_DATE_WORDS: ReadonlySet<string> = new Set([
  'SOLDE', 'SOLDES', 'BALANCE', 'BALANCES', 'POSITION', 'POSITIONS', 'SITUATION', 'SITUATIONS', 'TRESORERIE', 'TREASURY',
  'ARRETE', 'ARRETEE', 'ARRETES', 'ARRETEES', 'ETAT',
]);

/** « As at », « as of » : ce qui suit est une date d'arrêté. */
const AS_AT_WORDS: ReadonlySet<string> = new Set(['AS AT', 'AS OF']);

/** Mots de liaison entre un libellé et sa date : ils ne disent pas ce que la date désigne. */
const DATE_LINK_WORDS: ReadonlySet<string> = new Set([
  'DATE', 'DATED', 'LE', 'LA', 'L', 'AU', 'DU', 'DE', 'D', 'DES', 'A', 'EN', 'ON', 'AT', 'OF', 'THE', 'JUSQU', 'UNTIL', 'TO', 'FOR', 'POUR',
  'LUNDI', 'MARDI', 'MERCREDI', 'JEUDI', 'VENDREDI', 'SAMEDI', 'DIMANCHE',
  'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY',
]);

/**
 * Un libellé qui annonce une date de position, où qu'il soit dans la cellule : « Soldes au », « Soldes
 * arrêtés au », « Bank balances as at », « Etat de trésorerie au », « Date des soldes : », « Arrêté au »,
 * « As at », « As of ».
 */
const POSITION_DATE_LABEL = /(?<![A-Z])(?:SOLDES?|BALANCES?|POSITIONS?|SITUATIONS?|TRESORERIE|TREASURY|ETAT)(?![A-Z])(?:\s+[A-Z'-]+){0,3}?\s+(?:AU|AS\s+(?:AT|OF))(?![A-Z0-9])\s*:?\s*|(?<![A-Z])DATE\s+(?:DE\s+LA\s+|DES?\s+|DU\s+|OF\s+)?(?:SOLDES?|BALANCES?|POSITIONS?|SITUATIONS?|TRESORERIE)(?![A-Z])\s*:?\s*|(?<![A-Z])ARRETEE?S?\s+AU(?![A-Z0-9])\s*:?\s*|(?<![A-Z])AS\s+(?:AT|OF)(?![A-Z0-9])\s*:?\s*/g;

/**
 * Une date écrite dans l'onglet. `iso` nul : écriture illisible (sans année). `exempt` : SON libellé la dit
 * autre chose qu'une date de position. `aboutThePosition` : son libellé parle de soldes, de position ou de
 * situation, sans nommer une facilité. `labelAddress` : la cellule où ce libellé est écrit. `printGoverned` :
 * un mot d'impression la gouverne — elle n'est admise que lisible et au moins égale à la date de position.
 */
interface ZoneDate {
  address: string;
  labelAddress: string;
  iso: string | null;
  precision: 'DAY' | 'MONTH';
  exempt: boolean;
  aboutThePosition: boolean;
  printGoverned: boolean;
}

/** Vrai si une date d'impression est lisible et au moins égale à la date de position ; au mois près, seulement si le mois est postérieur. */
function printedOnOrAfter(date: Pick<ZoneDate, 'iso' | 'precision'>, positionDate: string): boolean {
  return date.iso !== null
    && (date.precision === 'MONTH' ? date.iso.slice(0, 7) > positionDate.slice(0, 7) : date.iso >= positionDate);
}

/** Vrai si le texte porte un mot qui n'est pas un simple mot de liaison. */
function hasLabelWord(label: string): boolean {
  return tokenize(label).some((token) => !DATE_LINK_WORDS.has(token));
}

/**
 * Lecture UNIQUE du libellé d'une date, pour tous les contrôles : le libellé est la dernière proposition
 * écrite avant elle (« FUND POSITION - Imprimé le … »), un mot entre parenthèses n'y est qu'une incise
 * (« Imprimé (provisoire) le … », « Soldes (imprimé) 02/06/2026 »), et le mot qui gouverne la date est le
 * dernier écrit avant elle, mots de liaison passés.
 */
function readDateLabel(label: string): { clause: string; tokens: string[]; governing: string | null } {
  const clauses = label.replace(/\([^)]*\)/g, ' ').split(CLAUSE_BREAK).filter(hasLabelWord);
  const clause = clauses.length > 0 ? clauses[clauses.length - 1] : '';
  const tokens = tokenize(clause);
  const words = tokens.filter((token) => !DATE_LINK_WORDS.has(token));
  return { clause, tokens, governing: words.length > 0 ? words[words.length - 1] : null };
}

/**
 * Vrai si le libellé d'une date la dit autre chose qu'une date de position : le mot qui la gouverne est un
 * mot d'échéance, d'impression, de valeur, de validité, de revue ou de taux, ET le libellé ne porte aucun
 * mot de position (« Soldes en valeur au … » reste une date de position). Qu'une date d'impression ainsi
 * exemptée soit lisible et au moins égale à la date de position est contrôlé à part, pour tout l'onglet.
 */
function saysNotAPositionDate(label: string): boolean {
  const { tokens, governing } = readDateLabel(label);
  if (governing === null || !NON_POSITION_DATE_WORDS.has(governing)) return false;
  // « Etat imprimé le … », « Fund Position printed on … » : la date d'impression de l'état lui-même.
  if (PRINTED_ON_WORDS.has(governing)) return true;
  if (tokens.some((token) => POSITION_DATE_WORDS.has(token))) return false;
  return !VALUE_DATE_WORDS.has(governing) || tokens.includes('DATE');
}

/**
 * Vrai si le libellé d'une date parle de la position : sa dernière proposition porte un mot de soldes, de
 * position ou de situation — sauf le solde d'UNE facilité, seule forme qui l'identifie : la proposition porte un
 * SEUL mot de position, une facilité en est le complément DIRECT (« Solde du découvert au … »), et rien ne la
 * dit exclue ou comprise. Une facilité citée autrement — comme exclue (« Facilités exclues : solde au … »,
 * « Solde du découvert exclu, solde global au … »), avant le mot, à côté d'un autre solde, ou dans une cellule
 * voisine — ne protège pas la date. Ou bien la proposition n'écrit, après une annonce de note, que « as at »
 * ou « as of » (« NB : as at 02/06/2026 »).
 */
function saysAboutThePosition(label: string): boolean {
  const { clause, tokens } = readDateLabel(label);
  const positionWords = tokens.filter((token) => POSITION_DATE_WORDS.has(token));
  if (positionWords.length === 0) {
    return AS_AT_WORDS.has(tokens.slice(-2).join(' ')) && tokens.slice(0, -2).every((token) => NOTE_LEAD_WORDS.has(token));
  }
  const balanceOfOneFacility = positionWords.length === 1 && FACILITY_COMPLEMENT.test(clause)
    && !tokens.some((token) => SET_ASIDE_WORDS.has(token));
  return !balanceOfOneFacility;
}

/** Les dates écrites dans un texte, lisibles ou non, à leur place et dans l'ordre d'écriture. */
function writtenDates(text: string): Array<{ index: number; length: number; iso: string | null; precision: 'DAY' | 'MONTH' }> {
  return [
    ...findDatesInText(text).map((entry) => ({ index: entry.index, length: entry.length, iso: entry.iso as string | null, precision: entry.precision })),
    ...findUnreadableDates(text).map((entry) => ({ index: entry.index, length: entry.length, iso: null, precision: 'DAY' as const })),
  ].sort((a, b) => a.index - b.index);
}

/**
 * Toutes les dates écrites dans les lignes `firstRow` à `lastRow`, chacune rattachée à SON libellé : ce
 * qui est écrit entre la date précédente de la cellule et elle ; pour la première date d'une cellule qui
 * n'a pas de mot à elle, et pour une cellule date, ce que la cellule de gauche écrit après sa dernière
 * date. Un mot placé ailleurs ne libelle pas la date : dans « Soldes au 02/06/2026 – imprimé le
 * 04/06/2026 », seule la seconde est une date d'impression.
 */
function datesWrittenInRows(sheet: Sheet, firstRow: number, lastRow: number, lastColumn: number): ZoneDate[] {
  const dates: ZoneDate[] = [];
  // Une date d'impression est exemptée ici comme date de position ; qu'elle soit lisible et au moins égale à
  // la date de position est contrôlé pour tout l'onglet par `printMentionsWithoutAnAdmissibleDate`.
  const read = (label: string) => {
    const { governing } = readDateLabel(label);
    return {
      exempt: saysNotAPositionDate(label),
      aboutThePosition: saysAboutThePosition(label),
      printGoverned: governing !== null && PRINT_GOVERNING_WORDS.has(governing),
    };
  };
  for (let row = firstRow; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const address = cellAddress(row, column);
      const cell = cellAt(sheet, row, column);
      const text = cellText(cell);
      const cellDate = cellIsoDate(cell);
      const written = writtenDates(text);
      if (!cellDate && written.length === 0) continue;
      const left = column > 1 ? cellText(cellAt(sheet, row, column - 1)) : '';
      const leftLabel = plainUpper(left).slice(writtenDates(left).reduce((end, entry) => Math.max(end, entry.index + entry.length), 0));
      const leftAddress = hasLabelWord(leftLabel) ? cellAddress(row, column - 1) : address;
      if (cellDate) dates.push({ address, labelAddress: leftAddress, iso: cellDate, precision: 'DAY', ...read(leftLabel) });
      const plain = plainUpper(text);
      written.forEach((entry, position) => {
        const previousEnd = position === 0 ? 0 : written[position - 1].index + written[position - 1].length;
        const own = plain.slice(previousEnd, entry.index);
        const fromLeft = position === 0 && !hasLabelWord(own);
        const label = fromLeft ? `${leftLabel} ${own}` : own;
        dates.push({ address, labelAddress: fromLeft ? leftAddress : address, iso: entry.iso, precision: entry.precision, ...read(label) });
      });
    }
  }
  return dates;
}

/**
 * Mentions d'impression ou d'édition du document dont la date n'est pas établie au moins égale à la date de
 * position, dans tout l'onglet. Pour chaque mot d'impression :
 * - une date écrite après lui dans la cellule doit être lisible et au moins égale à la date de position (au
 *   mois près : un mois postérieur), sinon la cellule bloque : « Imprimé le 02/06/2026 », « Imprimé par A. le
 *   02/06/2026 », « Imprimé le 2 juin » ;
 * - s'il termine la cellule, seul ou suivi d'un mot de liaison (« Imprimé le », « Print date: »), la date est
 *   celle de la première cellule non vide à droite ; un mot de liaison que ne suit aucune date bloque ;
 * - sans date après lui, ce qui annonce une date sans la donner bloque : « Imprimé le N/A », « Print date:
 *   TBD », « Imprimé le 02-juin-2026 », « Imprimé hier », « Imprimé lundi » ; de même une date écrite avant
 *   lui dans la cellule, si elle n'est pas admissible : « Le 02/06/2026, imprimé par A. » ;
 * - un libellé ordinaire (« Frais d'impression », « Edition », « Exporté depuis SAGE ») ne date rien.
 * La cellule signalée est celle de la date fautive, sinon celle du mot.
 */
function printMentionsWithoutAnAdmissibleDate(sheet: Sheet, lastRow: number, lastColumn: number, positionDate: string): string[] {
  const cells: string[] = [];
  const admissible = (date: Pick<ZoneDate, 'iso' | 'precision'>) => printedOnOrAfter(date, positionDate);
  for (let row = 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const text = cellText(cellAt(sheet, row, column));
      if (!text) continue;
      const plain = plainUpper(text);
      const words = Array.from(plain.matchAll(/[A-Z0-9]+/g)).filter((word) => PRINT_WORD.test(word[0]));
      if (words.length === 0) continue;
      const written = writtenDates(text);
      for (const word of words) {
        // Ce qui suit le mot, incises entre parenthèses retirées (« Imprimé (provisoire) » termine sa cellule).
        const rest = plain.slice((word.index as number) + word[0].length).replace(/\([^)]*\)/g, ' ');
        const inCell = written.find((entry) => entry.index > (word.index as number));
        if (inCell) {
          if (admissible(inCell)) continue;
          cells.push(cellAddress(row, column));
          break;
        }
        // Aucune date après le mot : une date écrite AVANT lui dans la cellule date l'impression (« Le 02/06/2026,
        // imprimé par A. »), faute d'une date attendue à droite ou d'une annonce de date.
        const earlier = written.filter((entry) => entry.index < (word.index as number)).pop();
        const earlierIsStale = earlier !== undefined && !admissible(earlier);
        if (rest.trim() === '' || DANGLING_DATE_LINK.test(rest)) {
          // La date est attendue à droite : la première cellule non vide la porte, ou ne la porte pas.
          let right: { address: string; iso: string | null; precision: 'DAY' | 'MONTH' } | null = null;
          for (let next = column + 1; next <= lastColumn; next += 1) {
            const cell = cellAt(sheet, row, next);
            const cellDate = cellIsoDate(cell);
            const cellWritten = writtenDates(cellText(cell));
            if (cellDate) right = { address: cellAddress(row, next), iso: cellDate, precision: 'DAY' };
            else if (cellWritten.length > 0) right = { address: cellAddress(row, next), iso: cellWritten[0].iso, precision: cellWritten[0].precision };
            if (cellDate || cellText(cell)) break;
          }
          if (right !== null && admissible(right)) continue;
          if (right !== null) cells.push(right.address);
          else if (rest.trim() !== '' || DATE_WORD.test(plain) || earlierIsStale) cells.push(cellAddress(row, column));
          else continue;
          break;
        }
        if (PRINT_DATING_HINT.test(rest) || DATE_WORD.test(plain) || earlierIsStale) {
          cells.push(cellAddress(row, column));
          break;
        }
      }
    }
  }
  return cells;
}

/**
 * Cellules de la zone de position où un libellé de date de position n'est PAS suivi d'une date lisible :
 * « Soldes au N/A », « Solde au : à préciser », « Soldes au 2/6 », « Bank balances as of TBD ». La date
 * peut être dans la cellule de droite. Un intitulé (« Position au niveau des banques ») n'en est pas un.
 */
function unreadablePositionDatesInZone(sheet: Sheet, lastRow: number, lastColumn: number): string[] {
  const cells: string[] = [];
  for (let row = 1; row <= lastRow; row += 1) {
    for (let column = 1; column <= lastColumn; column += 1) {
      const plain = plainUpper(cellText(cellAt(sheet, row, column)));
      for (const label of plain.matchAll(POSITION_DATE_LABEL)) {
        const after = plain.slice((label.index as number) + label[0].length);
        const right = cellAt(sheet, row, column + 1);
        if (after === '' && cellIsoDate(right)) continue;
        const value = after === '' ? plainUpper(cellText(right)) : after;
        const dates = findDatesInText(value);
        // La date doit suivre le libellé : seuls des mots de liaison peuvent les séparer.
        if (dates.length > 0 && !hasLabelWord(value.slice(0, dates[0].index))) continue;
        // Sans date lisible : des mots seuls font un intitulé (« Solde au débit », « Position au niveau des
        // banques ») ; une valeur vide, chiffrée ou de remplissage tenait la place d'une date.
        if (value !== '' && !/[0-9]/.test(value) && !DATE_PLACEHOLDER.test(value.trim())) continue;
        cells.push(cellAddress(row, column));
      }
    }
  }
  return cells;
}

function findHeader(sheet: Sheet, lastColumn: number): { row: number; columns: Record<keyof typeof HEADERS, number> } | null {
  for (let row = 1; row <= 6; row += 1) {
    const columns: Partial<Record<keyof typeof HEADERS, number>> = {};
    for (let column = 1; column <= lastColumn; column += 1) {
      const label = normalizeLabel(cellText(cellAt(sheet, row, column))).replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
      for (const key of Object.keys(HEADERS) as Array<keyof typeof HEADERS>) {
        if (label === HEADERS[key] || label.replace(/ /g, '') === HEADERS[key].replace(/ /g, '')) {
          // Un en-tête répété rend la lecture ambiguë : l'onglet est refusé.
          if (columns[key] !== undefined) return null;
          columns[key] = column;
        }
      }
    }
    if (columns.bankBalance && columns.fundApplied && columns.netBalance && columns.nonValidatedDeposit) {
      return { row, columns: columns as Record<keyof typeof HEADERS, number> };
    }
  }
  return null;
}

function readCell(sheet: Sheet, row: number, column: number, bank: SituationBank, issues: FundPositionIssue[]): FundPositionCell {
  const address = cellAddress(row, column);
  const cell = cellAt(sheet, row, column);
  if (!cell || cell.v === undefined || cell.v === null || String(cell.v).trim() === '') {
    issues.push({ code: 'CELL_ABSENT', address, bank });
    return { address, value: null };
  }
  const value = cellNumber(cell);
  if (value === null) {
    issues.push({ code: 'CELL_NOT_NUMERIC', address, bank });
    return { address, value: null };
  }
  return { address, value };
}

/**
 * Lit le premier onglet visible daté strictement après la date comptable D
 * (au plus tard `today`) comme RÉFÉRENCE. Le nom de l'onglet ne prouve pas la
 * date de la situation. Elle est établie :
 * - par le champ explicite de date de position (« Situation au », « Position
 *   arrêtée au », « As at »…), s'il est valide (il doit alors être égal à D
 *   pour ouvrir la comparaison ; contraire à D, il la bloque) ;
 * - sinon, quand ce champ est ABSENT et que l'onglet lu est daté exactement
 *   du lendemain calendaire de D, par la confirmation de l'opérateur pour ce
 *   fichier, cet onglet et cette date.
 * Un champ invalide (répété, mal formé, illisible comme « N/A ») ou contraire
 * bloque la comparaison : aucune confirmation n'est alors proposée. Il en va
 * de même de TOUTE autre date écrite dans la zone de position — l'en-tête et
 * les lignes des banques — dès qu'elle n'est pas D, même si elle est la date
 * du nom de l'onglet : seule une date que SON libellé dit être une échéance,
 * une date de valeur, une validité ou un taux est ignorée, et jamais si ce
 * libellé parle aussi de soldes ou de position. Une date d'impression ou
 * d'édition n'est admise que lisible et au moins égale à D : dans tout
 * l'onglet, une mention d'impression que suit une date antérieure ou
 * indéterminable (« Imprimé le 2 juin », « Imprimé par A. le 02/06/2026 »),
 * ou qu'aucune date ne suit (« Imprimé le N/A »), bloque. Un libellé de
 * date de position qu'aucune date lisible ne suit (« Soldes au N/A »)
 * bloque de même. Sous le bloc des banques (facilités et leurs échéances)
 * compte toute date autre que D, non exemptée, dont le libellé parle de
 * soldes, de position ou de situation (« NB : ces soldes sont arrêtés au
 * 02/06/2026 »), ou qu'annonce « NB : as at » ; une date générique, ou le
 * solde d'une facilité nommée en complément direct (« Solde du découvert
 * au … »), n'y compte pas. Le champ de date n'est lu
 * que dans les lignes d'en-tête. Devise et unité : champ explicite, sinon
 * convention SODATRA quand rien ne la contredit dans l'onglet.
 */
export function readFundPosition(
  bytes: ArrayBuffer,
  accountingDate: string,
  today: string,
  attestation?: FundPositionDateAttestation,
): FundPositionReading {
  let workbook;
  try {
    workbook = readWorkbook(bytes.slice(0));
  } catch {
    return unavailable('WORKBOOK_UNREADABLE');
  }
  const hidden = hiddenSheetNames(workbook);
  const tabs = workbook.SheetNames
    .filter((name) => !hidden.has(name))
    .map((name) => ({ name, date: sheetNameToIso(name) }))
    .filter((tab) => tab.date !== null && tab.date > accountingDate && tab.date <= today)
    .sort((a, b) => (a.date as string).localeCompare(b.date as string));
  const tab = tabs[0];
  if (!tab) return unavailable('TAB_ABSENT');
  // Deux onglets ramenés à la même date : impossible de savoir lequel fait foi.
  if (tabs.filter((candidate) => candidate.date === tab.date).length > 1) return unavailable('TAB_AMBIGUOUS');

  const sheet = workbook.Sheets[tab.name];
  const bounds = usefulBounds(sheet, 200, 16);
  const header = findHeader(sheet, bounds.lastColumn);
  if (!header) {
    return { ...unavailable('HEADER_NOT_FOUND'), tabName: tab.name, tabDate: tab.date };
  }
  const fieldBounds = usefulBounds(sheet, REFERENCE_SCAN_ROWS, REFERENCE_SCAN_COLUMNS);
  // Les champs explicites ne sont lus que dans les lignes d'en-tête ; les mentions contraires de devise et
  // d'unité, dans tout l'onglet.
  const fields = readExplicitFields(sheet, fieldBounds, header.row);
  const currency = establishWithConvention(fields.currency, fields.writtenCurrencies, SODATRA_CONVENTION.currency);
  const unit = establishWithConvention(fields.unit, fields.writtenUnits, SODATRA_CONVENTION.unit);
  // Zone de position : de la première ligne à la fin du bloc des banques.
  let positionZoneLastRow = bounds.lastRow;
  for (let row = header.row + 1; row <= bounds.lastRow; row += 1) {
    if ([cellText(cellAt(sheet, row, 1)), cellText(cellAt(sheet, row, 2))].some((label) => BLOCK_END.test(normalizeLabel(label)))) {
      positionZoneLastRow = row - 1;
      break;
    }
  }
  // Toute autre date écrite dans cette zone, qui n'est pas la date de position retenue, la contredit : la
  // comparaison est bloquée et aucune confirmation n'est proposée — y compris quand cette date est celle du
  // nom de l'onglet. Seule une date que SON libellé dit être autre chose (échéance, impression, date de
  // valeur, validité, taux) est ignorée — et une date d'impression ou d'édition seulement si elle est lisible
  // et au moins égale à la date de position. Une date au mois près s'accorde avec ce mois ; une date illisible
  // ne s'accorde avec rien. Il en va de même d'un libellé de date de position qu'aucune date lisible ne suit.
  // Sous le bloc des banques compte toute date autre que D, non exemptée, dont le libellé parle de soldes,
  // de position ou de situation sans être le solde d'une facilité, ou qu'annonce « NB : as at ». Dans tout
  // l'onglet, une mention d'impression du document dont la date n'est pas lisible et au moins égale à D bloque.
  const stated = fields.situationDate.state === 'VALID' ? fields.situationDate.value : null;
  const expected = stated ?? accountingDate;
  const agrees = (date: Pick<ZoneDate, 'iso' | 'precision'>) => date.iso !== null && (
    date.precision === 'MONTH' ? expected.slice(0, 7) === date.iso.slice(0, 7) : expected === date.iso
  );
  const dateConflictCells = [
    ...datesWrittenInRows(sheet, 1, positionZoneLastRow, fieldBounds.lastColumn)
      .filter((date) => (!date.exempt && !agrees(date)) || (date.printGoverned && !printedOnOrAfter(date, expected))).map((date) => date.address),
    ...unreadablePositionDatesInZone(sheet, positionZoneLastRow, fieldBounds.lastColumn),
    ...datesWrittenInRows(sheet, positionZoneLastRow + 1, fieldBounds.lastRow, fieldBounds.lastColumn)
      .filter((date) => date.aboutThePosition && !date.exempt && !agrees(date)).map((date) => date.labelAddress),
    ...datesWrittenInRows(sheet, positionZoneLastRow + 1, fieldBounds.lastRow, fieldBounds.lastColumn)
      .filter((date) => date.printGoverned && !printedOnOrAfter(date, expected)).map((date) => date.address),
    ...printMentionsWithoutAnAdmissibleDate(sheet, fieldBounds.lastRow, fieldBounds.lastColumn, expected),
    ...fields.situationDatesBelowFields.filter((entry) => entry.date !== expected).map((entry) => entry.address),
  ].filter((address, index, all) => all.indexOf(address) === index).slice(0, 5);
  const contradicted = dateConflictCells.length > 0;
  const dateField: FieldState = fields.situationDate.state === 'INVALID' ? 'INVALID' : contradicted ? 'CONTRADICTED' : fields.situationDate.state;
  // Date de situation : le champ explicite s'il est valide ; s'il est ABSENT, la confirmation de l'opérateur,
  // proposée pour le seul onglet daté du lendemain calendaire de D. Un champ invalide ou contredit ne se confirme pas.
  const needsDateAttestation = dateField === 'ABSENT' && daysBetween(accountingDate, tab.date as string) === 1;
  const confirmed = needsDateAttestation && attestation !== undefined
    && attestation.tabName === tab.name && attestation.accountingDate === accountingDate;
  const referenceDate = dateField === 'VALID' ? stated : confirmed ? accountingDate : null;
  const dateProof = dateField === 'VALID' ? ('FILE' as const) : confirmed ? ('OPERATOR' as const) : null;
  const dateComparable = referenceDate !== null && referenceDate === accountingDate;
  const positionColumn = header.columns.nonValidatedDeposit + 1;
  const issues: FundPositionIssue[] = [];
  const seen = new Map<SituationBank, number[]>();
  for (let row = header.row + 1; row <= bounds.lastRow; row += 1) {
    const labels = [cellText(cellAt(sheet, row, 1)), cellText(cellAt(sheet, row, 2))];
    if (labels.some((label) => BLOCK_END.test(normalizeLabel(label)))) break;
    const bankLabel = labels[1] || '';
    if (!bankLabel) continue;
    // Libellé strict : « BDK USD » ou « TOTAL BDK » ne sont pas la ligne de la banque BDK.
    const bank = detectBankFromStrictLabel(bankLabel);
    if (!bank && /TOTAL/.test(normalizeLabel(bankLabel))) continue;
    if (!bank) {
      issues.push({ code: 'BANK_LABEL_UNKNOWN', address: cellAddress(row, 2), bank: null });
      continue;
    }
    seen.set(bank, [...(seen.get(bank) ?? []), row]);
  }
  const rows: FundPositionBankRow[] = [];
  for (const bank of SITUATION_BANKS) {
    const bankRows = seen.get(bank) ?? [];
    if (bankRows.length === 0) continue;
    if (bankRows.length > 1) {
      issues.push({ code: 'BANK_ROW_AMBIGUOUS', address: cellAddress(bankRows[1], 2), bank });
      continue;
    }
    const row = bankRows[0];
    const declared = {
      bankBalance: readCell(sheet, row, header.columns.bankBalance, bank, issues),
      fundApplied: readCell(sheet, row, header.columns.fundApplied, bank, issues),
      netBalance: readCell(sheet, row, header.columns.netBalance, bank, issues),
      nonValidatedDeposit: readCell(sheet, row, header.columns.nonValidatedDeposit, bank, issues),
      position: readCell(sheet, row, positionColumn, bank, issues),
    };
    const net = declared.bankBalance.value !== null && declared.fundApplied.value !== null
      ? declared.bankBalance.value - declared.fundApplied.value
      : null;
    const position = net !== null && declared.nonValidatedDeposit.value !== null ? net + declared.nonValidatedDeposit.value : null;
    if (net !== null && declared.netBalance.value !== null && !amountsEqual(net, declared.netBalance.value)) {
      issues.push({ code: 'DECLARED_NET_DIFFERS_FROM_RECALCULATED', address: declared.netBalance.address, bank });
    }
    if (position !== null && declared.position.value !== null && !amountsEqual(position, declared.position.value)) {
      issues.push({ code: 'DECLARED_TOTAL_DIFFERS_FROM_RECALCULATED', address: declared.position.address, bank });
    }
    rows.push({ bank, rowNumber: row, declared, recalculated: { netBalance: net, position } });
  }
  return {
    available: true, reason: null, tabName: tab.name, tabDate: tab.date, referenceDate, dateProof,
    dateField, dateConflictCells, needsDateAttestation, currency: currency.value, currencyProvenance: currency.provenance,
    unit: unit.value, unitProvenance: unit.provenance, dateComparable, rows, issues,
  };
}

function compare(
  bank: SituationBank,
  indicator: FundPositionComparison['indicator'],
  declared: number | null,
  source: number | null,
  blocking: ComparisonReason | null,
): FundPositionComparison {
  if (blocking) return { bank, indicator, status: 'NOT_COMPARABLE', reason: blocking, declared, source, delta: null };
  if (declared === null) return { bank, indicator, status: 'NOT_COMPARABLE', reason: 'DECLARED_ABSENT', declared, source, delta: null };
  if (source === null) return { bank, indicator, status: 'NOT_COMPARABLE', reason: 'SOURCE_UNAVAILABLE', declared, source, delta: null };
  const delta = Math.round((declared - source) * 100) / 100;
  return { bank, indicator, status: amountsEqual(declared, source) ? 'EQUAL' : 'DIFFERENT', reason: null, declared, source, delta };
}

/**
 * Écarts entre la Fund Position déclarée et les sources vérifiées, calculés
 * seulement à date, périmètre (même banque), devise et unité comparables.
 * Chaque source d'une comparaison — la Fund Position, le relevé, le classeur
 * mensuel — doit être ÉTABLIE en XOF et en francs entiers. Une autre devise ou
 * une autre unité, même déclarée à l'identique des deux côtés, donne « non
 * comparable » : aucune conversion d'unité n'est faite.
 */
export function compareFundPosition(
  reading: FundPositionReading,
  accountingDate: string,
  balances: AccountBalance[],
  workbooks: WorkbookEncours[],
): FundPositionComparison[] {
  if (!reading.available) return [];
  const comparisons: FundPositionComparison[] = [];
  for (const row of reading.rows) {
    const balance = balances.find((candidate) => candidate.bank === row.bank) ?? null;
    const workbook = workbooks.find((candidate) => candidate.bank === row.bank && candidate.available) ?? null;
    const statementUsable = balance !== null && balance.status === 'AVAILABLE';
    // Chaque source d'une comparaison doit être en XOF et en francs entiers : aucune conversion n'est faite, et
    // deux documents qui déclarent la même autre unité (deux fois « milliers ») ne sont pas comparés non plus.
    // La Fund Position d'abord : date établie égale à D, devise XOF, unité francs entiers.
    const documentBlocking: ComparisonReason | null = !reading.dateComparable ? 'DATE_NOT_COMPARABLE'
      : reading.currency !== SODATRA_CONVENTION.currency ? 'CURRENCY_NOT_COMPARABLE'
        : reading.unit !== SODATRA_CONVENTION.unit ? 'UNIT_NOT_COMPARABLE' : null;
    // Relevé : en francs entiers par nature ; sa devise doit être XOF.
    const statementBlocking: ComparisonReason | null = documentBlocking
      ?? (statementUsable && balance!.currency !== SODATRA_CONVENTION.currency ? 'CURRENCY_NOT_COMPARABLE' : null);
    comparisons.push(compare(row.bank, 'BANK_BALANCE_VS_STATEMENT', row.declared.bankBalance.value,
      statementUsable ? balance!.amount : null, statementBlocking));
    // Classeur mensuel : même date de position, devise XOF et unité francs entiers établies pour son onglet.
    const workbookBlocking: ComparisonReason | null = documentBlocking
      ?? (workbook !== null && workbook.balanceDate !== accountingDate ? 'DATE_NOT_COMPARABLE' : null)
      ?? (workbook !== null && workbook.currency !== SODATRA_CONVENTION.currency ? 'CURRENCY_NOT_COMPARABLE' : null)
      ?? (workbook !== null && workbook.unit !== SODATRA_CONVENTION.unit ? 'UNIT_NOT_COMPARABLE' : null);
    comparisons.push(compare(row.bank, 'BANK_BALANCE_VS_WORKBOOK', row.declared.bankBalance.value,
      workbook ? workbook.openingBalance : null, workbookBlocking));
    comparisons.push(compare(row.bank, 'FUND_APPLIED_VS_WORKBOOK', row.declared.fundApplied.value,
      workbook && workbook.cheques.available ? workbook.cheques.declaredTotal : null, workbookBlocking));
    comparisons.push(compare(row.bank, 'NON_VALIDATED_VS_WORKBOOK', row.declared.nonValidatedDeposit.value,
      workbook && workbook.deposits.available ? workbook.deposits.declaredTotal : null, workbookBlocking));
  }
  return comparisons;
}
