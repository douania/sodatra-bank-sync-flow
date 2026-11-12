import { useEffect, useMemo, useSyncExternalStore } from 'react';
import type { ChangeEvent, ReactNode } from 'react';

import { COLLECTION_CHECK_LABELS, COLLECTION_STATE_LABELS } from './collectionReading';
import type { CollectionState } from './collectionReading';
import { FUND_POSITION_INDICATOR_LABELS, FUND_POSITION_REASON_LABELS } from './fundPositionReading';
import { WORKBOOK_REASON_LABELS } from './monthlyWorkbook';
import { SITUATION_AMBIGUITY_LABELS, SITUATION_FILE_KIND_LABELS } from './situationCompute';
import type { SituationResult } from './situationCompute';
import { SITUATION_BANK_LABELS, SITUATION_EXPECTED_CURRENCY, formatIsoFr, isoToExcelSerial, excelSerialToIso } from './situationCore';
import { SITUATION_SESSION_ERROR_LABELS, createSituationSession } from './situationSession';
import { BALANCE_REASON_LABELS } from './statementBalances';

const amountFormat = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 });

function formatAmount(value: number | null | undefined): string {
  return typeof value === 'number' ? amountFormat.format(value) : '—';
}

function localTodayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function previousDayIso(iso: string): string {
  return excelSerialToIso(isoToExcelSerial(iso) - 1) ?? iso;
}

function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <h2 className="text-base font-semibold">{props.title}</h2>
      {props.hint ? <p className="mt-1 text-sm text-muted-foreground">{props.hint}</p> : null}
      <div className="mt-3 overflow-x-auto">{props.children}</div>
    </section>
  );
}

function Badge(props: { tone: 'ok' | 'warn' | 'off'; children: ReactNode }) {
  const tone = props.tone === 'ok' ? 'bg-emerald-100 text-emerald-900' : props.tone === 'warn' ? 'bg-amber-100 text-amber-900' : 'bg-slate-100 text-slate-700';
  return <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${tone}`}>{props.children}</span>;
}

const CELL = 'border-b px-2 py-1 text-left align-top text-sm';
const NUM = 'border-b px-2 py-1 text-right align-top text-sm tabular-nums';

function Balances({ result }: { result: SituationResult }) {
  return (
    <Section
      title={`Soldes à la clôture du ${formatIsoFr(result.accountingDate)}`}
      hint="Seuls les soldes prouvés entrent dans le total. Un compte à revoir ou indisponible est nommé, jamais additionné."
    >
      <table className="w-full border-collapse">
        <thead>
          <tr><th className={CELL}>Banque</th><th className={CELL}>État</th><th className={NUM}>Solde ({SITUATION_EXPECTED_CURRENCY})</th><th className={CELL}>Journée du solde</th><th className={CELL}>Motif</th></tr>
        </thead>
        <tbody>
          {result.balances.map((balance) => (
            <tr key={balance.bank}>
              <td className={CELL}>{SITUATION_BANK_LABELS[balance.bank]}</td>
              <td className={CELL}>
                {balance.status === 'AVAILABLE' ? <Badge tone="ok">Prouvé</Badge> : balance.status === 'TO_REVIEW' ? <Badge tone="warn">À revoir</Badge> : <Badge tone="off">Indisponible</Badge>}
              </td>
              <td className={NUM}>{balance.status === 'AVAILABLE' ? formatAmount(balance.amount) : '—'}</td>
              <td className={CELL}>{formatIsoFr(balance.balanceDate)}</td>
              <td className={CELL}>
                {balance.reasons.map((reason) => BALANCE_REASON_LABELS[reason]).join(' ; ') || (balance.identityProof === 'OPERATOR' ? 'Identité attestée par l’opérateur' : '')}
                {balance.status === 'AVAILABLE' && balance.sources.some((source) => source.role !== 'retained') ? (
                  <div className="text-muted-foreground">
                    {balance.sources.filter((source) => source.role === 'duplicate').length} doublon(s), {balance.sources.filter((source) => source.role === 'excluded').length} relevé(s) écarté(s) pour ce compte
                  </div>
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {result.consolidation.map((total) => (
        <p key={total.currency} className="mt-3 text-sm">
          <strong>Total {total.currency} : </strong>
          {total.status === 'UNAVAILABLE' ? 'indisponible (aucun solde prouvé)' : formatAmount(total.amount)}{' '}
          {total.status === 'COMPLETE' ? <Badge tone="ok">COMPLET</Badge> : total.status === 'PARTIAL' ? <Badge tone="warn">PARTIEL</Badge> : <Badge tone="off">INDISPONIBLE</Badge>}
          {total.missingBanks.length > 0 ? ` — comptes manquants : ${total.missingBanks.map((bank) => SITUATION_BANK_LABELS[bank]).join(', ')}` : ''}
        </p>
      ))}
    </Section>
  );
}

function Encours({ result }: { result: SituationResult }) {
  if (result.workbooks.length === 0) return null;
  return (
    <Section title="Encours des classeurs mensuels" hint="Onglet portant la position à la date comptable. Une section dont les lignes ne prouvent pas le total déclaré reste indisponible.">
      <table className="w-full border-collapse">
        <thead>
          <tr>
            <th className={CELL}>Banque</th><th className={CELL}>Onglet</th><th className={NUM}>Ouverture</th>
            <th className={NUM}>Dépôts en attente</th><th className={NUM}>Chèques non débités</th><th className={NUM}>Solde comptable</th>
            <th className={CELL}>Facilités</th><th className={CELL}>Impayés</th>
          </tr>
        </thead>
        <tbody>
          {result.workbooks.map((workbook) => (
            <tr key={workbook.fileName}>
              <td className={CELL}>{workbook.bank ? SITUATION_BANK_LABELS[workbook.bank] : '—'}</td>
              {workbook.available ? (
                <>
                  <td className={CELL}>
                    {workbook.tabName}
                    {workbook.ignoredFutureTabs > 0 ? <div className="text-muted-foreground">{workbook.ignoredFutureTabs} onglet(s) daté(s) dans le futur ignoré(s)</div> : null}
                  </td>
                  <td className={NUM}>{formatAmount(workbook.openingBalance)}</td>
                  <td className={NUM}>{workbook.deposits.available ? `${formatAmount(workbook.deposits.declaredTotal)} (${workbook.deposits.lines.length})` : 'indisponible'}</td>
                  <td className={NUM}>
                    {workbook.cheques.available ? `${formatAmount(workbook.cheques.declaredTotal)} (${workbook.cheques.lines.length})` : 'indisponible'}
                    {workbook.chequesOutsideTotal > 0 ? ` · ${workbook.chequesOutsideTotal} ancien(s) hors total` : ''}
                  </td>
                  <td className={NUM}>{formatAmount(workbook.closingBookBalance)}</td>
                  <td className={CELL}>
                    {workbook.facilities.available
                      ? workbook.facilities.lines.map((line) => (
                        <div key={line.rowNumber}>{line.label} : {line.used === null ? 'utilisé non renseigné' : formatAmount(line.used)} / {line.limit === null ? 'plafond non renseigné' : formatAmount(line.limit)}</div>
                      ))
                      : 'indisponible'}
                    {workbook.facilities.excludedUnlabeledRows > 0 ? <div className="text-muted-foreground">{workbook.facilities.excludedUnlabeledRows} ligne(s) sans libellé écartée(s)</div> : null}
                    {workbook.facilities.unattributedRows > 0 ? <div className="text-muted-foreground">{workbook.facilities.unattributedRows} ligne(s) non attribuée(s)</div> : null}
                  </td>
                  <td className={CELL}>{workbook.impayes.available ? `${workbook.impayes.lines.length} ligne(s)` : 'indisponible'}</td>
                </>
              ) : (
                <td className={CELL} colSpan={7}><Badge tone="off">Indisponible</Badge> {workbook.reason ? WORKBOOK_REASON_LABELS[workbook.reason] : ''}</td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Section>
  );
}

function Collections({ result }: { result: SituationResult }) {
  const collection = result.collection;
  if (!collection) return null;
  if (!collection.reading.available || !collection.summary) {
    return <Section title="Tombées (Collection Report)"><p className="text-sm">Collection Report illisible : aucune tombée n’est affichée.</p></Section>;
  }
  const summary = collection.summary;
  const toVerify = collection.rows.filter((row) => row.state === 'A_VERIFIER');
  return (
    <Section title="Tombées (Collection Report)" hint="Seuls les dépôts en attente de crédit sont des entrées attendues. Un effet déjà crédité ne compte pas une seconde fois à son échéance.">
      <p className="text-sm">
        {(Object.keys(summary.countByState) as CollectionState[]).map((state) => `${COLLECTION_STATE_LABELS[state]} : ${summary.countByState[state]}`).join(' · ')}
      </p>
      <p className="mt-2 text-sm">
        <strong>Entrées attendues : {formatAmount(summary.expectedInflowsTotal)}</strong>
        {summary.expectedInflows.map((entry) => ` · ${SITUATION_BANK_LABELS[entry.bank]} ${formatAmount(entry.amount)} (${entry.count})`).join('')}
      </p>
      <p className="mt-1 text-sm text-muted-foreground">À vérifier, hors total : {formatAmount(summary.toVerifyAmount)} ({toVerify.length} ligne(s))</p>
      {toVerify.length > 0 ? (
        <table className="mt-2 w-full border-collapse">
          <thead><tr><th className={CELL}>Ligne</th><th className={CELL}>Client</th><th className={CELL}>Banque de dépôt</th><th className={NUM}>Montant</th><th className={CELL}>Motif</th></tr></thead>
          <tbody>
            {toVerify.slice(0, 50).map((row) => (
              <tr key={row.rowNumber}>
                <td className={CELL}>{row.rowNumber}</td><td className={CELL}>{row.client}</td><td className={CELL}>{row.depositBankRaw}</td>
                <td className={NUM}>{formatAmount(row.amount)}</td><td className={CELL}>{row.checkReason ? COLLECTION_CHECK_LABELS[row.checkReason] : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {summary.creditedEffetMaturities.length > 0 ? (
        <>
          <h3 className="mt-4 text-sm font-semibold">Échéances d’effets déjà crédités (suivi du risque, pas une entrée)</h3>
          <table className="mt-1 w-full border-collapse">
            <thead><tr><th className={CELL}>Échéance</th><th className={CELL}>Banque</th><th className={NUM}>Effets</th><th className={NUM}>Nominal</th></tr></thead>
            <tbody>
              {summary.creditedEffetMaturities.slice(0, 60).map((bucket) => (
                <tr key={`${bucket.dueDate}-${bucket.bank}`}>
                  <td className={CELL}>{formatIsoFr(bucket.dueDate)}</td><td className={CELL}>{SITUATION_BANK_LABELS[bucket.bank]}</td>
                  <td className={NUM}>{bucket.count}</td><td className={NUM}>{formatAmount(bucket.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : null}
    </Section>
  );
}

function FundPosition({ result }: { result: SituationResult }) {
  const fundPosition = result.fundPosition;
  if (!fundPosition) return null;
  if (!fundPosition.reading.available) {
    return (
      <Section title="Comparaison avec la Fund Position">
        <p className="text-sm">{fundPosition.reading.reason ? FUND_POSITION_REASON_LABELS[fundPosition.reading.reason] : ''} La Fund Position n’est pas comparée.</p>
      </Section>
    );
  }
  const differing = fundPosition.comparisons.filter((comparison) => comparison.status === 'DIFFERENT');
  const equal = fundPosition.comparisons.filter((comparison) => comparison.status === 'EQUAL').length;
  const notComparable = fundPosition.comparisons.filter((comparison) => comparison.status === 'NOT_COMPARABLE').length;
  return (
    <Section title={`Comparaison avec la Fund Position (onglet ${fundPosition.reading.tabName})`} hint="La Fund Position Excel est une référence comparative : l’écart est déclaré moins source vérifiée.">
      <p className="text-sm">
        Date de référence écrite dans l’onglet : {fundPosition.reading.referenceDate ? formatIsoFr(fundPosition.reading.referenceDate) : 'non établie'} ·
        Devise écrite dans l’onglet : {fundPosition.reading.currency ?? 'non établie'}
      </p>
      {!fundPosition.reading.dateComparable || fundPosition.reading.currency !== SITUATION_EXPECTED_CURRENCY ? (
        <p className="text-sm"><Badge tone="warn">Non comparable</Badge> Le document n’établit pas lui-même une date de référence égale à la date comptable et une devise : la référence est affichée telle que lue, sans écart chiffré.</p>
      ) : null}
      <table className="mt-2 w-full border-collapse">
        <thead><tr><th className={CELL}>Banque (référence lue)</th><th className={NUM}>Bank Balance</th><th className={NUM}>Fund Applied</th><th className={NUM}>Net Balance</th><th className={NUM}>NonValidated Deposit</th></tr></thead>
        <tbody>
          {fundPosition.reading.rows.map((row) => (
            <tr key={row.bank}>
              <td className={CELL}>{SITUATION_BANK_LABELS[row.bank]}</td>
              <td className={NUM}>{formatAmount(row.declared.bankBalance.value)}</td><td className={NUM}>{formatAmount(row.declared.fundApplied.value)}</td>
              <td className={NUM}>{formatAmount(row.declared.netBalance.value)}</td><td className={NUM}>{formatAmount(row.declared.nonValidatedDeposit.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm">Concordances : {equal} · Écarts : {differing.length} · Non comparables : {notComparable} · Cellules signalées : {fundPosition.reading.issues.length}</p>
      {differing.length > 0 ? (
        <table className="mt-2 w-full border-collapse">
          <thead><tr><th className={CELL}>Banque</th><th className={CELL}>Indicateur</th><th className={NUM}>Déclaré</th><th className={NUM}>Source</th><th className={NUM}>Écart</th></tr></thead>
          <tbody>
            {differing.map((comparison) => (
              <tr key={`${comparison.bank}-${comparison.indicator}`}>
                <td className={CELL}>{SITUATION_BANK_LABELS[comparison.bank]}</td><td className={CELL}>{FUND_POSITION_INDICATOR_LABELS[comparison.indicator]}</td>
                <td className={NUM}>{formatAmount(comparison.declared)}</td><td className={NUM}>{formatAmount(comparison.source)}</td><td className={NUM}>{formatAmount(comparison.delta)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
      {fundPosition.reading.issues.length > 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">Cellules signalées : {fundPosition.reading.issues.map((issue) => `${issue.address} (${issue.code})`).join(', ')}</p>
      ) : null}
    </Section>
  );
}

export function SituationDuJourPage() {
  const session = useMemo(() => createSituationSession({ today: localTodayIso, initialAccountingDate: previousDayIso(localTodayIso()) }), []);
  const state = useSyncExternalStore(session.subscribe, session.getState, session.getState);
  // Quitter l'écran efface les fichiers tenus en mémoire.
  useEffect(() => () => session.clear(), [session]);

  const onFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (list.length > 0) void session.addFiles(list);
  };
  const attest = (fileName: string, attestation: { identityAttested?: boolean; currencyAttested?: string }) => {
    session.setAttestation(fileName, attestation);
    session.compute();
  };
  const statementNeeds = state.result?.statements.filter((statement) => statement.needsIdentityAttestation || statement.needsCurrencyAttestation) ?? [];

  return (
    <div className="mx-auto max-w-6xl space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Situation du jour</h1>
        <p className="text-sm text-muted-foreground">Calcul local dans ce navigateur, à partir des fichiers déposés. Rien n’est enregistré ni envoyé.</p>
      </header>

      <Section title="Fichiers du jour">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">Date comptable
            <input type="date" className="ml-2 rounded border px-2 py-1" value={state.accountingDate} max={localTodayIso()} onChange={(event) => session.setAccountingDate(event.target.value)} />
          </label>
          <label className="text-sm">Ajouter des fichiers
            <input type="file" multiple accept=".csv,.xls,.xlsx" className="ml-2 text-sm" onChange={onFiles} />
          </label>
          <button type="button" className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50" disabled={state.files.length === 0} onClick={() => session.compute()}>Calculer</button>
          <button type="button" className="rounded border px-3 py-1 text-sm disabled:opacity-50" disabled={state.files.length === 0 && !state.result} onClick={() => session.clear()}>Effacer</button>
        </div>
        {state.error ? <p role="alert" className="mt-2 text-sm text-red-700">{SITUATION_SESSION_ERROR_LABELS[state.error]}</p> : null}
        {state.files.length > 0 ? (
          <ul className="mt-3 space-y-1 text-sm">
            {state.files.map((file) => {
              const classified = state.result?.files.find((entry) => entry.name === file.name);
              return (
                <li key={file.name} className="flex flex-wrap items-center gap-2">
                  <span>{file.name}</span>
                  {classified ? <Badge tone={classified.kind === 'UNRECOGNIZED' ? 'warn' : 'off'}>{SITUATION_FILE_KIND_LABELS[classified.kind]}</Badge> : null}
                  <button type="button" className="text-xs underline" onClick={() => session.removeFile(file.name)}>retirer</button>
                </li>
              );
            })}
          </ul>
        ) : <p className="mt-2 text-sm text-muted-foreground">Aucun fichier déposé.</p>}
      </Section>

      {statementNeeds.length > 0 ? (
        <Section title="Attestations de l’opérateur" hint="Ces relevés ne portent pas eux-mêmes l’identité du compte ou la devise. Sans attestation, leur solde reste à revoir et hors total.">
          {statementNeeds.map((statement) => {
            const current = state.attestations[statement.fileName] ?? {};
            return (
              <div key={statement.fileName} className="mb-2 text-sm">
                <div className="font-medium">{statement.fileName}</div>
                {statement.needsIdentityAttestation ? (
                  <label className="mr-4"><input type="checkbox" className="mr-1" checked={current.identityAttested === true} onChange={(event) => attest(statement.fileName, { ...current, identityAttested: event.target.checked })} />
                    J’atteste que ce fichier est le relevé du compte {statement.bank ? SITUATION_BANK_LABELS[statement.bank] : ''}
                  </label>
                ) : null}
                {statement.needsCurrencyAttestation ? (
                  <label><input type="checkbox" className="mr-1" checked={current.currencyAttested === SITUATION_EXPECTED_CURRENCY} onChange={(event) => attest(statement.fileName, { ...current, currencyAttested: event.target.checked ? SITUATION_EXPECTED_CURRENCY : undefined })} />
                    J’atteste que ce compte est en {SITUATION_EXPECTED_CURRENCY}
                  </label>
                ) : null}
              </div>
            );
          })}
          <p className="text-xs text-muted-foreground">Le calcul est relancé à chaque attestation.</p>
        </Section>
      ) : null}

      {state.result ? (
        <>
          {state.result.ambiguities.length > 0 ? (
            <div role="alert" className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              {state.result.ambiguities.map((ambiguity) => <p key={ambiguity}>{SITUATION_AMBIGUITY_LABELS[ambiguity]}</p>)}
            </div>
          ) : null}
          <Balances result={state.result} />
          <Encours result={state.result} />
          <Collections result={state.result} />
          <FundPosition result={state.result} />
        </>
      ) : null}
    </div>
  );
}
