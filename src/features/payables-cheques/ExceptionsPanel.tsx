import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { listExceptions, resolveException } from './payablesChequesService';
import { EXCEPTION_RESOLUTIONS, type ExceptionRow, type PayablesAccess } from './payablesChequesTypes';
import { hasCapability, nativeSelectClass, PAYABLES_QUERY_ROOT, shortId, usePayablesMutation } from './payablesUi';

function ExceptionItem({ exception, access }: { exception: ExceptionRow; access: PayablesAccess }) {
  const codes = EXCEPTION_RESOLUTIONS[exception.kind] ?? [];
  const [form, setForm] = useState({ code: codes[0] ?? '', evidence: '', reason: '', amount: '' });
  const mutation = usePayablesMutation('resolve-exception', (key, _: void) => resolveException(key, exception.id, exception.row_version,
    form.code, form.code === 'AMOUNT_ESTABLISHED' && /^[1-9][0-9]*$/.test(form.amount) ? { amount: Number(form.amount) } : {},
    form.evidence, form.reason), 'Décision d’instruction enregistrée.');
  const canInstruct = hasCapability(access, 'EXCEPTION_INSTRUCT') && exception.opened_by !== access.user_id;
  return (
    <div className="space-y-2 rounded border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={exception.blocks_account || exception.blocks_invoice ? 'destructive' : 'outline'}>{exception.kind}</Badge>
        <span className="text-sm">{exception.reason}</span>
        <span className="text-xs text-muted-foreground">ouverte le {exception.opened_at.slice(0, 10)} · {shortId(exception.id)}</span>
        {exception.blocks_account && <Badge variant="secondary">Bloque le compte</Badge>}
        {exception.blocks_invoice && <Badge variant="secondary">Bloque la facture</Badge>}
      </div>
      {canInstruct ? (
        <div className="grid gap-2 sm:grid-cols-5">
          <select aria-label="Décision" className={nativeSelectClass} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })}>
            {codes.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          {form.code === 'AMOUNT_ESTABLISHED' && (
            <Input aria-label="Montant établi" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} />
          )}
          <Input aria-label="Justificatif" placeholder="Justificatif" value={form.evidence} onChange={(e) => setForm({ ...form, evidence: e.target.value })} />
          <Input aria-label="Motif" placeholder="Motif" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} />
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || form.reason.trim().length < 5}>Instruire</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Instruction par un autre habilité que l’auteur de l’exception.</p>
      )}
    </div>
  );
}

export function ExceptionsPanel({ access }: { access: PayablesAccess }) {
  const exceptions = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'exceptions'], queryFn: listExceptions });
  const open = (exceptions.data ?? []).filter((e) => e.status === 'OPEN');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Exceptions ouvertes</CardTitle>
        <CardDescription>Aucune exception ne se clôt par effacement ; aucune libération automatique d’engagement.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {exceptions.error && <p className="text-sm text-destructive">{(exceptions.error as Error).message}</p>}
        {open.map((exception) => <ExceptionItem key={exception.id} exception={exception} access={access} />)}
        {open.length === 0 && !exceptions.isLoading && <p className="text-sm text-muted-foreground">Aucune exception ouverte.</p>}
      </CardContent>
    </Card>
  );
}
