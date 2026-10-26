import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { decideTakeover, listTakeoverBatches, prepareTakeover, readAccountPositions } from './payablesChequesService';
import type { PayablesAccess } from './payablesChequesTypes';
import { parseTakeoverLines } from './printFlow';
import { Amount, Field, hasCapability, nativeSelectClass, PAYABLES_QUERY_ROOT, today, usePayablesMutation } from './payablesUi';

export function TakeoverPanel({ access }: { access: PayablesAccess }) {
  const accounts = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'positions', today()], queryFn: () => readAccountPositions(today()) });
  const batches = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'takeover'], queryFn: listTakeoverBatches });
  const [form, setForm] = useState({ accountId: '', cutoff: today(), source: '', lines: '', controlCount: '', controlTotal: '', reason: '' });
  const parsed = useMemo(() => parseTakeoverLines(form.lines), [form.lines]);
  const prepare = usePayablesMutation('prepare-takeover', (key, _: void) => prepareTakeover(key, {
    accountId: form.accountId, cutoffDate: form.cutoff, sourceLabel: form.source, controlCount: Number(form.controlCount),
    controlTotal: Number(form.controlTotal), items: parsed.items, reason: form.reason,
  }), 'Lot de reprise préparé ; approbation par un autre comptable.');
  const [decisionReason, setDecisionReason] = useState('');
  const [attest, setAttest] = useState(false);
  const decide = usePayablesMutation('decide-takeover', (key, input: { id: string; version: number; approve: boolean }) =>
    decideTakeover(key, input.id, input.version, input.approve, attest, decisionReason), 'Décision enregistrée.');

  return (
    <div className="space-y-4">
      {hasCapability(access, 'CHEQUE_PREPARE_PRINT') && (
        <Card>
          <CardHeader>
            <CardTitle>Préparer la reprise initiale</CardTitle>
            <CardDescription>
              Chèques encore en circulation à la date de bascule, une ligne par chèque :
              numéro;bénéficiaire;montant;AAAA-MM-JJ. Le nombre et le total de contrôle doivent concorder.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Field label="Compte" htmlFor="tk-account">
              <select id="tk-account" className={nativeSelectClass} value={form.accountId} onChange={(e) => setForm({ ...form, accountId: e.target.value })}>
                <option value="">—</option>
                {(accounts.data ?? []).filter((a) => a.currency === 'XOF').map((a) => (
                  <option key={a.account_id} value={a.account_id}>{a.bank} — {a.account_alias}</option>
                ))}
              </select>
            </Field>
            <Field label="Date de reprise (cutoff)" htmlFor="tk-cutoff">
              <Input id="tk-cutoff" type="date" value={form.cutoff} onChange={(e) => setForm({ ...form, cutoff: e.target.value })} />
            </Field>
            <Field label="Source" htmlFor="tk-source">
              <Input id="tk-source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} />
            </Field>
            <div className="sm:col-span-3">
              <Field label="Lignes" htmlFor="tk-lines">
                <Textarea id="tk-lines" rows={6} value={form.lines} onChange={(e) => setForm({ ...form, lines: e.target.value })} />
              </Field>
              {parsed.errors.length > 0 && <ul className="mt-1 text-sm text-destructive">{parsed.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
              <p className="mt-1 text-sm text-muted-foreground">
                Lu : {parsed.items.length} ligne(s), total <Amount value={parsed.items.reduce((sum, i) => sum + i.amount, 0)} />
              </p>
            </div>
            <Field label="Nombre de contrôle" htmlFor="tk-count">
              <Input id="tk-count" inputMode="numeric" value={form.controlCount} onChange={(e) => setForm({ ...form, controlCount: e.target.value })} />
            </Field>
            <Field label="Total de contrôle (XOF)" htmlFor="tk-total">
              <Input id="tk-total" inputMode="numeric" value={form.controlTotal} onChange={(e) => setForm({ ...form, controlTotal: e.target.value })} />
            </Field>
            <Field label="Motif" htmlFor="tk-reason">
              <Input id="tk-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
            </Field>
            <Button className="sm:col-span-3" onClick={() => prepare.mutate()}
              disabled={prepare.isPending || parsed.errors.length > 0 || parsed.items.length === 0}>
              Préparer le lot
            </Button>
          </CardContent>
        </Card>
      )}
      <Card>
        <CardHeader>
          <CardTitle>Lots de reprise</CardTitle>
          <CardDescription>Approbation par un autre comptable ; intégration une seule fois ; l’attestation d’exhaustivité complète le registre du compte.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {hasCapability(access, 'EXIT_VALIDATE') && (
            <div className="flex flex-wrap items-center gap-3">
              <Input aria-label="Motif de décision" className="max-w-sm" value={decisionReason} onChange={(e) => setDecisionReason(e.target.value)} />
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} /> J’atteste l’exhaustivité pour ce compte
              </label>
            </div>
          )}
          {(batches.data ?? []).map((batch) => (
            <div key={batch.id} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{batch.status}</Badge>
              {batch.source_label} · au {batch.cutoff_date} · {batch.control_count} chèque(s) · <Amount value={batch.control_total} />
              {batch.completeness_attested && <Badge>Exhaustivité attestée</Badge>}
              {batch.status === 'PREPARED' && hasCapability(access, 'EXIT_VALIDATE') && batch.prepared_by !== access.user_id && (
                <>
                  <Button size="sm" disabled={decisionReason.trim().length < 5}
                    onClick={() => decide.mutate({ id: batch.id, version: batch.row_version, approve: true })}>Approuver</Button>
                  <Button size="sm" variant="outline" disabled={decisionReason.trim().length < 5}
                    onClick={() => decide.mutate({ id: batch.id, version: batch.row_version, approve: false })}>Refuser</Button>
                </>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
