// Fabriques de fichiers EXCLUSIVEMENT synthétiques pour les tests de la
// « Situation du jour ». Aucune valeur, aucun nom et aucun numéro ne provient
// d'un fichier réel : les structures reproduisent des formes, pas des données.
import * as XLSX from 'xlsx';

import { isoToExcelSerial } from './situationCore';

type CellInput = string | number | { date: string } | null | undefined;

function toBytes(workbook: XLSX.WorkBook, bookType: 'xls' | 'xlsx'): ArrayBuffer {
  const written = XLSX.write(workbook, { type: 'array', bookType }) as ArrayBuffer | Uint8Array;
  if (written instanceof ArrayBuffer) return written;
  return written.buffer.slice(written.byteOffset, written.byteOffset + written.byteLength) as ArrayBuffer;
}

/** Feuille construite cellule par cellule ; `{ date }` produit une vraie cellule date. */
export function sheetFromRows(rows: CellInput[][]): XLSX.WorkSheet {
  const sheet: XLSX.WorkSheet = {};
  let lastRow = 0;
  let lastColumn = 0;
  rows.forEach((row, rowIndex) => {
    row.forEach((value, columnIndex) => {
      if (value === null || value === undefined || value === '') return;
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      if (typeof value === 'number') sheet[address] = { t: 'n', v: value };
      else if (typeof value === 'string') sheet[address] = { t: 's', v: value };
      else sheet[address] = { t: 'n', v: isoToExcelSerial(value.date), z: 'm/d/yy' };
      lastRow = Math.max(lastRow, rowIndex);
      lastColumn = Math.max(lastColumn, columnIndex);
    });
  });
  sheet['!ref'] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: lastRow, c: lastColumn } });
  return sheet;
}

export function workbookBytes(
  sheets: Array<{ name: string; sheet: XLSX.WorkSheet; hidden?: boolean }>,
  bookType: 'xls' | 'xlsx' = 'xlsx',
  options: { date1904?: boolean } = {},
): ArrayBuffer {
  const workbook = XLSX.utils.book_new();
  sheets.forEach((entry) => XLSX.utils.book_append_sheet(workbook, entry.sheet, entry.name));
  if (sheets.some((entry) => entry.hidden) || options.date1904) {
    workbook.Workbook = {
      Sheets: sheets.map((entry) => ({ name: entry.name, Hidden: entry.hidden ? 1 : 0 })),
      ...(options.date1904 ? { WBProps: { date1904: true } } : {}),
    };
  }
  return toBytes(workbook, bookType);
}

function fr(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year}`;
}

function frShort(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}/${month}/${year.slice(2)}`;
}

export function tabName(iso: string): string {
  const [year, month, day] = iso.split('-');
  return `${day}${month}${year.slice(2)}`;
}

// ---------------------------------------------------------------------------
// Relevés ONLINE
// ---------------------------------------------------------------------------

export interface SyntheticMovement {
  date: string;
  /** Montant signé : négatif = débit. */
  amount: number;
}

export interface SyntheticCsvOptions {
  periodStart: string;
  periodEnd: string;
  opening: number;
  movements: SyntheticMovement[];
  withAccount?: boolean;
  /** Dernier groupe du numéro de compte synthétique (distingue deux comptes). */
  accountSuffix?: string;
  /** Début du numéro de compte (deux comptes peuvent ne différer que par là). */
  accountPrefix?: string;
  /** `false` : le relevé ne porte pas de ligne IBAN. */
  withIban?: boolean;
  /** Fausse le solde final déclaré (le lecteur doit alors demander une revue). */
  declaredClosingOverride?: number;
  /** Fausse le solde initial déclaré (la chaîne ne se raccorde plus). */
  declaredOpeningOverride?: number;
  /** Date du solde final déclaré en pied de relevé (par défaut la fin de la période annoncée). */
  closingDate?: string;
}

/** Relevé CSV de la famille BDK / ORABANK (point-virgule, Windows-1252, ASCII seulement ici). */
export function csvStatementBytes(options: SyntheticCsvOptions): ArrayBuffer {
  let balance = options.opening;
  let debits = 0;
  let credits = 0;
  const lines = options.movements.map((movement, index) => {
    balance += movement.amount;
    if (movement.amount < 0) debits += -movement.amount; else credits += movement.amount;
    const debit = movement.amount < 0 ? String(-movement.amount) : '';
    const credit = movement.amount >= 0 ? String(movement.amount) : '';
    return `${fr(movement.date)};${fr(movement.date)};SYNTHETIC MOVEMENT ${index + 1};${debit};${credit};${balance}`;
  });
  const text = [
    'EXTRAIT DE COMPTE;;;;;',
    `Periode du;${fr(options.periodStart)};au;${fr(options.periodEnd)};;`,
    options.withAccount === false ? ';;;;;' : `Numero de compte;${options.accountPrefix ?? '01401'}-00000000000-${options.accountSuffix ?? '00'} XOF;;;;`,
    options.withIban === false ? ';;;;;' : 'Code IBAN;SN00SN0000000000000000000000;;;;',
    `;;Solde initial (XOF) : ${options.declaredOpeningOverride ?? options.opening};;;`,
    "Date;Valeur;Libelle de l'operation;Debit(XOF);Credit(XOF);Solde(XOF)",
    ...lines,
    `;;Total;${debits};${credits};`,
    `;;Solde (XOF) au ${fr(options.closingDate ?? options.periodEnd)} : ${options.declaredClosingOverride ?? balance};;;`,
  ].join('\r\n');
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes.buffer;
}

export interface SyntheticExcelStatementOptions {
  bank: 'ATB' | 'BICIS' | 'BIS' | 'BRIDGE';
  opening: number;
  movements: SyntheticMovement[];
  /** Texte écrit sur la deuxième ligne de l'en-tête (plage de dates, mention datée ; facultatif). */
  headerText?: string;
  /** Cellules de la deuxième ligne (remplace `headerText` : plage répartie, répétée, décalée). */
  headerCells?: CellInput[];
  /** Cellules de la première ligne (remplace le titre : libellé, préambule ressemblant à un en-tête). */
  titleCells?: CellInput[];
  /** Force un solde courant incohérent sur la dernière ligne (rupture de chaîne). */
  breakChain?: boolean;
  /** Ampleur de la rupture (7 par défaut). */
  breakChainBy?: number;
  /** Libellé appliqué à toutes les opérations (pour piéger la lecture d'en-tête). */
  movementLabel?: string;
  /** Omet les soldes courants (profil BRIDGE seulement). */
  omitBalances?: boolean;
}

/** Relevé Excel conforme au profil structurel de la banque. */
export function excelStatementBytes(options: SyntheticExcelStatementOptions): ArrayBuffer {
  let balance = options.opening;
  const chronological = options.movements.map((movement, index) => {
    balance += movement.amount;
    const broken = options.breakChain && index === options.movements.length - 1 ? balance + (options.breakChainBy ?? 7) : balance;
    return { ...movement, balance: broken, label: options.movementLabel ?? `SYNTHETIC MOVEMENT ${index + 1}` };
  });
  const descending = [...chronological].reverse();
  const titleRow: CellInput[] = options.titleCells ?? ['SYNTHETIC ONLINE EXPORT'];
  const periodRow: CellInput[] = options.headerCells ?? [options.headerText ?? ''];
  let rows: CellInput[][];
  if (options.bank === 'ATB') {
    rows = [
      titleRow, periodRow, [], [], [], [],
      ['Référence', "Date de l'opération", 'Date Valeur', 'Montant', 'Solde', 'Devise', 'Libellé'],
      ...descending.map((line, index): CellInput[] => [`SYN-${index}`, isoToExcelSerial(line.date), isoToExcelSerial(line.date), String(line.amount), String(line.balance), 'XOF', line.label]),
    ];
  } else if (options.bank === 'BICIS') {
    rows = [
      titleRow, periodRow, [], [], [], [], [],
      ['Date Opération', 'Date Valeur', 'Référence', 'Montant', 'Libellé', 'Solde', 'Devise'],
      ...descending.map((line, index): CellInput[] => [fr(line.date), fr(line.date), `SYN-${index}`, line.amount, line.label, line.balance, 'XOF']),
    ];
  } else if (options.bank === 'BIS') {
    const header: CellInput[] = new Array(15).fill('');
    header[1] = "Date de l'opération commerciale";
    header[3] = 'Date de valeur';
    header[5] = 'Description';
    header[10] = 'Débit(XOF)';
    header[12] = 'Crédit(XOF)';
    header[14] = 'Solde';
    rows = [
      titleRow, periodRow, [], [], [], [], [], [], [], [],
      header,
      ...descending.map((line): CellInput[] => {
        const row: CellInput[] = new Array(15).fill('');
        row[1] = fr(line.date);
        row[3] = fr(line.date);
        row[5] = line.label;
        row[10] = line.amount < 0 ? -line.amount : 0;
        row[12] = line.amount >= 0 ? line.amount : 0;
        row[14] = `${Math.abs(line.balance)} ${line.balance < 0 ? 'Débiteur' : 'Créditeur'}`;
        return row;
      }),
    ];
  } else {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const english = (iso: string) => {
      const [year, month, day] = iso.split('-');
      return `${day} ${months[Number(month) - 1]} ${year}`;
    };
    rows = [
      ['Date Operation', 'Description', 'Reference', 'Date Valeur', 'Debit', 'Credit', ''],
      ...chronological.map((line, index): CellInput[] => [english(line.date), line.label, `SYN-${index}`, english(line.date), line.amount < 0 ? String(-line.amount) : '', line.amount >= 0 ? String(line.amount) : '', options.omitBalances ? '' : String(line.balance)]),
    ];
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows as unknown[][]), 'SYNTHETIC');
  return toBytes(workbook, options.bank === 'BRIDGE' ? 'xlsx' : 'xls');
}

// ---------------------------------------------------------------------------
// Classeur mensuel (un onglet par jour)
// ---------------------------------------------------------------------------

export interface SyntheticDeposit { date: string; dueDate?: string; number?: number; clientBank?: string; client: string; amount: number }
export interface SyntheticCheque { date: string; number: number; amount: number; outsideTotalColumn?: boolean }
export interface SyntheticFacilityRow { label?: string; limit?: number; used?: number; date?: string; /** Disponible saisi (par défaut plafond − utilisé). */ balance?: number }
export interface SyntheticImpaye { date: string; amount: number }

export interface SyntheticTab {
  name: string;
  /** Date portée par le libellé d'ouverture (position à cette date). */
  labelDate: string;
  titleBank: string;
  /** Devise écrite dans l'en-tête de l'onglet (absente par défaut, comme dans un classeur qui ne la dit pas). */
  currency?: string;
  opening: number;
  deposits?: SyntheticDeposit[];
  cheques?: SyntheticCheque[];
  facilities?: { withHeader: boolean; rows: SyntheticFacilityRow[]; trailingUnlabeledRows?: boolean };
  impayes?: SyntheticImpaye[];
  french?: boolean;
  depositSectionTitle?: boolean;
  /** Fausse le total déclaré des dépôts (les lignes ne prouvent plus le total). */
  declaredDepositsOverride?: number;
  /** Fausse le solde de clôture déclaré (totaux incohérents entre eux). */
  declaredClosingOverride?: number;
  /** Total déclaré des impayés : nombre pour le fausser, `null` pour l'omettre. */
  impayesTotalOverride?: number | null;
  /** Onglet masqué dans le classeur. */
  hidden?: boolean;
  /** Second montant porté par la ligne « TOTAL (B) », dans la colonne des anciens chèques. */
  totalBSecondColumn?: number;
}

export function monthlyTabSheet(tab: SyntheticTab): XLSX.WorkSheet {
  const rows: CellInput[][] = [];
  const french = tab.french === true;
  rows.push(['', '', '', tab.titleBank, '', '', tab.currency ? `Devise ${tab.currency}` : '']);
  rows.push(['Date', ' CH.NO', 'DESCRIPTION', 'VENDOR PROVIDER', 'CLIENT ', 'TR No /FACT.No', ' AMOUNT ', ' AMOUNT 1']);
  rows.push([`${french ? "SOLDE D'OUVERTURE" : 'OPENING BALANCE'} ${frShort(tab.labelDate)}`, '', '', '', '', '', tab.opening]);
  if (tab.depositSectionTitle !== false) {
    rows.push(french ? ['', '', '', 'Dépôts pas encore encaissé'] : ['ADD :', ' DEPOSIT NOT YET CLEARED']);
  }
  const deposits = tab.deposits ?? [];
  deposits.forEach((deposit) => rows.push([
    { date: deposit.date }, deposit.dueDate ? { date: deposit.dueDate } : (deposit.number ?? ''), 'REGLEMENT FACTURE',
    deposit.clientBank ?? 'SYNTHBANK', deposit.client, '', deposit.amount,
  ]));
  const depositsTotal = deposits.reduce((total, deposit) => total + deposit.amount, 0);
  const declaredDeposits = tab.declaredDepositsOverride ?? depositsTotal;
  rows.push(french ? ['TOTAL DEPOSIT', '', '', '', '', '', declaredDeposits] : ['', '', '', 'TOTAL DEPOSIT ', '', '', declaredDeposits]);
  const totalA = tab.opening + declaredDeposits;
  rows.push(french ? ['TOTAL (A)', '', '', '', '', '', totalA] : ['', '', '', 'TOTAL BALANCE (A)', '', '', totalA]);
  rows.push(['LESS :', '', '', french ? 'Chéques émis non encaissés' : 'CHECK Not yet cleared']);
  const cheques = tab.cheques ?? [];
  cheques.forEach((cheque) => {
    const row: CellInput[] = [{ date: cheque.date }, cheque.number, 'SYNTHETIC PAYMENT', 'SYNTHETIC VENDOR', '', ''];
    if (cheque.outsideTotalColumn) { row[6] = ''; row[french ? 8 : 7] = cheque.amount; } else { row[6] = cheque.amount; }
    rows.push(row);
  });
  const totalB = cheques.filter((cheque) => !cheque.outsideTotalColumn).reduce((total, cheque) => total + cheque.amount, 0);
  const totalBRow: CellInput[] = ['', '', '', 'TOTAL (B)', '', '', totalB];
  if (tab.totalBSecondColumn !== undefined) totalBRow[french ? 8 : 7] = tab.totalBSecondColumn;
  rows.push(totalBRow);
  rows.push(['', '', french ? 'SOLDE DE CLÔTURE selon le livre : C=(A-B)' : 'CLOSING BALANCE as per Book : C=(A-B)', '', '', '', tab.declaredClosingOverride ?? (totalA - totalB)]);
  rows.push([]);
  if (tab.facilities) {
    rows.push(['', '', '', 'BANK FACILITY (120 jrs)']);
    if (tab.facilities.withHeader) rows.push(['', '', '', 'Limit', 'Used', '', 'Balance']);
    let usedTotal = 0;
    tab.facilities.rows.forEach((facility) => {
      usedTotal += facility.used ?? 0;
      if (tab.facilities!.withHeader) {
        rows.push(['', facility.date ? { date: facility.date } : '', facility.label ?? '', facility.limit ?? '', facility.used ?? '', '',
          facility.balance ?? (facility.limit !== undefined ? facility.limit - (facility.used ?? 0) : '')]);
      } else {
        rows.push([facility.date ? { date: facility.date } : '', facility.label ?? '', facility.limit ?? '', '', facility.used ?? '', '',
          facility.balance ?? (facility.limit !== undefined && facility.used !== undefined ? facility.limit - facility.used : '')]);
      }
    });
    if (tab.facilities.trailingUnlabeledRows) {
      rows.push(['', '', '', '', usedTotal]);
      rows.push(['', '', '', '', -900]);
      rows.push(['', '', '', '', usedTotal - 900]);
    }
    rows.push([]);
  }
  if (tab.impayes) {
    rows.push(['', '', '', 'IMPAYE']);
    tab.impayes.forEach((impaye) => rows.push([{ date: impaye.date }, { date: impaye.date }, 'IMPAYE', 'SYNTHBANK', 'SYNTHETIC CLIENT', '', impaye.amount]));
    const impayesTotal = tab.impayesTotalOverride === undefined
      ? tab.impayes.reduce((total, impaye) => total + impaye.amount, 0)
      : tab.impayesTotalOverride;
    if (impayesTotal !== null) rows.push(['', '', '', '', '', '', impayesTotal]);
  }
  return sheetFromRows(rows);
}

export function monthlyWorkbookBytes(tabs: SyntheticTab[], options: { date1904?: boolean } = {}): ArrayBuffer {
  return workbookBytes(tabs.map((tab) => ({ name: tab.name, sheet: monthlyTabSheet(tab), hidden: tab.hidden })), 'xlsx', options);
}

// ---------------------------------------------------------------------------
// Collection Report
// ---------------------------------------------------------------------------

export interface SyntheticCollectionRow {
  /** Chaîne vide : date de ligne absente. */
  date: string;
  /** Date = effet (échéance) ; nombre = chèque ; texte = autre. */
  instrument: { date: string } | number | string;
  clientBank: string;
  client: string;
  /** `null` : montant absent. */
  amount: number | null;
  depositBank: string;
  validity?: { date: string } | string;
  commission?: number;
}

function collectionSheet(rows: SyntheticCollectionRow[]): XLSX.WorkSheet {
  const data: CellInput[][] = [[
    'DATE', 'No.CHq /Bd', 'BANK NAME', 'CLIENT NAME', 'FACTURE N°', 'AMOUNT ', 'BANK', 'Date of VAlidity',
    'BankCommission', 'SG or FA N°', 'D.NAmount', 'INCOME ',
  ]];
  rows.forEach((row, index) => data.push([
    row.date ? { date: row.date } : '', row.instrument, row.clientBank, row.client, 260000 + index, row.amount, row.depositBank,
    row.validity ?? '', row.commission ?? '', '', '', '',
  ]));
  return sheetFromRows(data);
}

export function collectionReportBytes(
  rows: SyntheticCollectionRow[],
  options: { hiddenPivotFirst?: boolean; hiddenDecoyRows?: SyntheticCollectionRow[]; visibleSecondSheetRows?: SyntheticCollectionRow[] } = {},
): ArrayBuffer {
  const sheets: Array<{ name: string; sheet: XLSX.WorkSheet; hidden?: boolean }> = [];
  if (options.hiddenPivotFirst) {
    sheets.push({ name: 'Feuil3', sheet: sheetFromRows([[], [], ['Étiquettes de lignes', 'Somme de AMOUNT '], ['SYNTHETIC CLIENT', 1]]), hidden: true });
  }
  // Leurre : une feuille MASQUÉE aux bons en-têtes, placée avant la vraie feuille.
  if (options.hiddenDecoyRows) sheets.push({ name: 'Feuil0', sheet: collectionSheet(options.hiddenDecoyRows), hidden: true });
  sheets.push({ name: 'Feuil1', sheet: collectionSheet(rows) });
  if (options.visibleSecondSheetRows) sheets.push({ name: 'Feuil4', sheet: collectionSheet(options.visibleSecondSheetRows) });
  return workbookBytes(sheets);
}

// ---------------------------------------------------------------------------
// Fund Position
// ---------------------------------------------------------------------------

export interface SyntheticFundPositionRow {
  label: string;
  bankBalance?: number | string;
  fundApplied?: number;
  netBalance?: number;
  nonValidatedDeposit?: number;
  position?: number;
  /** Mention libre écrite sur la ligne de la banque (colonne H). */
  note?: string;
}

export interface SyntheticFundPositionReference {
  /** Date de référence écrite dans l'onglet (cellule date). */
  date?: string;
  /** Seconde date écrite dans l'onglet (rend la référence ambiguë). */
  otherDate?: string;
  /** Mention de devise écrite dans l'onglet. */
  currency?: string;
  /** Date de référence écrite en TEXTE (à la place de la cellule date). */
  dateText?: string;
  /** Autres mentions écrites sur la ligne d'en-tête (date d'impression, période, seconde devise). */
  texts?: string[];
}

export function fundPositionTabSheet(rows: SyntheticFundPositionRow[], reference: SyntheticFundPositionReference = {}): XLSX.WorkSheet {
  const data: CellInput[][] = [[
    '', '', 'Bank \nBalance', 'Fund Applied', 'Net Balance', 'NonValidated Deposit', '', '',
    reference.date ? 'Situation au' : '', reference.date ? { date: reference.date } : (reference.dateText ?? ''),
    reference.currency ? `Devise ${reference.currency}` : '', reference.otherDate ? { date: reference.otherDate } : '',
    ...(reference.texts ?? []),
  ]];
  rows.forEach((row, index) => data.push([
    index === 0 ? 'Book balance' : '', row.label, row.bankBalance ?? '', row.fundApplied ?? '', row.netBalance ?? '',
    row.nonValidatedDeposit ?? '', row.position ?? '', row.note ?? '',
  ]));
  data.push(['Deposit for the day']);
  data.push(['', 'BIS', '', '', '', '', 111]);
  data.push(['Payment for the day']);
  data.push(['', 'TOTAL FUND AVAILABLE', 1, 1, 1, 1, 1]);
  return sheetFromRows(data);
}

export function fundPositionBytes(
  tabs: Array<{ name: string; rows: SyntheticFundPositionRow[]; hidden?: boolean; reference?: SyntheticFundPositionReference }>,
): ArrayBuffer {
  return workbookBytes(tabs.map((tab) => ({ name: tab.name, sheet: fundPositionTabSheet(tab.rows, tab.reference), hidden: tab.hidden })));
}
