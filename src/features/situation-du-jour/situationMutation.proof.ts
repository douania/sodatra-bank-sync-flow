// Preuve de mordant locale (hors suite de tests) : la suite doit d'abord être
// verte ; chaque mutant altère ensuite une règle critique de la « Situation
// du jour », la suite ciblée doit échouer, puis le fichier d'origine est
// rétabli à l'identique (contrôlé). Exécution :
//   npx tsx src/features/situation-du-jour/situationMutation.proof.ts
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve('src/features/situation-du-jour');
const tsxCli = resolve('node_modules/tsx/dist/cli.mjs');
const BALANCES = resolve(dir, 'statementBalances.synthetic.test.ts');
const WORKBOOK = resolve(dir, 'monthlyWorkbook.synthetic.test.ts');
const COLLECTION = resolve(dir, 'collectionReading.synthetic.test.ts');
const FUND = resolve(dir, 'fundPositionReading.synthetic.test.ts');
const BROWSER = resolve(dir, 'situationBrowser.synthetic.test.tsx');
// Jeton assemblé : le balayage statique de la feature ne doit trouver aucun appel de journal ici.
const LOG_CALL = ['cons', 'ole.log'].join('');

interface Mutant { name: string; file: string; test: string; from: string; to: string }

const mutants: Mutant[] = [
  // Soldes.
  { name: 's01_identity_gate_removed', file: 'statementBalances.ts', test: BALANCES,
    from: "  if (!evaluation.identityProof) refuse(evaluation, 'IDENTITY_NOT_CORROBORATED');\n", to: '' },
  { name: 's02_currency_gate_removed', file: 'statementBalances.ts', test: BALANCES,
    from: "  if (!evaluation.currencyProof) refuse(evaluation, 'CURRENCY_NOT_CORROBORATED');\n", to: '' },
  { name: 's03_daily_period_limit_removed', file: 'statementBalances.ts', test: BALANCES,
    from: 'if (daysBetween(periodStart, periodEnd) + 1 > STATEMENT_MAX_DAILY_PERIOD_DAYS) {', to: 'if (false) {' },
  { name: 's04_open_day_accepted', file: 'statementBalances.ts', test: BALANCES,
    from: "  if (!dayClosed) refuse(evaluation, 'DAY_NOT_CLOSED');\n", to: '' },
  { name: 's05_balance_chain_break_ignored', file: 'statementBalances.ts', test: BALANCES,
    from: "  if (!chainProved) refuse(evaluation, 'BALANCE_CHAIN_BROKEN');\n", to: '' },
  { name: 's06_conflict_ignored', file: 'statementBalances.ts', test: BALANCES,
    from: 'if (!agree) {', to: 'if (false) {' },
  { name: 's07_duplicate_counted_twice', file: 'statementBalances.ts', test: BALANCES,
    from: '    base.amount = reference.amount;', to: '    base.amount = sumAmounts(admissible.map((evaluation) => evaluation.amount as number));' },
  { name: 's08_uncovered_day_carried_forward', file: 'statementBalances.ts', test: BALANCES,
    from: 'if (!previous || (!coveredByDeclaration && !coveredByBracketing)) {', to: 'if (!previous) {' },
  { name: 's09_unavailable_total_shown_as_zero', file: 'statementBalances.ts', test: BALANCES,
    from: "return { currency, status: 'UNAVAILABLE' as const, amount: null,", to: "return { currency, status: 'UNAVAILABLE' as const, amount: 0," },
  { name: 's10_partial_total_flagged_complete', file: 'statementBalances.ts', test: BALANCES,
    from: "status: missing.length === 0 ? ('COMPLETE' as const) : ('PARTIAL' as const),", to: "status: 'COMPLETE' as const," },
  { name: 's11_chain_checked_only_up_to_the_day', file: 'statementBalances.ts', test: BALANCES,
    from: '  const chainProved = isChainContinuous(units)\n', to: '  const chainProved = isChainContinuous(units.filter((unit) => unit.date <= accountingDate))\n' },
  { name: 's12_same_statement_under_two_banks_counted', file: 'statementBalances.ts', test: BALANCES,
    from: 'if (mine.some((evaluation) => shared.has(evaluation.fileName))) {', to: 'if (false) {' },
  { name: 's13_future_dated_line_accepted', file: 'statementBalances.ts', test: BALANCES,
    from: "  if (last.date > today) refuse(evaluation, 'STATEMENT_NEEDS_REVIEW');\n", to: '' },
  { name: 's14_future_file_name_date_proves_closure', file: 'statementBalances.ts', test: BALANCES,
    from: '  if (closedBefore && closedBefore > today) closedBefore = null;\n', to: '' },
  { name: 's15_declared_period_read_below_operations_header', file: 'statementBalances.ts', test: BALANCES,
    from: 'for (let row = 1; row < operationHeaderRow; row += 1) {', to: 'for (let row = 1; row <= 20; row += 1) {' },
  { name: 's16_csv_needing_review_not_flagged', file: 'statementBalances.ts', test: BALANCES,
    from: "      if (document.validation.status === 'needs_review') return refuse(evaluation, 'STATEMENT_NEEDS_REVIEW');\n", to: '' },
  { name: 's17_same_account_under_two_banks_counted', file: 'statementBalances.ts', test: BALANCES,
    from: 'const sameAccount = left.accountKey !== null && left.accountKey === right.accountKey;', to: 'const sameAccount = false;' },
  { name: 's18_any_two_dates_taken_for_a_period', file: 'statementBalances.ts', test: BALANCES,
    from: '      if (!PERIOD_PHRASE.test(normalizeLabel(text))) continue;\n', to: '' },
  { name: 's19_declared_period_not_checked_against_lines', file: 'statementBalances.ts', test: BALANCES,
    from: '    if (declaredPeriod.start > first.date || declaredPeriod.end < last.date) declaredPeriod = null;\n', to: '' },
  { name: 's21_declared_period_ending_on_the_day_proves_closure', file: 'statementBalances.ts', test: BALANCES,
    from: '(closedBefore !== null && accountingDate < closedBefore)', to: '(closedBefore !== null)' },
  { name: 's22_declared_period_over_daily_limit_accepted', file: 'statementBalances.ts', test: BALANCES,
    from: 'if (daysBetween(declaredPeriod.start, declaredPeriod.end) + 1 > STATEMENT_MAX_DAILY_PERIOD_DAYS) {', to: 'if (false) {' },
  { name: 's23_two_accounts_of_a_bank_merged', file: 'statementBalances.ts', test: BALANCES,
    from: 'if (mine.length > 1 && !sameContent && !sameAccount) {', to: 'if (false) {' },
  { name: 's24_excel_declared_period_end_not_used_as_closure', file: 'statementBalances.ts', test: BALANCES,
    from: '  if (!closedBefore && !isCsv && declaredPeriod !== null) closedBefore = declaredPeriod.end;\n', to: '' },
  { name: 's20_chain_break_under_tolerance_accepted', file: 'statementBalances.ts', test: BALANCES,
    from: 'amountsIdentical(unit.opening, units[index - 1].closing as number)', to: 'amountsEqual(unit.opening, units[index - 1].closing as number)' },
  // Classeurs mensuels.
  { name: 'w01_future_tab_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (tabDate > today) {', to: 'if (false) {' },
  { name: 'w02_ambiguous_tab_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (matches.length !== 1) {', to: 'if (matches.length === 0) {' },
  { name: 'w03_bank_concordance_dropped', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: "if (!nameBank || !titleBank || nameBank !== titleBank) return fail('BANK_NOT_CORROBORATED');", to: "if (!nameBank) return fail('BANK_NOT_CORROBORATED');" },
  { name: 'w04_unproven_lines_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'const proved = amountsEqual(sumAmounts(lines.map((line) => line.amount)), declaredTotal);', to: 'const proved = true;' },
  { name: 'w05_unlabelled_facility_rows_kept', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'const labelled = candidates.filter((candidate) => candidate.label !== null);', to: 'const labelled = candidates;' },
  { name: 'w06_amount_read_outside_proven_column', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: '    const proven = cellNumber(cellAt(sheet, row, provenColumn));',
    to: '    const proven = cellNumber(cellAt(sheet, row, provenColumn)) ?? cellNumber(cellAt(sheet, row, provenColumn + 2));' },
  { name: 'w07_tab_chosen_by_name_instead_of_position_date', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (readOpeningLabelDate(workbook.Sheets[sheetName]) !== accountingDate) continue;', to: 'if (tabDate !== accountingDate) continue;' },
  { name: 'w08_tab_name_not_checked_against_label', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (lag < 1 || lag > WORKBOOK_MAX_TAB_LAG_DAYS) {', to: 'if (false) {' },
  { name: 'w09_hidden_tab_read', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (!tabDate || hidden.has(sheetName)) continue;', to: 'if (!tabDate) continue;' },
  { name: 'w10_inconsistent_totals_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (!amountsEqual(opening + totalDeposits, totalA) || consistent.length === 0) {', to: 'if (false) {' },
  { name: 'w18_ambiguous_total_column_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'const cheques = proven.length === 1', to: 'const cheques = proven.length >= 1' },
  { name: 'w19_total_column_chosen_without_closing_proof', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'const consistent = candidates.filter((candidate) => amountsEqual(totalA - candidate.value, closing));', to: 'const consistent = candidates;' },
  { name: 'w11_impayes_without_declared_total_rendered', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: "  if (declaredTotal === null) return { available: false, reason: 'TOTAL_NOT_DECLARED', declaredTotal: null, lines: [] };\n",
    to: '  if (declaredTotal === null) return { available: true, reason: null, declaredTotal: null, lines };\n' },
  { name: 'w12_impayes_total_mismatch_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: '  if (!amountsEqual(sumAmounts(lines.map((line) => line.amount)), declaredTotal)) {\n', to: '  if (false) {\n' },
  { name: 'w13_single_number_attributed_as_limit', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: '} else if (numbers.length === 3 && amountsEqual(numbers[0].value - numbers[1].value, numbers[2].value)) {',
    to: '} else if (numbers.length >= 2) {' },
  { name: 'w15_tab_far_after_its_label_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'if (lag < 1 || lag > WORKBOOK_MAX_TAB_LAG_DAYS) {', to: 'if (lag < 1) {' },
  { name: 'w16_date_1904_workbook_read', file: 'situationCore.ts', test: WORKBOOK,
    from: "  if (workbook.Workbook?.WBProps?.date1904) throw new Error('DATE_1904_UNSUPPORTED');\n", to: '' },
  { name: 'w17_loose_tab_title_accepted', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: 'const bank = detectBankFromStrictLabel(cellText(cellAt(sheet, row, column)));', to: 'const bank = detectBankFromText(cellText(cellAt(sheet, row, column)));' },
  { name: 'w14_explicit_zero_limit_dropped', file: 'monthlyWorkbook.ts', test: WORKBOOK,
    from: '      limit: candidate.limit,\n', to: '      limit: candidate.limit !== null && candidate.limit > 0 ? candidate.limit : null,\n' },
  // Collection Report.
  { name: 'c01_credited_effet_counted_as_inflow', file: 'collectionReading.ts', test: COLLECTION,
    from: "if (row.state === 'DEPOSE_EN_ATTENTE' && row.depositBank && row.amount !== null) {",
    to: "if ((row.state === 'DEPOSE_EN_ATTENTE' || row.state === 'CREDITE_DECLARE') && row.depositBank && row.amount !== null) {" },
  { name: 'c02_ambiguous_match_accepted', file: 'collectionReading.ts', test: COLLECTION,
    from: "if (unique) entry.row.state = 'DEPOSE_EN_ATTENTE';", to: "if (unique || !unique) entry.row.state = 'DEPOSE_EN_ATTENTE';" },
  { name: 'c03_validity_before_receipt_accepted', file: 'collectionReading.ts', test: COLLECTION,
    from: "      if (row.validityDate < row.receiptDate) { row.checkReason = 'VALIDITY_BEFORE_RECEIPT'; continue; }\n", to: '' },
  { name: 'c04_deposit_matched_without_due_date', file: 'collectionReading.ts', test: COLLECTION,
    from: "if (row.instrument === 'EFFET') return deposit.dueDate !== null && deposit.dueDate === row.dueDate;", to: "if (row.instrument === 'EFFET') return true;" },
  { name: 'c05_client_bank_overwritten_by_deposit_bank', file: 'collectionReading.ts', test: COLLECTION,
    from: '        clientBank: cellText(cellAt(sheet, row, columns.clientBank)),', to: '        clientBank: depositBankRaw,' },
  { name: 'c06_unknown_deposit_bank_treated_as_non_bank', file: 'collectionReading.ts', test: COLLECTION,
    from: 'if (!row.depositBank && row.nonBankDestination) {', to: 'if (!row.depositBank) {' },
  { name: 'c07_deposit_matched_without_client', file: 'collectionReading.ts', test: COLLECTION,
    from: '  if (!deposit.client || !row.client || clientKey(deposit.client) !== clientKey(row.client)) return false;\n', to: '' },
  { name: 'c08_to_verify_included_in_forecast', file: 'collectionReading.ts', test: COLLECTION,
    from: "if (row.state === 'A_VERIFIER' && row.amount !== null) toVerify.push(row.amount);",
    to: "if (row.state === 'A_VERIFIER' && row.amount !== null && row.depositBank) inflows.set(row.depositBank, [...(inflows.get(row.depositBank) ?? []), row.amount]);" },
  { name: 'c09_future_validity_accepted', file: 'collectionReading.ts', test: COLLECTION,
    from: "      if (row.validityDate > today) { row.checkReason = 'VALIDITY_IN_FUTURE'; continue; }\n", to: '' },
  { name: 'c10_credit_after_the_day_counted_as_credited', file: 'collectionReading.ts', test: COLLECTION,
    from: 'if (row.validityDate <= accountingDate) {', to: 'if (row.validityDate <= today) {' },
  { name: 'c11_cheque_matched_without_number', file: 'collectionReading.ts', test: COLLECTION,
    from: 'return deposit.dueDate === null && row.chequeNumber !== null && deposit.number !== null && deposit.number === row.chequeNumber;',
    to: 'return deposit.dueDate === null;' },
  { name: 'c12_hidden_sheet_read', file: 'collectionReading.ts', test: COLLECTION,
    from: '    if (hidden.has(sheetName)) return false;\n', to: '' },
  { name: 'c16_receipt_after_the_day_counted', file: 'collectionReading.ts', test: COLLECTION,
    from: "    if (row.receiptDate > accountingDate) { row.checkReason = 'RECEIPT_AFTER_ACCOUNTING_DATE'; continue; }\n", to: '' },
  { name: 'c17_other_instrument_not_flagged', file: 'collectionReading.ts', test: COLLECTION,
    from: "    if (row.instrument !== 'EFFET' && row.instrument !== 'CHEQUE') { row.checkReason = 'INSTRUMENT_NOT_IDENTIFIED'; continue; }\n", to: '' },
  { name: 'c18_two_visible_sheets_accepted', file: 'collectionReading.ts', test: COLLECTION,
    from: "  if (compatible.length > 1) return { available: false, reason: 'SHEET_AMBIGUOUS', sheetName: null, rows: [] };\n", to: '' },
  { name: 'c13_past_maturities_listed', file: 'collectionReading.ts', test: COLLECTION,
    from: ' && row.dueDate > accountingDate', to: '' },
  { name: 'c14_missing_amount_not_flagged', file: 'collectionReading.ts', test: COLLECTION,
    from: "    if (row.amount === null) { row.checkReason = 'AMOUNT_MISSING'; continue; }\n", to: '' },
  { name: 'c15_loose_deposit_bank_label_accepted', file: 'collectionReading.ts', test: COLLECTION,
    from: 'depositBank: detectBankFromStrictLabel(depositBankRaw),', to: "depositBank: detectBankFromStrictLabel(depositBankRaw.split(' ')[0])," },
  // Fund Position.
  { name: 'f01_tab_name_taken_as_proof_of_date', file: 'fundPositionReading.ts', test: FUND,
    from: 'const dateComparable = reference.referenceDate !== null && reference.referenceDate === accountingDate;', to: 'const dateComparable = true;' },
  { name: 'f15_several_written_dates_accepted', file: 'fundPositionReading.ts', test: FUND,
    from: 'referenceDate: dates.size === 1 ? Array.from(dates)[0] : null,', to: 'referenceDate: dates.size >= 1 ? Array.from(dates)[0] : null,' },
  { name: 'f16_currency_presumed_when_not_written', file: 'fundPositionReading.ts', test: FUND,
    from: ": reading.currency !== SITUATION_EXPECTED_CURRENCY ? 'CURRENCY_NOT_COMPARABLE' : null;", to: ': null;' },
  { name: 'f02_absent_cell_read_as_zero', file: 'fundPositionReading.ts', test: FUND,
    from: "    issues.push({ code: 'CELL_ABSENT', address, bank });\n    return { address, value: null };",
    to: "    issues.push({ code: 'CELL_ABSENT', address, bank });\n    return { address, value: 0 };" },
  { name: 'f03_rows_read_past_bank_block', file: 'fundPositionReading.ts', test: FUND,
    from: '    if (labels.some((label) => BLOCK_END.test(normalizeLabel(label)))) break;\n', to: '' },
  { name: 'f04_ambiguous_bank_row_read', file: 'fundPositionReading.ts', test: FUND,
    from: 'if (bankRows.length > 1) {', to: 'if (false) {' },
  { name: 'f05_missing_source_compared_as_zero', file: 'fundPositionReading.ts', test: FUND,
    from: "if (source === null) return { bank, indicator, status: 'NOT_COMPARABLE', reason: 'SOURCE_UNAVAILABLE', declared, source, delta: null };",
    to: 'if (source === null) source = 0;' },
  { name: 'f06_issue_carries_source_content', file: 'fundPositionReading.ts', test: FUND,
    from: "issues.push({ code: 'BANK_LABEL_UNKNOWN', address: cellAddress(row, 2), bank: null });",
    to: "issues.push({ code: 'BANK_LABEL_UNKNOWN', address: bankLabel, bank: null });" },
  { name: 'f07_declared_net_trusted_as_recalculated', file: 'fundPositionReading.ts', test: FUND,
    from: '      ? declared.bankBalance.value - declared.fundApplied.value\n      : null;',
    to: '      ? (declared.netBalance.value ?? declared.bankBalance.value - declared.fundApplied.value)\n      : null;' },
  { name: 'f08_tab_dated_after_today_read', file: 'fundPositionReading.ts', test: FUND,
    from: '.filter((tab) => tab.date !== null && tab.date > accountingDate && tab.date <= today)', to: '.filter((tab) => tab.date !== null && tab.date > accountingDate)' },
  { name: 'f09_other_currency_compared', file: 'fundPositionReading.ts', test: FUND,
    from: "      ?? (statementUsable && balance!.currency !== reading.currency ? 'CURRENCY_NOT_COMPARABLE' : null);", to: '      ?? null;' },
  { name: 'f10_hidden_tab_read', file: 'fundPositionReading.ts', test: FUND,
    from: '    .filter((name) => !hidden.has(name))\n', to: '' },
  { name: 'f11_repeated_header_accepted', file: 'fundPositionReading.ts', test: FUND,
    from: '          if (columns[key] !== undefined) return null;\n', to: '' },
  { name: 'f12_other_day_workbook_compared', file: 'fundPositionReading.ts', test: FUND,
    from: "      ?? (workbook !== null && workbook.balanceDate !== accountingDate ? 'DATE_NOT_COMPARABLE' : null);", to: '      ?? null;' },
  { name: 'f13_loose_bank_label_accepted', file: 'fundPositionReading.ts', test: FUND,
    from: 'const bank = detectBankFromStrictLabel(bankLabel);', to: "const bank = detectBankFromStrictLabel(bankLabel.split(' ')[0]);" },
  { name: 'f14_two_tabs_on_the_same_date_accepted', file: 'fundPositionReading.ts', test: FUND,
    from: "  if (tabs.filter((candidate) => candidate.date === tab.date).length > 1) return unavailable('TAB_AMBIGUOUS');\n", to: '' },
  // Navigateur, garde et session.
  { name: 'g01_production_opened_by_flag', file: 'situationRuntimeTarget.ts', test: BROWSER,
    from: 'export function validateSituationRuntimeTarget(input: SituationRuntimeInput): SituationRuntimeVerdict {\n',
    to: "export function validateSituationRuntimeTarget(input: SituationRuntimeInput): SituationRuntimeVerdict {\n  if (input.stagingEnabled === 'true') return { allowed: true, environment: 'staging' };\n" },
  { name: 'g02_page_mounted_when_refused', file: 'SituationRoute.tsx', test: BROWSER,
    from: 'if (isSituationRuntimeRefused(verdict)) {', to: 'if (false) {' },
  { name: 'g03_menu_always_visible', file: 'situationMenu.ts', test: BROWSER,
    from: 'return !isSituationRuntimeRefused(currentSituationRuntimeVerdict());', to: 'return true;' },
  { name: 'g04_clear_keeps_file_bytes', file: 'situationSession.ts', test: BROWSER,
    from: '      generation += 1;\n      state.files.forEach(wipe);\n', to: '      generation += 1;\n' },
  { name: 'g05_feature_logs_data', file: 'situationCompute.ts', test: BROWSER,
    from: '  const files = input.files.map((file) => classifySituationFile(file.name));',
    to: `  ${LOG_CALL}(input.files.length);\n  const files = input.files.map((file) => classifySituationFile(file.name));` },
  { name: 'g06_duplicate_workbooks_used', file: 'situationCompute.ts', test: BROWSER,
    from: '  const workbooks = readWorkbooks.map((workbook) => (duplicated(workbook)\n', to: '  const workbooks = readWorkbooks.map((workbook) => (false\n' },
  { name: 'g07_local_target_without_flag', file: 'situationRuntimeTarget.ts', test: BROWSER,
    from: "    if (input.localEnabled !== 'true') {", to: '    if (false) {' },
  { name: 'g08_stale_result_kept_after_attestation', file: 'situationSession.ts', test: BROWSER,
    from: '      update({ attestations: { ...state.attestations, [fileName]: attestation }, result: null, error: null });',
    to: '      update({ attestations: { ...state.attestations, [fileName]: attestation }, error: null });' },
  { name: 'g09_future_accounting_date_accepted', file: 'situationCompute.ts', test: BROWSER,
    from: "  if (input.accountingDate > input.today) throw new SituationInputError('ACCOUNTING_DATE_IN_FUTURE');\n", to: '' },
  { name: 'g10_attestation_kept_for_replaced_file', file: 'situationSession.ts', test: BROWSER,
    from: '      names.forEach((name) => { delete attestations[name]; });\n', to: '' },
  { name: 'g11_file_reloaded_after_clear', file: 'situationSession.ts', test: BROWSER,
    from: '      if (startedAt !== generation) {', to: '      if (false) {' },
  { name: 'g12_file_count_limit_removed', file: 'situationSession.ts', test: BROWSER,
    from: 'if (state.files.length + incoming.length > SITUATION_MAX_FILES) {', to: 'if (false) {' },
  { name: 'g13_two_collection_reports_silently_dropped', file: 'situationCompute.ts', test: BROWSER,
    from: "  if (collectionFiles.length > 1) ambiguities.push('SEVERAL_COLLECTION_REPORTS');\n", to: '' },
  { name: 'g14_staging_without_exact_origin', file: 'situationRuntimeTarget.ts', test: BROWSER,
    from: '  if (!isExactOrigin(url, STAGING_ORIGIN)) {', to: '  if (false) {' },
  { name: 'g15_page_origin_ignored', file: 'situationRuntimeTarget.ts', test: BROWSER,
    from: '  if (!isLoopbackPage(input.pageOrigin)) {', to: '  if (false) {' },
  { name: 'g16_single_usable_workbook_kept_among_duplicates', file: 'situationCompute.ts', test: BROWSER,
    from: '    && readWorkbooks.filter((other) => other.bank === workbook.bank).length > 1;',
    to: '    && workbook.available && readWorkbooks.filter((other) => other.available && other.bank === workbook.bank).length > 1;' },
  { name: 'g17_page_with_credentials_in_origin_accepted', file: 'situationRuntimeTarget.ts', test: BROWSER,
    from: "  return (url.protocol === 'http:' || url.protocol === 'https:') && url.username === '' && url.password === ''\n    && LOCAL_HOSTS.has(normalizedHost(url));",
    to: "  return LOCAL_HOSTS.has(normalizedHost(url));" },
];

function runs(testFile: string): boolean {
  try {
    execFileSync(process.execPath, [tsxCli, '--test', testFile], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// Base verte exigée : un mutant « tué » par une suite déjà rouge ne prouverait rien.
for (const testFile of [BALANCES, WORKBOOK, COLLECTION, FUND, BROWSER]) {
  if (!runs(testFile)) throw new Error(`BASELINE_NOT_GREEN ${testFile.split(/[\\/]/).pop()}`);
}

let killed = 0;
const survivors: string[] = [];
for (const mutant of mutants) {
  const file = resolve(dir, mutant.file);
  const original = readFileSync(file, 'utf8');
  // Extraction Windows (autocrlf) : les cibles multilignes suivent les fins de ligne du fichier.
  const eol = original.includes('\r\n') ? '\r\n' : '\n';
  const from = mutant.from.split('\n').join(eol);
  if (original.split(from).length !== 2) throw new Error(`MUTANT_TARGET_NOT_UNIQUE ${mutant.name}`);
  writeFileSync(file, original.replace(from, mutant.to.split('\n').join(eol)));
  let survived = false;
  try {
    survived = runs(mutant.test);
  } finally {
    writeFileSync(file, original);
  }
  if (readFileSync(file, 'utf8') !== original) throw new Error(`RESTORE_FAILED ${mutant.name}`);
  if (survived) {
    survivors.push(mutant.name);
    process.stdout.write(`SURVIVED ${mutant.name}\n`);
    continue;
  }
  killed += 1;
  process.stdout.write(`KILLED ${mutant.name} -> ${mutant.test.split(/[\\/]/).pop()}\n`);
}
process.stdout.write(`TS MUTANTS killed: ${killed} / ${mutants.length}\n`);
if (survivors.length > 0) throw new Error(`MUTANTS_SURVIVED ${survivors.join(', ')}`);
