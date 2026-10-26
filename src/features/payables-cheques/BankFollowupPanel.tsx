import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  decideBankMatch,
  proposeBankMatches,
  readAccountPositions,
  readBankFollowupLines,
  scanMatchEvidence,
} from './payablesChequesService';
import type { PayablesAccess } from './payablesChequesTypes';
import { Amount, Field, hasCapability, nativeSelectClass, PAYABLES_QUERY_ROOT, today, usePayablesMutation } from './payablesUi';

const OUTCOME_LABELS: Record<string, string> = {
  REFERENCE: 'Référence extraite',
  NO_REFERENCE: 'Famille reconnue, numéro absent',
  AMBIGUOUS: 'Nombres concurrents',
  EXCLUDED_FEE: 'Frais (exclu)',
  EXCLUDED_WITHDRAWAL: 'Retrait (exclu)',
  UNKNOWN_FORM: 'Forme inconnue',
  NOT_CHEQUE: 'Hors chèque',
  BANK_NOT_QUALIFIED: 'Banque non qualifiée',
};

function monthAgo(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function BankFollowupPanel({ access }: { access: PayablesAccess }) {
  const accounts = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'positions', today()], queryFn: () => readAccountPositions(today()) });
  const [accountId, setAccountId] = useState('');
  const [period, setPeriod] = useState({ from: monthAgo(), to: today() });
  const lines = useQuery({
    queryKey: [PAYABLES_QUERY_ROOT, 'followup', accountId, period.from, period.to],
    queryFn: () => readBankFollowupLines(accountId, period.from, period.to),
    enabled: accountId !== '',
  });
  const propose = usePayablesMutation('propose-matches', (key, _: void) => proposeBankMatches(key, accountId, period.to),
    'Propositions calculées (correspondances exactes uniquement).');
  const decide = usePayablesMutation('decide-match', (key, input: { id: string; version: number; decision: 'CONFIRM' | 'REJECT' }) =>
    decideBankMatch(key, input.id, input.version, input.decision, input.decision === 'REJECT' ? 'Rejet par le suivi bancaire' : null),
  'Décision enregistrée après recontrôle serveur.');
  const scan = usePayablesMutation('scan-evidence', (key, _: void) => scanMatchEvidence(key), 'Contrôle des relevés remplacés effectué.');
  const canFollow = hasCapability(access, 'BANK_FOLLOWUP');

  return (
    <Card>
      <CardHeader>
        <CardTitle>Suivi bancaire des chèques</CardTitle>
        <CardDescription>
          Propositions issues de grammaires fermées par banque (BDK, ORA, ATB, BICIS) ; chaque proposition est confirmée par
          un comptable habilité. Montant et date seuls ne suffisent jamais ; le libellé bancaire n’est pas affiché.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="Compte" htmlFor="followup-account">
            <select id="followup-account" className={nativeSelectClass} value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">—</option>
              {(accounts.data ?? []).map((a) => (
                <option key={a.account_id} value={a.account_id}>{a.bank} — {a.account_alias}{a.bank_qualified ? '' : ' (non qualifiée)'}</option>
              ))}
            </select>
          </Field>
          <Field label="Du" htmlFor="followup-from">
            <Input id="followup-from" type="date" value={period.from} onChange={(e) => setPeriod({ ...period, from: e.target.value })} />
          </Field>
          <Field label="Au (cutoff)" htmlFor="followup-to">
            <Input id="followup-to" type="date" value={period.to} onChange={(e) => setPeriod({ ...period, to: e.target.value })} />
          </Field>
          {canFollow && (
            <div className="flex items-end gap-2">
              <Button onClick={() => propose.mutate()} disabled={!accountId || propose.isPending}>Proposer</Button>
              <Button variant="outline" onClick={() => scan.mutate()}>Relevés remplacés</Button>
            </div>
          )}
        </div>
        {lines.error && <p className="text-sm text-destructive">{(lines.error as Error).message}</p>}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Débit</TableHead>
              <TableHead>Résultat</TableHead>
              <TableHead>Référence</TableHead>
              <TableHead>Proposition</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(lines.data ?? []).map((line) => (
              <TableRow key={line.line_id} className={line.is_active ? '' : 'opacity-50'}>
                <TableCell>{line.accounting_date}{line.value_date && line.value_date !== line.accounting_date ? ` (valeur ${line.value_date})` : ''}</TableCell>
                <TableCell><Amount value={line.debit_amount} /></TableCell>
                <TableCell>{line.outcome ? OUTCOME_LABELS[line.outcome] ?? line.outcome : 'Non calculé'}{line.is_active ? '' : ' · ligne remplacée'}</TableCell>
                <TableCell className="font-mono">{line.reference_text ?? '—'}</TableCell>
                <TableCell>
                  {line.proposal_status && <Badge variant="outline">{line.proposal_status}</Badge>}
                  {canFollow && line.proposal_status === 'PROPOSED' && line.proposal_id && line.proposal_version !== null && (
                    <span className="ml-2 inline-flex gap-1">
                      <Button size="sm" onClick={() => decide.mutate({ id: line.proposal_id!, version: line.proposal_version!, decision: 'CONFIRM' })}>
                        Confirmer
                      </Button>
                      <Button size="sm" variant="outline"
                        onClick={() => decide.mutate({ id: line.proposal_id!, version: line.proposal_version!, decision: 'REJECT' })}>
                        Rejeter
                      </Button>
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
