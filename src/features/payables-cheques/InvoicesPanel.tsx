import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  createChequeRequest,
  createInvoice,
  createSupplier,
  declareTransfer,
  listSuppliers,
  readAccounts,
  readInvoiceOverview,
} from './payablesChequesService';
import type { PayablesAccess } from './payablesChequesTypes';
import { Amount, Field, hasCapability, nativeSelectClass, PAYABLES_QUERY_ROOT, today, usePayablesMutation } from './payablesUi';

function parseAmount(text: string): number | null {
  return /^[1-9][0-9]{0,11}$/.test(text.trim()) ? Number(text.trim()) : null;
}

export function InvoicesPanel({ access }: { access: PayablesAccess }) {
  const suppliers = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'suppliers'], queryFn: listSuppliers });
  const invoices = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'invoices'], queryFn: readInvoiceOverview });
  const accounts = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'accounts'], queryFn: readAccounts });
  const activeSuppliers = useMemo(() => (suppliers.data ?? []).filter((s) => s.status === 'ACTIVE'), [suppliers.data]);

  const [supplierName, setSupplierName] = useState('');
  const [search, setSearch] = useState('');
  const similar = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return needle.length < 2 ? [] : activeSuppliers.filter((s) => s.canonical_name.toLowerCase().includes(needle)).slice(0, 8);
  }, [activeSuppliers, search]);
  const supplierMutation = usePayablesMutation('supplier', (key, name: string) =>
    createSupplier(key, name, 'Création dans le référentiel commun'), 'Fournisseur créé.');

  const [invoice, setInvoice] = useState({ supplierId: '', reference: '', amount: '', invoiceDate: '', dueDate: '', evidenceRef: '' });
  const invoiceMutation = usePayablesMutation('invoice', (key, input: typeof invoice) => createInvoice(key, {
    supplierId: input.supplierId, reference: input.reference, amount: parseAmount(input.amount) ?? Number.NaN,
    invoiceDate: input.invoiceDate || null, dueDate: input.dueDate || null, evidenceRef: input.evidenceRef,
  }), 'Facture enregistrée (une collision éventuelle est ouverte en exception).');

  const [payment, setPayment] = useState({ invoiceId: '', accountId: '', category: 'ALL_PAYMENTS', partial: false, amount: '',
    beneficiary: '', reason: '' });
  const paymentMutation = usePayablesMutation('cheque-request', (key, input: typeof payment) => createChequeRequest(key, {
    invoiceId: input.invoiceId, accountId: input.accountId, category: input.category,
    amount: input.partial ? parseAmount(input.amount) : null, partial: input.partial, beneficiary: input.beneficiary,
    reason: input.reason,
  }), 'Demande de paiement réservée.');

  const [transfer, setTransfer] = useState({ invoiceId: '', accountId: '', category: 'ALL_PAYMENTS', amount: '', bankReference: '',
    status: 'EXECUTED' as 'EXECUTED' | 'COMMITTED', executedOn: today(), evidenceRef: '', reason: '' });
  const transferMutation = usePayablesMutation('transfer', (key, input: typeof transfer) => declareTransfer(key, {
    ...input, amount: parseAmount(input.amount) ?? Number.NaN, executedOn: input.executedOn || null,
  }), 'Virement déclaré (aucun ordre bancaire émis).');

  const accountOptions = (accounts.data ?? []).filter((a) => a.currency === 'XOF');
  const openInvoices = (invoices.data ?? []).filter((i) => i.blocked || (i.remaining_amount ?? 0) > 0);

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Référentiel fournisseurs</CardTitle>
          <CardDescription>Recherchez avant toute création : un nom identique est refusé par le serveur.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <Field label="Rechercher" htmlFor="supplier-search">
            <Input id="supplier-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          {similar.length > 0 && (
            <ul className="text-sm">{similar.map((s) => <li key={s.id}>{s.canonical_name}</li>)}</ul>
          )}
          {hasCapability(access, 'SUPPLIER_MANAGE') && (
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); supplierMutation.mutate(supplierName); }}>
              <Input aria-label="Nom du fournisseur" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} />
              <Button type="submit" disabled={supplierMutation.isPending || supplierName.trim().length < 2}>Créer</Button>
            </form>
          )}
        </CardContent>
      </Card>

      {hasCapability(access, 'INVOICE_MANAGE') && (
        <Card>
          <CardHeader>
            <CardTitle>Saisir une facture</CardTitle>
            <CardDescription>Depuis l’original : fournisseur du référentiel, référence exacte, justificatif.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); invoiceMutation.mutate(invoice); }}>
              <Field label="Fournisseur" htmlFor="inv-supplier">
                <select id="inv-supplier" className={nativeSelectClass} value={invoice.supplierId}
                  onChange={(e) => setInvoice({ ...invoice, supplierId: e.target.value })}>
                  <option value="">—</option>
                  {activeSuppliers.map((s) => <option key={s.id} value={s.id}>{s.canonical_name}</option>)}
                </select>
              </Field>
              <Field label="Référence exacte" htmlFor="inv-ref">
                <Input id="inv-ref" value={invoice.reference} onChange={(e) => setInvoice({ ...invoice, reference: e.target.value })} />
              </Field>
              <Field label="Montant (XOF entier)" htmlFor="inv-amount">
                <Input id="inv-amount" inputMode="numeric" value={invoice.amount} onChange={(e) => setInvoice({ ...invoice, amount: e.target.value })} />
              </Field>
              <Field label="Échéance (facultative)" htmlFor="inv-due">
                <Input id="inv-due" type="date" value={invoice.dueDate} onChange={(e) => setInvoice({ ...invoice, dueDate: e.target.value })} />
              </Field>
              <Field label="Date de facture" htmlFor="inv-date">
                <Input id="inv-date" type="date" value={invoice.invoiceDate} onChange={(e) => setInvoice({ ...invoice, invoiceDate: e.target.value })} />
              </Field>
              <Field label="Justificatif (référence de l’original)" htmlFor="inv-evidence">
                <Input id="inv-evidence" value={invoice.evidenceRef} onChange={(e) => setInvoice({ ...invoice, evidenceRef: e.target.value })} />
              </Field>
              <Button type="submit" className="sm:col-span-2" disabled={invoiceMutation.isPending || parseAmount(invoice.amount) === null}>
                Enregistrer la facture
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Factures à payer</CardTitle>
          <CardDescription>Paiement unique du restant par défaut ; fractionnement seulement sur choix explicite.</CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Fournisseur</TableHead>
                <TableHead>Référence</TableHead>
                <TableHead>Échéance</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead>Restant à engager</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {openInvoices.map((i) => (
                <TableRow key={i.invoice_id}>
                  <TableCell>{i.supplier_name}</TableCell>
                  <TableCell>{i.reference_exact}</TableCell>
                  <TableCell>{i.due_date ?? 'Non renseignée'}</TableCell>
                  <TableCell><Amount value={i.amount} /></TableCell>
                  <TableCell>{i.blocked ? <Badge variant="destructive">Bloquée</Badge> : <Amount value={i.remaining_amount} />}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {hasCapability(access, 'CHEQUE_PREPARE_PRINT') && (
        <Card>
          <CardHeader>
            <CardTitle>Demande de paiement par chèque</CardTitle>
            <CardDescription>Réserve le montant sur la facture ; aucun impact financier avant l’émission confirmée.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); paymentMutation.mutate(payment); }}>
              <Field label="Facture" htmlFor="pay-invoice">
                <select id="pay-invoice" className={nativeSelectClass} value={payment.invoiceId}
                  onChange={(e) => setPayment({ ...payment, invoiceId: e.target.value })}>
                  <option value="">—</option>
                  {openInvoices.filter((i) => !i.blocked).map((i) => (
                    <option key={i.invoice_id} value={i.invoice_id}>{i.supplier_name} — {i.reference_exact}</option>
                  ))}
                </select>
              </Field>
              <Field label="Compte tireur" htmlFor="pay-account">
                <select id="pay-account" className={nativeSelectClass} value={payment.accountId}
                  onChange={(e) => setPayment({ ...payment, accountId: e.target.value })}>
                  <option value="">—</option>
                  {accountOptions.map((a) => <option key={a.account_id} value={a.account_id}>{a.bank} — {a.account_alias}</option>)}
                </select>
              </Field>
              <Field label="Bénéficiaire (tel qu’imprimé)" htmlFor="pay-beneficiary">
                <Input id="pay-beneficiary" value={payment.beneficiary} onChange={(e) => setPayment({ ...payment, beneficiary: e.target.value })} />
              </Field>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={payment.partial} onChange={(e) => setPayment({ ...payment, partial: e.target.checked })} />
                Paiement partiel
              </label>
              {payment.partial && (
                <Field label="Montant partiel (XOF)" htmlFor="pay-amount">
                  <Input id="pay-amount" inputMode="numeric" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} />
                </Field>
              )}
              <Field label="Motif" htmlFor="pay-reason">
                <Input id="pay-reason" value={payment.reason} onChange={(e) => setPayment({ ...payment, reason: e.target.value })} />
              </Field>
              <Button type="submit" disabled={paymentMutation.isPending}>Réserver le paiement</Button>
            </form>
          </CardContent>
        </Card>
      )}

      {hasCapability(access, 'TRANSFER_DECLARE') && (
        <Card>
          <CardHeader>
            <CardTitle>Déclarer un virement</CardTitle>
            <CardDescription>Une seule écriture ; aucun ordre bancaire ; un virement déclaré n’est pas un débit confirmé.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); transferMutation.mutate(transfer); }}>
              <Field label="Facture" htmlFor="trf-invoice">
                <select id="trf-invoice" className={nativeSelectClass} value={transfer.invoiceId}
                  onChange={(e) => setTransfer({ ...transfer, invoiceId: e.target.value })}>
                  <option value="">—</option>
                  {(invoices.data ?? []).map((i) => (
                    <option key={i.invoice_id} value={i.invoice_id}>{i.supplier_name} — {i.reference_exact}</option>
                  ))}
                </select>
              </Field>
              <Field label="Compte" htmlFor="trf-account">
                <select id="trf-account" className={nativeSelectClass} value={transfer.accountId}
                  onChange={(e) => setTransfer({ ...transfer, accountId: e.target.value })}>
                  <option value="">—</option>
                  {accountOptions.map((a) => <option key={a.account_id} value={a.account_id}>{a.bank} — {a.account_alias}</option>)}
                </select>
              </Field>
              <Field label="Montant (XOF)" htmlFor="trf-amount">
                <Input id="trf-amount" inputMode="numeric" value={transfer.amount} onChange={(e) => setTransfer({ ...transfer, amount: e.target.value })} />
              </Field>
              <Field label="Référence du virement" htmlFor="trf-ref">
                <Input id="trf-ref" value={transfer.bankReference} onChange={(e) => setTransfer({ ...transfer, bankReference: e.target.value })} />
              </Field>
              <Field label="Statut déclaré" htmlFor="trf-status">
                <select id="trf-status" className={nativeSelectClass} value={transfer.status}
                  onChange={(e) => setTransfer({ ...transfer, status: e.target.value as 'EXECUTED' | 'COMMITTED' })}>
                  <option value="EXECUTED">Effectué</option>
                  <option value="COMMITTED">Engagé, non exécuté</option>
                </select>
              </Field>
              {transfer.status === 'EXECUTED' && (
                <Field label="Date d’exécution" htmlFor="trf-date">
                  <Input id="trf-date" type="date" value={transfer.executedOn} onChange={(e) => setTransfer({ ...transfer, executedOn: e.target.value })} />
                </Field>
              )}
              <Field label="Justificatif" htmlFor="trf-evidence">
                <Input id="trf-evidence" value={transfer.evidenceRef} onChange={(e) => setTransfer({ ...transfer, evidenceRef: e.target.value })} />
              </Field>
              <Field label="Motif" htmlFor="trf-reason">
                <Input id="trf-reason" value={transfer.reason} onChange={(e) => setTransfer({ ...transfer, reason: e.target.value })} />
              </Field>
              <Button type="submit" disabled={transferMutation.isPending || parseAmount(transfer.amount) === null}>Déclarer</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
