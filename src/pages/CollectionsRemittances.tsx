import { useMemo, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, Landmark, Link2, Loader2, PlusCircle, RefreshCw } from 'lucide-react';
import { toast } from '@/components/ui/sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useAuth } from '@/contexts/AuthContext';
import {
  collectionReceiptIdentity,
  missingCollectionReceiptIdentity,
} from '@/features/collections-remittances/collectionReceiptIdentity';
import { currentCollectionsRuntimeTargetVerdict } from '@/features/collections-remittances/collectionsRuntimeTarget';
import {
  allocateCollectionInvoice,
  approveCollectionFundingCheque,
  attachCollectionProrogationSource,
  attachCollectionReplacementEffect,
  confirmCollectionFundingDelivery,
  confirmCollectionMatch,
  createCollectionIdempotencyKey,
  createCollectionProrogation,
  createCollectionReceipt,
  getCollectionsAccessContext,
  listActiveCollectionDailyLines,
  listCollectionAccounts,
  listCollectionEvidenceAlerts,
  listCollectionInstruments,
  listCollectionMatchProposals,
  listCollectionOutboundCheques,
  listCollectionProrogations,
  listCollectionReceipts,
  prepareCollectionFundingCheque,
  proposeCollectionMatch,
} from '@/features/collections-remittances/collectionsService';
import type {
  CollectionBusinessNature,
  CollectionCapability,
  CollectionInstrumentRow,
  CollectionMatchProposalRow,
  CollectionMethod,
  CollectionProrogationRow,
  CollectionReceiptRow,
} from '@/features/collections-remittances/collectionsTypes';

const money = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'XOF', maximumFractionDigits: 0 });
const queryRoot = ['collections-remittances-0z1b'] as const;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Opération Collections impossible.';
}

function statusBadge(status: string) {
  const positive = ['CONFIRMED', 'SETTLED', 'FUNDING_COMPLETE', 'DELIVERED', 'ACTIVE'].includes(status);
  const warning = ['PROPOSED', 'PARTIALLY_MATCHED', 'PARTIALLY_SETTLED', 'FUNDING_PARTIAL', 'DRAFT'].includes(status);
  return <Badge variant={positive ? 'default' : warning ? 'secondary' : 'outline'}>{status}</Badge>;
}

const CollectionsRemittances = () => {
  const target = currentCollectionsRuntimeTargetVerdict('read');
  if (target.allowed === false) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <Alert className="border-amber-300 bg-amber-50">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          <AlertTitle>Candidat Collections 0Z1B non actif</AlertTitle>
          <AlertDescription>
            {target.reason} Aucun appel n’a été envoyé à Supabase. Cette page s’ouvre uniquement sur une
            instance locale avec <code>VITE_COLLECTIONS_0Z1B_LOCAL_ENABLED=true</code>.
          </AlertDescription>
        </Alert>
      </div>
    );
  }
  return <CollectionsLocalWorkspace />;
};

const CollectionsLocalWorkspace = () => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selectedProrogationId, setSelectedProrogationId] = useState('');
  const [confirmationReason, setConfirmationReason] = useState('Validation indépendante de la preuve bancaire');
  const [deliveryEvidence, setDeliveryEvidence] = useState('');
  const [deliveryDate, setDeliveryDate] = useState('');

  const accessQuery = useQuery({ queryKey: [...queryRoot, 'access', user?.id], queryFn: getCollectionsAccessContext });
  const access = accessQuery.data;
  const capabilities = new Set(access?.capabilities ?? []);
  const can = (capability: CollectionCapability) => capabilities.has(capability);
  const canRead = Boolean(access && access.roles.length > 0);

  const receiptsQuery = useQuery({ queryKey: [...queryRoot, 'receipts'], queryFn: () => listCollectionReceipts(), enabled: canRead });
  const prorogationsQuery = useQuery({ queryKey: [...queryRoot, 'prorogations'], queryFn: () => listCollectionProrogations(), enabled: canRead });
  const proposalsQuery = useQuery({ queryKey: [...queryRoot, 'proposals'], queryFn: () => listCollectionMatchProposals(), enabled: canRead });
  const evidenceQuery = useQuery({ queryKey: [...queryRoot, 'evidence-alerts'], queryFn: () => listCollectionEvidenceAlerts(), enabled: canRead });
  const accountsQuery = useQuery({ queryKey: [...queryRoot, 'accounts'], queryFn: listCollectionAccounts, enabled: canRead });
  const instrumentsQuery = useQuery({ queryKey: [...queryRoot, 'instruments'], queryFn: () => listCollectionInstruments(), enabled: canRead });
  const chequesQuery = useQuery({ queryKey: [...queryRoot, 'outbound-cheques'], queryFn: () => listCollectionOutboundCheques(), enabled: canRead });
  const dailyLinesQuery = useQuery({ queryKey: [...queryRoot, 'daily-lines'], queryFn: () => listActiveCollectionDailyLines(), enabled: canRead && can('PROPOSE_MATCH') });

  const refresh = async () => queryClient.invalidateQueries({ queryKey: queryRoot });
  const selectedProrogation = prorogationsQuery.data?.find((row) => row.id === selectedProrogationId) ?? null;
  const isLoading = accessQuery.isPending || (canRead && receiptsQuery.isPending);
  const queryError = [accessQuery, receiptsQuery, prorogationsQuery, proposalsQuery, evidenceQuery]
    .find((query) => query.error)?.error;

  if (isLoading) {
    return <div className="flex min-h-[40vh] items-center justify-center gap-2"><Loader2 className="h-5 w-5 animate-spin" />Chargement du domaine Collections…</div>;
  }
  if (!access || access.roles.length === 0) {
    return <Alert><AlertTriangle className="h-4 w-4" /><AlertTitle>Accès non attribué</AlertTitle><AlertDescription>Votre compte ne possède aucun rôle applicatif valide.</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold">Collections et remises</h1>
          <p className="mt-1 text-sm text-muted-foreground">Préparer, contrôler et justifier — sans paiement ni écriture comptable.</p>
        </div>
        <Button variant="outline" onClick={() => void refresh()}><RefreshCw className="mr-2 h-4 w-4" />Actualiser</Button>
      </div>

      <Alert className="border-blue-200 bg-blue-50">
        <Landmark className="h-5 w-5 text-blue-700" />
        <AlertTitle>Intégration locale 0Z1B</AlertTitle>
        <AlertDescription>Les actions passent exclusivement par les commandes serveur auditées. Les tables ne sont jamais modifiées directement.</AlertDescription>
      </Alert>
      {queryError && <Alert variant="destructive"><AlertTriangle className="h-4 w-4" /><AlertTitle>Lecture incomplète</AlertTitle><AlertDescription>{messageOf(queryError)}</AlertDescription></Alert>}

      <div className="grid gap-4 md:grid-cols-4">
        <Metric title="Remises" value={receiptsQuery.data?.length ?? 0} />
        <Metric title="À rapprocher" value={(receiptsQuery.data ?? []).filter((r) => r.settlement_state !== 'CONFIRMED').length} />
        <Metric title="Prorogations ouvertes" value={(prorogationsQuery.data ?? []).filter((p) => !['CLOSED', 'CANCELLED'].includes(p.status)).length} />
        <Metric title="Preuves à reprendre" value={evidenceQuery.data?.length ?? 0} danger={Boolean(evidenceQuery.data?.length)} />
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="overview">Suivi</TabsTrigger>
          <TabsTrigger value="capture">Nouvelle remise</TabsTrigger>
          <TabsTrigger value="prorogation">Prorogations</TabsTrigger>
          <TabsTrigger value="matching">Rapprochements</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <ReceiptTable rows={receiptsQuery.data ?? []} />
          <InvoiceAllocationForm
            disabled={!can('ENTRY')}
            receipts={receiptsQuery.data ?? []}
            onChanged={refresh}
          />
        </TabsContent>
        <TabsContent value="capture">
          <ReceiptForm disabled={!can('ENTRY')} accounts={accountsQuery.data ?? []} onCreated={refresh} />
        </TabsContent>
        <TabsContent value="prorogation" className="space-y-4">
          <ProrogationCreateForm disabled={!can('APPROVE_PROROGATION')} onCreated={refresh} />
          <Card>
            <CardHeader><CardTitle>Dossiers de prorogation</CardTitle><CardDescription>Sélectionnez un dossier pour compléter les créances, effets et chèques.</CardDescription></CardHeader>
            <CardContent className="space-y-4">
              <Select value={selectedProrogationId} onValueChange={setSelectedProrogationId}>
                <SelectTrigger><SelectValue placeholder="Choisir une prorogation" /></SelectTrigger>
                <SelectContent>{(prorogationsQuery.data ?? []).map((row) => <SelectItem key={row.id} value={row.id}>{row.client_reference} · {money.format(row.target_nominal)} · v{row.version}</SelectItem>)}</SelectContent>
              </Select>
              {selectedProrogation && <ProrogationWorkflow prorogation={selectedProrogation} canEntry={can('ENTRY')} canIssue={can('ISSUE_FUNDING_CHEQUE')} accounts={accountsQuery.data ?? []} instruments={(instrumentsQuery.data ?? []).filter((i) => i.instrument_type === 'EFFECT')} onChanged={refresh} />}
            </CardContent>
          </Card>
          <ChequeActions rows={chequesQuery.data ?? []} currentUserId={user?.id ?? ''} canApprove={can('APPROVE_PROROGATION')} canDeliver={can('CONFIRM_DELIVERY')} reason={confirmationReason} setReason={setConfirmationReason} evidence={deliveryEvidence} setEvidence={setDeliveryEvidence} deliveryDate={deliveryDate} setDeliveryDate={setDeliveryDate} onChanged={refresh} />
        </TabsContent>
        <TabsContent value="matching" className="space-y-4">
          <MatchProposalForm disabled={!can('PROPOSE_MATCH')} receipts={receiptsQuery.data ?? []} instruments={instrumentsQuery.data ?? []} dailyLines={dailyLinesQuery.data ?? []} onCreated={refresh} />
          <ProposalTable rows={proposalsQuery.data ?? []} receipts={receiptsQuery.data ?? []} instruments={instrumentsQuery.data ?? []} currentUserId={user?.id ?? ''} canConfirm={can('CONFIRM_MATCH')} reason={confirmationReason} setReason={setConfirmationReason} onChanged={refresh} />
          <EvidenceAlerts rows={evidenceQuery.data ?? []} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

const Metric = ({ title, value, danger = false }: { title: string; value: number; danger?: boolean }) => <Card><CardContent className="pt-6"><div className={`text-2xl font-bold ${danger ? 'text-red-600' : ''}`}>{value}</div><p className="text-xs text-muted-foreground">{title}</p></CardContent></Card>;

const ReceiptTable = ({ rows }: { rows: CollectionReceiptRow[] }) => <Card><CardHeader><CardTitle>Suivi des remises</CardTitle><CardDescription>La date déclarée et la preuve bancaire restent distinctes.</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Mode</TableHead><TableHead>Montant</TableHead><TableHead>Remise banque</TableHead><TableHead>Crédit déclaré</TableHead><TableHead>Acheminement</TableHead><TableHead>Règlement</TableHead><TableHead>Recours</TableHead></TableRow></TableHeader><TableBody>{rows.map((row) => <TableRow key={row.id}><TableCell><div className="font-medium">{row.client_name_snapshot}</div><div className="text-xs text-muted-foreground">{row.client_reference ?? 'Sans référence'}</div></TableCell><TableCell>{row.method}</TableCell><TableCell>{money.format(row.amount)}</TableCell><TableCell>{row.bank_submission_date}</TableCell><TableCell>{row.declared_bank_credit_date ?? <span className="text-amber-700">Aucune date déclarée</span>}</TableCell><TableCell>{statusBadge(row.routing_state)}</TableCell><TableCell>{statusBadge(row.settlement_state)}</TableCell><TableCell>{statusBadge(row.recourse_state)}</TableCell></TableRow>)}</TableBody></Table>{rows.length === 0 && <p className="py-8 text-center text-muted-foreground">Aucune remise 0Z1B locale.</p>}</CardContent></Card>;

const InvoiceAllocationForm = ({ disabled, receipts, onChanged }: { disabled: boolean; receipts: CollectionReceiptRow[]; onChanged: () => Promise<unknown> }) => {
  const [receiptId, setReceiptId] = useState('');
  const [reference, setReference] = useState('');
  const [invoiceAmount, setInvoiceAmount] = useState('');
  const [allocatedAmount, setAllocatedAmount] = useState('');
  const receipt = receipts.find((row) => row.id === receiptId);
  const mutation = useMutation({
    mutationFn: () => allocateCollectionInvoice({
      receiptId,
      invoiceReference: reference,
      invoiceAmount: invoiceAmount ? Number(invoiceAmount) : undefined,
      allocatedAmount: Number(allocatedAmount),
      expectedVersion: receipt?.version ?? 0,
      idempotencyKey: createCollectionIdempotencyKey('invoice-allocation'),
    }),
    onSuccess: async () => {
      toast.success('Facture affectée à la remise.');
      setReference('');
      setInvoiceAmount('');
      setAllocatedAmount('');
      await onChanged();
    },
    onError: (error) => toast.error(messageOf(error)),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Affecter une facture</CardTitle>
        <CardDescription>Une facture peut être réglée par plusieurs remises ou effets ; chaque affectation conserve son montant propre.</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 md:grid-cols-5">
        <Select value={receiptId} onValueChange={setReceiptId}>
          <SelectTrigger><SelectValue placeholder="Remise" /></SelectTrigger>
          <SelectContent>{receipts.filter((row) => row.business_nature !== 'PROROGATION').map((row) => <SelectItem key={row.id} value={row.id}>{row.client_name_snapshot} · {money.format(row.amount)} · v{row.version}</SelectItem>)}</SelectContent>
        </Select>
        <Input value={reference} onChange={(event) => setReference(event.target.value)} placeholder="N° de facture" />
        <Input type="number" min="0.01" step="0.01" value={invoiceAmount} onChange={(event) => setInvoiceAmount(event.target.value)} placeholder="Total facture (optionnel)" />
        <Input type="number" min="0.01" step="0.01" value={allocatedAmount} onChange={(event) => setAllocatedAmount(event.target.value)} placeholder="Montant affecté" />
        <Button disabled={disabled || mutation.isPending || !receipt || !reference.trim() || Number(allocatedAmount) <= 0} onClick={() => mutation.mutate()}>Affecter</Button>
      </CardContent>
    </Card>
  );
};

const ReceiptForm = ({ disabled, accounts, onCreated }: { disabled: boolean; accounts: Array<{ id: string; bank: string; currency: string; safe_alias: string }>; onCreated: () => Promise<unknown> }) => {
  const [method, setMethod] = useState<CollectionMethod>('CHEQUE');
  const [nature, setNature] = useState<CollectionBusinessNature>('INVOICE_SETTLEMENT');
  const [form, setForm] = useState({ clientReference: '', clientName: '', amount: '', currency: 'XOF', bankSubmissionDate: '', counterpartyBank: '', accountId: '', chequeNumber: '', effectReference: '', maturityDate: '' });
  const mutation = useMutation({ mutationFn: () => createCollectionReceipt({ clientReference: form.clientReference, clientName: form.clientName, method, businessNature: nature, amount: Number(form.amount), currency: form.currency, bankSubmissionDate: form.bankSubmissionDate, counterpartyBank: form.counterpartyBank, depositAccountRegistryId: form.accountId, chequeNumber: form.chequeNumber, effectReference: form.effectReference, maturityDate: form.maturityDate }, createCollectionIdempotencyKey('receipt')), onSuccess: async () => { toast.success('Remise créée et auditée.'); setForm({ ...form, clientReference: '', clientName: '', amount: '', chequeNumber: '', effectReference: '' }); await onCreated(); }, onError: (error) => toast.error(messageOf(error)) });
  const submit = (event: FormEvent) => { event.preventDefault(); mutation.mutate(); };
  return <Card><CardHeader><CardTitle>Nouvelle remise</CardTitle><CardDescription>Reprend les colonnes métier clarifiées du Collection Report.</CardDescription></CardHeader><CardContent><form onSubmit={submit} className="grid gap-4 md:grid-cols-2"><Field label="Référence client"><Input value={form.clientReference} onChange={(e) => setForm({ ...form, clientReference: e.target.value })} /></Field><Field label="Nom client"><Input required value={form.clientName} onChange={(e) => setForm({ ...form, clientName: e.target.value })} /></Field><Field label="Mode"><Select value={method} onValueChange={(v) => setMethod(v as CollectionMethod)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{['CHEQUE','EFFECT','TRANSFER','CASH'].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent></Select></Field><Field label="Nature"><Select value={nature} onValueChange={(v) => setNature(v as CollectionBusinessNature)}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="INVOICE_SETTLEMENT">Règlement facture</SelectItem><SelectItem value="PROROGATION">Prorogation</SelectItem><SelectItem value="OTHER">Autre</SelectItem></SelectContent></Select></Field><Field label="Montant"><Input required type="number" min="0.01" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></Field><Field label="Date de remise en banque"><Input required type="date" value={form.bankSubmissionDate} onChange={(e) => setForm({ ...form, bankSubmissionDate: e.target.value })} /></Field><Field label="Banque du client"><Input value={form.counterpartyBank} onChange={(e) => setForm({ ...form, counterpartyBank: e.target.value })} /></Field><Field label="Banque SODATRA"><Select value={form.accountId} onValueChange={(accountId) => setForm({ ...form, accountId })}><SelectTrigger><SelectValue placeholder="Compte de dépôt" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.bank} · {a.safe_alias} · {a.currency}</SelectItem>)}</SelectContent></Select></Field>{method === 'CHEQUE' && <Field label="Numéro de chèque"><Input required value={form.chequeNumber} onChange={(e) => setForm({ ...form, chequeNumber: e.target.value })} /></Field>}{method === 'EFFECT' && <><Field label="Référence effet"><Input value={form.effectReference} onChange={(e) => setForm({ ...form, effectReference: e.target.value })} /></Field><Field label="Échéance effet"><Input required type="date" value={form.maturityDate} onChange={(e) => setForm({ ...form, maturityDate: e.target.value })} /></Field></>}<div className="md:col-span-2"><Button disabled={disabled || mutation.isPending} type="submit"><PlusCircle className="mr-2 h-4 w-4" />Créer la remise</Button>{disabled && <p className="mt-2 text-sm text-amber-700">Capacité ENTRY requise.</p>}</div></form></CardContent></Card>;
};

const ProrogationCreateForm = ({ disabled, onCreated }: { disabled: boolean; onCreated: () => Promise<unknown> }) => { const [client, setClient] = useState(''); const [amount, setAmount] = useState(''); const [deadline, setDeadline] = useState(''); const mutation = useMutation({ mutationFn: () => createCollectionProrogation({ clientReference: client, targetNominal: Number(amount), currency: 'XOF', fundingDeadline: deadline, idempotencyKey: createCollectionIdempotencyKey('prorogation') }), onSuccess: async () => { toast.success('Prorogation créée.'); setClient(''); setAmount(''); await onCreated(); }, onError: (e) => toast.error(messageOf(e)) }); return <Card><CardHeader><CardTitle>Créer un dossier de prorogation</CardTitle><CardDescription>Le nominal doit ensuite être couvert exactement par les créances, les nouveaux effets et les chèques.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-4"><Input placeholder="Référence client" value={client} onChange={(e) => setClient(e.target.value)} /><Input type="number" placeholder="Nominal" value={amount} onChange={(e) => setAmount(e.target.value)} /><Input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)} /><Button disabled={disabled || mutation.isPending || !client || !amount} onClick={() => mutation.mutate()}>Créer</Button></div></CardContent></Card>; };

const ProrogationWorkflow = ({ prorogation, canEntry, canIssue, accounts, instruments, onChanged }: { prorogation: CollectionProrogationRow; canEntry: boolean; canIssue: boolean; accounts: Array<{ id: string; bank: string; safe_alias: string }>; instruments: Array<{ id: string; effect_reference: string | null; nominal_amount: number }>; onChanged: () => Promise<unknown> }) => { const [source, setSource] = useState({ type: 'RECEIVABLE', reference: '', amount: '' }); const [effectId, setEffectId] = useState(''); const [effectAmount, setEffectAmount] = useState(''); const [cheque, setCheque] = useState({ accountId: '', beneficiary: '', number: '', amount: '', date: '' }); const sourceMutation = useMutation({ mutationFn: () => attachCollectionProrogationSource({ prorogationId: prorogation.id, sourceType: source.type, sourceReference: source.reference, amount: Number(source.amount), expectedVersion: prorogation.version, idempotencyKey: createCollectionIdempotencyKey('prorogation-source') }), onSuccess: async () => { toast.success('Créance source rattachée.'); await onChanged(); }, onError: (e) => toast.error(messageOf(e)) }); const effectMutation = useMutation({ mutationFn: () => attachCollectionReplacementEffect({ prorogationId: prorogation.id, instrumentId: effectId, amount: Number(effectAmount), expectedVersion: prorogation.version, idempotencyKey: createCollectionIdempotencyKey('replacement-effect') }), onSuccess: async () => { toast.success('Effet de remplacement rattaché.'); await onChanged(); }, onError: (e) => toast.error(messageOf(e)) }); const chequeMutation = useMutation({ mutationFn: () => prepareCollectionFundingCheque({ prorogationId: prorogation.id, accountRegistryId: cheque.accountId, beneficiary: cheque.beneficiary, chequeNumber: cheque.number, amount: Number(cheque.amount), issueDate: cheque.date, expectedVersion: prorogation.version, idempotencyKey: createCollectionIdempotencyKey('funding-cheque') }), onSuccess: async () => { toast.success('Chèque préparé pour validation indépendante.'); await onChanged(); }, onError: (e) => toast.error(messageOf(e)) }); return <div className="space-y-4 rounded-md border p-4"><div className="flex flex-wrap items-center gap-2"><strong>{prorogation.client_reference}</strong>{statusBadge(prorogation.status)}<Badge variant="outline">Version {prorogation.version}</Badge><span>{money.format(prorogation.target_nominal)}</span></div><div className="grid gap-4 lg:grid-cols-3"><ActionBox title="1. Créance ancienne"><Select value={source.type} onValueChange={(type) => setSource({ ...source, type })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="RECEIVABLE">Créance</SelectItem><SelectItem value="INVOICE">Facture</SelectItem><SelectItem value="EFFECT">Effet échu</SelectItem></SelectContent></Select><Input placeholder="Référence" value={source.reference} onChange={(e) => setSource({ ...source, reference: e.target.value })} /><Input type="number" placeholder="Montant" value={source.amount} onChange={(e) => setSource({ ...source, amount: e.target.value })} /><Button disabled={!canEntry || sourceMutation.isPending} onClick={() => sourceMutation.mutate()}>Rattacher</Button></ActionBox><ActionBox title="2. Nouvel effet"><Select value={effectId} onValueChange={setEffectId}><SelectTrigger><SelectValue placeholder="Effet de remplacement" /></SelectTrigger><SelectContent>{instruments.map((i) => <SelectItem key={i.id} value={i.id}>{i.effect_reference ?? i.id.slice(0, 8)} · {money.format(i.nominal_amount)}</SelectItem>)}</SelectContent></Select><Input type="number" placeholder="Nominal affecté" value={effectAmount} onChange={(e) => setEffectAmount(e.target.value)} /><Button disabled={!canEntry || effectMutation.isPending || !effectId} onClick={() => effectMutation.mutate()}>Rattacher</Button></ActionBox><ActionBox title="3. Chèque SODATRA"><Select value={cheque.accountId} onValueChange={(accountId) => setCheque({ ...cheque, accountId })}><SelectTrigger><SelectValue placeholder="Banque SODATRA" /></SelectTrigger><SelectContent>{accounts.map((a) => <SelectItem key={a.id} value={a.id}>{a.bank} · {a.safe_alias}</SelectItem>)}</SelectContent></Select><Input placeholder="Bénéficiaire" value={cheque.beneficiary} onChange={(e) => setCheque({ ...cheque, beneficiary: e.target.value })} /><Input placeholder="N° chèque" value={cheque.number} onChange={(e) => setCheque({ ...cheque, number: e.target.value })} /><Input type="number" placeholder="Montant" value={cheque.amount} onChange={(e) => setCheque({ ...cheque, amount: e.target.value })} /><Input type="date" value={cheque.date} onChange={(e) => setCheque({ ...cheque, date: e.target.value })} /><Button disabled={!canIssue || chequeMutation.isPending} onClick={() => chequeMutation.mutate()}>Préparer</Button></ActionBox></div></div>; };

const ChequeActions = ({ rows, currentUserId, canApprove, canDeliver, reason, setReason, evidence, setEvidence, deliveryDate, setDeliveryDate, onChanged }: { rows: Array<{ id: string; cheque_number: string; amount: number; status: string; version: number; created_by: string }>; currentUserId: string; canApprove: boolean; canDeliver: boolean; reason: string; setReason: (v: string) => void; evidence: string; setEvidence: (v: string) => void; deliveryDate: string; setDeliveryDate: (v: string) => void; onChanged: () => Promise<unknown> }) => { const approve = useMutation({ mutationFn: (row: typeof rows[number]) => approveCollectionFundingCheque({ outboundChequeId: row.id, expectedVersion: row.version, reason, idempotencyKey: createCollectionIdempotencyKey('approve-cheque') }), onSuccess: async () => { toast.success('Chèque approuvé par le second acteur.'); await onChanged(); }, onError: (e) => toast.error(messageOf(e)) }); const deliver = useMutation({ mutationFn: (row: typeof rows[number]) => confirmCollectionFundingDelivery({ outboundChequeId: row.id, deliveryDate, evidenceReference: evidence, expectedVersion: row.version, idempotencyKey: createCollectionIdempotencyKey('deliver-cheque') }), onSuccess: async () => { toast.success('Remise du chèque confirmée.'); await onChanged(); }, onError: (e) => toast.error(messageOf(e)) }); return <Card><CardHeader><CardTitle>Validation et remise des chèques</CardTitle><CardDescription>Le préparateur ne peut pas approuver ni confirmer son propre chèque.</CardDescription></CardHeader><CardContent className="space-y-3"><div className="grid gap-2 md:grid-cols-3"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif de validation" /><Input value={evidence} onChange={(e) => setEvidence(e.target.value)} placeholder="Référence preuve de remise" /><Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>{rows.map((row) => <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><div><strong>{row.cheque_number}</strong> · {money.format(row.amount)} · {statusBadge(row.status)}</div><div className="flex gap-2">{row.status === 'DRAFT' && <Button size="sm" disabled={!canApprove || row.created_by === currentUserId || reason.trim().length < 8} onClick={() => approve.mutate(row)}>Approuver</Button>}{row.status === 'ISSUED' && <Button size="sm" disabled={!canDeliver || row.created_by === currentUserId || !evidence || !deliveryDate} onClick={() => deliver.mutate(row)}>Confirmer remise</Button>}</div></div>)}</CardContent></Card>; };

const MatchProposalForm = ({ disabled, receipts, instruments, dailyLines, onCreated }: { disabled: boolean; receipts: CollectionReceiptRow[]; instruments: CollectionInstrumentRow[]; dailyLines: Array<{ id: string; direction: string; currency: string; signed_amount: number; accounting_date: string; description_sanitized: string }>; onCreated: () => Promise<unknown> }) => { const [receiptId, setReceiptId] = useState(''); const [lineId, setLineId] = useState(''); const [amount, setAmount] = useState(''); const receipt = receipts.find((r) => r.id === receiptId); const candidates = useMemo(() => dailyLines.filter((line) => !receipt || (line.currency === receipt.currency && line.direction === 'credit')), [dailyLines, receipt]); const eventType = receipt?.method === 'TRANSFER' ? 'BANK_TRANSFER_CREDIT_CONFIRMED' : receipt?.method === 'CASH' ? 'BANK_CASH_DEPOSIT_CREDIT_CONFIRMED' : 'BANK_COLLECTION_CREDIT_CONFIRMED'; const mutation = useMutation({ mutationFn: () => proposeCollectionMatch({ aggregateType: 'RECEIPT', aggregateId: receiptId, dailyLineId: lineId, eventType, amount: Number(amount), score: 100, reasonCodes: ['MANUAL_REVIEW','ACCOUNT','CURRENCY'], idempotencyKey: createCollectionIdempotencyKey('match-proposal') }), onSuccess: async () => { toast.success('Rapprochement proposé ; confirmation par un second acteur requise.'); await onCreated(); }, onError: (e) => toast.error(messageOf(e)) }); return <Card><CardHeader><CardTitle>Proposer un rapprochement</CardTitle><CardDescription>La proposition n’est jamais une confirmation automatique.</CardDescription></CardHeader><CardContent><div className="grid gap-3 md:grid-cols-4"><Select value={receiptId} onValueChange={setReceiptId}><SelectTrigger><SelectValue placeholder="Remise attendue" /></SelectTrigger><SelectContent>{receipts.filter((r) => r.settlement_state !== 'CONFIRMED').map((r) => <SelectItem key={r.id} value={r.id}>{collectionReceiptIdentity(r, instruments)} · {money.format(r.amount)}</SelectItem>)}</SelectContent></Select><Select value={lineId} onValueChange={(id) => { setLineId(id); const line = candidates.find((item) => item.id === id); if (line) setAmount(String(Math.abs(line.signed_amount))); }}><SelectTrigger><SelectValue placeholder="Ligne Daily v2" /></SelectTrigger><SelectContent>{candidates.map((line) => <SelectItem key={line.id} value={line.id}>{line.accounting_date} · {money.format(Math.abs(line.signed_amount))} · {line.description_sanitized.slice(0, 35)}</SelectItem>)}</SelectContent></Select><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Montant affecté" /><Button disabled={disabled || mutation.isPending || !receiptId || !lineId || !amount} onClick={() => mutation.mutate()}><Link2 className="mr-2 h-4 w-4" />Proposer</Button></div>{dailyLines.length === 0 && !disabled && <p className="mt-3 text-sm text-amber-700">Aucune ligne Daily v2 visible pour ce rôle. Un admin ou auditeur disposant de PROPOSE_MATCH doit préparer la proposition.</p>}</CardContent></Card>; };

const ProposalTable = ({ rows, receipts, instruments, currentUserId, canConfirm, reason, setReason, onChanged }: { rows: CollectionMatchProposalRow[]; receipts: CollectionReceiptRow[]; instruments: CollectionInstrumentRow[]; currentUserId: string; canConfirm: boolean; reason: string; setReason: (v: string) => void; onChanged: () => Promise<unknown> }) => { const mutation = useMutation({ mutationFn: (id: string) => confirmCollectionMatch({ proposalId: id, reason, idempotencyKey: createCollectionIdempotencyKey('confirm-match') }), onSuccess: async () => { toast.success('Rapprochement confirmé et audité.'); await onChanged(); }, onError: (e) => toast.error(messageOf(e)) }); return <Card><CardHeader><CardTitle>File de confirmation</CardTitle><CardDescription>Deux acteurs différents sont imposés côté serveur.</CardDescription></CardHeader><CardContent className="space-y-3"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Motif de confirmation (8 caractères minimum)" />{rows.map((row) => { const receipt = receipts.find((candidate) => candidate.id === row.aggregate_id); const identity = row.aggregate_type === 'RECEIPT' ? (receipt ? collectionReceiptIdentity(receipt, instruments) : missingCollectionReceiptIdentity(row.aggregate_id)) : `${row.aggregate_type} · ID ${row.aggregate_id.slice(0, 8)}`; return <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded border p-3"><div><div className="font-medium">{identity}</div><div className="text-sm text-muted-foreground">Montant proposé {money.format(row.proposed_amount)} · score {row.score} · {statusBadge(row.status)}</div></div>{row.status === 'PROPOSED' && <Button size="sm" disabled={!canConfirm || row.proposed_by === currentUserId || reason.trim().length < 8 || mutation.isPending} onClick={() => mutation.mutate(row.id)}><CheckCircle2 className="mr-2 h-4 w-4" />Confirmer</Button>}</div>; })}{rows.length === 0 && <p className="text-sm text-muted-foreground">Aucune proposition.</p>}</CardContent></Card>; };

const EvidenceAlerts = ({ rows }: { rows: Array<{ allocation_id: string; control_state: string; allocated_amount: number; currency: string; daily_line_id: string }> }) => <Card><CardHeader><CardTitle>Preuves Daily v2 à reprendre</CardTitle></CardHeader><CardContent>{rows.length === 0 ? <p className="text-sm text-muted-foreground">Toutes les preuves confirmées sont courantes.</p> : rows.map((row) => <Alert key={row.allocation_id} className="mb-2 border-amber-300"><AlertTriangle className="h-4 w-4" /><AlertDescription>{row.control_state} · {money.format(row.allocated_amount)} · ligne {row.daily_line_id.slice(0, 8)}…</AlertDescription></Alert>)}</CardContent></Card>;

const Field = ({ label, children }: { label: string; children: ReactNode }) => <div className="space-y-2"><Label>{label}</Label>{children}</div>;
const ActionBox = ({ title, children }: { title: string; children: ReactNode }) => <div className="space-y-2 rounded border p-3"><h3 className="font-medium">{title}</h3>{children}</div>;

export default CollectionsRemittances;
