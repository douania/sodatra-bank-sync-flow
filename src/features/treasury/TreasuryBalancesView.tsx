import {
  ACCOUNT_STATUS_LABELS,
  CONSOLIDATION_STATUS_LABELS,
  formatAmount,
  freshnessLabel,
  presentConsolidation,
  QUALIFICATION_LABELS,
  reasonLabel,
  sourceLabel,
  valueDateLabel,
  type TreasuryAccount,
  type TreasuryBalances,
} from './treasuryModel';

// Vue pure du résultat de lecture : aucune donnée de paiement, aucun total
// fabriqué. Les comptes non couverts restent listés avec leur motif ; leur
// dernier solde observé est montré à part et n'entre dans aucun sous-total.

const STATUS_STYLES: Record<TreasuryAccount['status'], string> = {
  AVAILABLE: 'bg-green-50 text-green-800 border-green-200',
  NOT_COVERED: 'bg-amber-50 text-amber-800 border-amber-200',
  BLOCKED: 'bg-red-50 text-red-800 border-red-200',
  OUT_OF_SCOPE: 'bg-gray-50 text-gray-700 border-gray-200',
};

function AccountRow({ account, windowDays }: { account: TreasuryAccount; windowDays: number }) {
  return (
    <tr className="border-b align-top" data-account-status={account.status}>
      <td className="px-3 py-2">
        <div className="font-medium">{account.bank}</div>
        <div className="text-xs text-muted-foreground">{account.alias ?? 'Alias indisponible'} · {account.currency}</div>
      </td>
      <td className="px-3 py-2">
        <span className={`inline-block rounded border px-2 py-0.5 text-xs ${STATUS_STYLES[account.status]}`}>
          {ACCOUNT_STATUS_LABELS[account.status]}
        </span>
        {account.reasons.length > 0 && (
          <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
            {account.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}
          </ul>
        )}
      </td>
      <td className="px-3 py-2 text-right font-mono">
        <div>{formatAmount(account.balance_at_date, account.currency)}</div>
        {account.observed_balance && (
          <div className="text-xs text-muted-foreground">
            Dernier solde observé, non retenu : {formatAmount(account.observed_balance.balance, account.currency)} au {account.observed_balance.date}
          </div>
        )}
      </td>
      <td className="px-3 py-2 text-xs">
        <div>{freshnessLabel(account)}</div>
        {account.sources.map((source, index) => <div key={index} className="text-muted-foreground">{sourceLabel(source)}</div>)}
      </td>
      <td className="px-3 py-2 text-xs">
        <div>{QUALIFICATION_LABELS[account.qualification] ?? account.qualification}</div>
        <div className="text-muted-foreground">{account.source_format ?? 'Format indisponible'}</div>
        <div className="text-muted-foreground">{valueDateLabel(account, windowDays)}</div>
      </td>
    </tr>
  );
}

export function TreasuryBalancesView({ result }: { result: TreasuryBalances }) {
  const consolidation = presentConsolidation(result);
  return (
    <div className="space-y-4">
      <section className="rounded-lg border bg-card p-4" aria-label="Consolidation des soldes">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          Soldes bancaires en date comptable · XOF · {CONSOLIDATION_STATUS_LABELS[consolidation.status]}
        </div>
        <div className="mt-1 text-lg font-semibold">{consolidation.headline}</div>
        <div className="mt-1 font-mono text-2xl" data-consolidation-status={consolidation.status}>{consolidation.amount}</div>
        {!consolidation.decisionGrade && (
          <p className="mt-2 text-sm text-amber-800">
            Ce montant ne couvre pas tous les comptes attendus : il ne doit pas être lu comme un total.
          </p>
        )}
        {result.consolidation.reasons.length > 0 && (
          <ul className="mt-2 list-disc pl-5 text-sm text-muted-foreground">
            {result.consolidation.reasons.map((reason) => <li key={reason}>{reasonLabel(reason)}</li>)}
          </ul>
        )}
        <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-muted-foreground sm:grid-cols-3">
          <div><dt className="inline">Date comptable D : </dt><dd className="inline">{result.as_of}</dd></div>
          <div><dt className="inline">Lu à : </dt><dd className="inline">{result.read_at} (fuseau {result.timezone})</dd></div>
          <div>
            <dt className="inline">Inventaire : </dt>
            <dd className="inline">
              {result.inventory.active_accounts} compte(s) attendu(s),{' '}
              {result.inventory.attested ? `attesté le ${result.inventory.attested_at}` : 'non attesté dans son état actuel'}
            </dd>
          </div>
        </dl>
      </section>

      <section className="overflow-x-auto rounded-lg border bg-card" aria-label="Soldes par compte">
        <table className="w-full text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Compte</th>
              <th className="px-3 py-2">Statut à D</th>
              <th className="px-3 py-2 text-right">Solde à D</th>
              <th className="px-3 py-2">Date bancaire couverte et sources</th>
              <th className="px-3 py-2">Qualification</th>
            </tr>
          </thead>
          <tbody>
            {result.accounts.length === 0 && (
              <tr><td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">Aucun compte attendu dans l’inventaire.</td></tr>
            )}
            {result.accounts.map((account) => (
              <AccountRow key={account.expected_account_id} account={account} windowDays={result.value_date_window_days} />
            ))}
          </tbody>
        </table>
      </section>

      {result.inventory.unlisted_registry_accounts.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm" aria-label="Comptes hors inventaire">
          <div className="font-medium text-amber-900">Comptes du registre hors inventaire</div>
          <ul className="mt-1 list-disc pl-5 text-amber-900">
            {result.inventory.unlisted_registry_accounts.map((account) => (
              <li key={account.registry_account_id}>{account.bank} · {account.alias} · {account.currency}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
