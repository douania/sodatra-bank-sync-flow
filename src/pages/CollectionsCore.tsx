import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Landmark, Link2, ListChecks, PlusCircle, ShieldCheck } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  createCollectionEntry,
  decideCollectionMatch,
  exportCollectionRegister,
  getCollectionCapabilities,
  inspectCollectionsCorePilotAdministration,
  listCollectionMatchCandidates,
  listCollectionAccounts,
  listPendingMatchProposals,
  listRemittanceWorkItems,
  proposeCollectionMatch,
  prepareCollectionsCoreStagingPilot,
  closeCollectionsCoreStagingPilot,
  validateCollectionRemittance,
} from '@/features/collections-core/collectionsCoreService';
import { useCollectionsCorePilotGate } from '@/features/collections-core/CollectionsCorePilotGate';
import type { CollectionsCorePilotDataset } from '@/features/collections-core/collectionsCorePilotAccess';
import type {
  CollectionCapability,
  CollectionEntryInput,
  EvidenceBasis,
  ReceiptMethod,
} from '@/features/collections-core/collectionsCoreTypes';

const money = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fieldClass = 'mt-1';
const entryWorkflowStorageKey = 'collections-core:entry-workflow-key';

function newEntryWorkflowKey(): string {
  return `entry:${crypto.randomUUID()}`;
}

function readEntryWorkflowKey(): string {
  const generated = newEntryWorkflowKey();
  try {
    const stored = window.sessionStorage.getItem(entryWorkflowStorageKey);
    if (stored?.startsWith('entry:')) return stored;
    window.sessionStorage.setItem(entryWorkflowStorageKey, generated);
  } catch {
    // The server-side transaction still guarantees atomicity if browser storage is unavailable.
  }
  return generated;
}

function rotateEntryWorkflowKey(): string {
  const generated = newEntryWorkflowKey();
  try {
    window.sessionStorage.setItem(entryWorkflowStorageKey, generated);
  } catch {
    // Keep the fresh in-memory key when browser storage is unavailable.
  }
  return generated;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Opération refusée.';
}

function Empty({ children }: { children: string }) {
  return <p className="py-8 text-center text-sm text-muted-foreground">{children}</p>;
}

function EntryPanel({ allowed, pilotDataset }: { allowed: boolean; pilotDataset?: CollectionsCorePilotDataset }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['collections-core', 'accounts'], queryFn: listCollectionAccounts, enabled: allowed });
  const [form, setForm] = useState<CollectionEntryInput>(pilotDataset?.entry ?? {
    clientName: '', method: 'CHECK', amount: 0, currency: 'XOF', clientBank: '',
    depositAccountId: '', depositDate: '', declaredCreditDate: '', instrumentReference: '',
    maturityDate: '', invoiceReference: '', slipReference: '', businessNature: 'STANDARD', note: '',
  });
  const [workflowKey, setWorkflowKey] = useState(
    pilotDataset?.entryCommandKey ?? readEntryWorkflowKey,
  );
  const submit = useMutation({
    mutationFn: createCollectionEntry,
    onSuccess: async () => {
      toast.success('Remise enregistrée en brouillon.');
      if (!pilotDataset) setWorkflowKey(rotateEntryWorkflowKey());
      if (!pilotDataset) setForm((current) => ({ ...current, clientName: '', amount: 0, clientBank: '', instrumentReference: '', maturityDate: '', invoiceReference: '', slipReference: '', note: '' }));
      await queryClient.invalidateQueries({ queryKey: ['collections-core'] });
    },
    onError: (error) => toast.error(`${errorMessage(error)} Aucun brouillon incomplet n’a été conservé.`),
  });
  const set = <K extends keyof CollectionEntryInput>(key: K, value: CollectionEntryInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const chosenAccount = accounts.data?.find((account) => account.id === form.depositAccountId);

  if (!allowed) return <Empty>Votre compte ne peut pas saisir de remise.</Empty>;
  if (accounts.isError) return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(accounts.error)}</AlertDescription></Alert>;
  if (pilotDataset && accounts.isPending) return <Empty>Vérification du compte de dépôt synthétique…</Empty>;
  if (
    pilotDataset &&
    (!chosenAccount || chosenAccount.currency !== pilotDataset.entry.currency)
  ) {
    return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>Le compte de dépôt synthétique est absent, inactif ou dans une autre devise. Le pilote est arrêté avant saisie.</AlertDescription></Alert>;
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlusCircle className="h-5 w-5" />Nouvelle remise</CardTitle>
        <CardDescription>Cette saisie remplace le nouveau remplissage manuel du fichier Collection Report.</CardDescription>
      </CardHeader>
      <CardContent>
        {pilotDataset && <Alert className="mb-4 md:col-span-3"><ShieldCheck className="h-4 w-4"/><AlertDescription>Jeu synthétique scellé : les champs sont en lecture seule.</AlertDescription></Alert>}
        <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); submit.mutate({ input: form, workflowKey }); }}>
          <div><Label htmlFor="deposit-date">Date de remise</Label><Input id="deposit-date" disabled={Boolean(pilotDataset)} className={fieldClass} type="date" required value={form.depositDate} onChange={(e) => set('depositDate', e.target.value)} /></div>
          <div><Label htmlFor="method">Mode</Label><select id="method" disabled={Boolean(pilotDataset)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.method} onChange={(e) => set('method', e.target.value as ReceiptMethod)}><option value="CHECK">Chèque</option><option value="EFFECT">Effet</option><option value="TRANSFER">Virement</option><option value="CASH">Espèces</option></select></div>
          <div><Label htmlFor="amount">Montant</Label><Input id="amount" disabled={Boolean(pilotDataset)} className={fieldClass} type="number" min="0.01" step="0.01" required value={form.amount || ''} onChange={(e) => set('amount', Number(e.target.value))} /></div>
          <div><Label htmlFor="client">Client SODATRA</Label><Input id="client" disabled={Boolean(pilotDataset)} className={fieldClass} required value={form.clientName} onChange={(e) => set('clientName', e.target.value)} /></div>
          <div><Label htmlFor="client-bank">Banque du client</Label><Input id="client-bank" disabled={Boolean(pilotDataset)} className={fieldClass} value={form.clientBank} onChange={(e) => set('clientBank', e.target.value)} /></div>
          <div><Label htmlFor="deposit-account">Banque de dépôt SODATRA</Label><select id="deposit-account" disabled={Boolean(pilotDataset)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required value={form.depositAccountId} onChange={(e) => { const id=e.target.value; const account=accounts.data?.find((entry)=>entry.id===id); setForm((current)=>({...current,depositAccountId:id,currency:account?.currency ?? current.currency})); }}><option value="">Choisir…</option>{accounts.data?.map((account)=><option key={account.id} value={account.id}>{account.bank} — {account.safeAlias} ({account.currency})</option>)}</select></div>
          {(form.method === 'CHECK' || form.method === 'EFFECT') && <div><Label htmlFor="instrument">{form.method === 'CHECK' ? 'N° du chèque' : 'Référence effet (facultative)'}</Label><Input id="instrument" disabled={Boolean(pilotDataset)} className={fieldClass} required={form.method === 'CHECK'} value={form.instrumentReference} onChange={(e) => set('instrumentReference', e.target.value)} /></div>}
          {form.method === 'EFFECT' && <div><Label htmlFor="maturity">Échéance de l’effet</Label><Input id="maturity" disabled={Boolean(pilotDataset)} className={fieldClass} type="date" required value={form.maturityDate} onChange={(e) => set('maturityDate', e.target.value)} /></div>}
          <div><Label htmlFor="invoice">Facture n° (facultatif)</Label><Input id="invoice" disabled={Boolean(pilotDataset)} className={fieldClass} value={form.invoiceReference} onChange={(e) => set('invoiceReference', e.target.value)} /></div>
          <div><Label htmlFor="slip">Bordereau / référence</Label><Input id="slip" disabled={Boolean(pilotDataset)} className={fieldClass} value={form.slipReference} onChange={(e) => set('slipReference', e.target.value)} /></div>
          <div><Label htmlFor="declared-date">Date de crédit déclarée</Label><Input id="declared-date" disabled={Boolean(pilotDataset)} className={fieldClass} type="date" value={form.declaredCreditDate} onChange={(e) => set('declaredCreditDate', e.target.value)} /></div>
          <div><Label htmlFor="nature">Nature</Label><select id="nature" disabled={Boolean(pilotDataset)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.businessNature} onChange={(e) => set('businessNature', e.target.value as 'STANDARD'|'PROROGATION')}><option value="STANDARD">Standard</option><option value="PROROGATION">Prorogation</option></select></div>
          <div className="md:col-span-3"><Label htmlFor="note">Note</Label><Textarea id="note" disabled={Boolean(pilotDataset)} className={fieldClass} value={form.note} onChange={(e) => set('note', e.target.value)} /></div>
          <div className="md:col-span-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">Devise : {chosenAccount?.currency ?? form.currency}. Une autre personne devra valider.</span><Button disabled={submit.isPending || accounts.isPending} type="submit">{submit.isPending ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ValidationPanel({ allowed, pilotDataset }: { allowed: boolean; pilotDataset?: CollectionsCorePilotDataset }) {
  const queryClient = useQueryClient();
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const drafts = useQuery({ queryKey: ['collections-core', 'drafts'], queryFn: () => listRemittanceWorkItems(['DRAFT']), enabled: allowed });
  const mutation = useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => validateCollectionRemittance(id, reason),
    onSuccess: async () => { toast.success('Remise validée et soumise au rapprochement.'); await queryClient.invalidateQueries({ queryKey: ['collections-core'] }); },
    onError: (error) => toast.error(errorMessage(error)),
  });
  if (!allowed) return <Empty>Votre compte ne peut pas valider de remise.</Empty>;
  if (drafts.isPending) return <Empty>Chargement des brouillons…</Empty>;
  if (drafts.isError) return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(drafts.error)}</AlertDescription></Alert>;
  if (!drafts.data?.length) return <Empty>Aucune remise à valider.</Empty>;
  return <div className="space-y-3">{drafts.data.map((item)=>{const reason=pilotDataset?.validationReason ?? reasons[item.remittanceId] ?? '';return <Card key={item.itemId}><CardContent className="grid gap-3 pt-5 md:grid-cols-[1fr_1fr_auto] md:items-end"><div><p className="font-medium">{item.clientName} — {money.format(item.amount)} {item.currency}</p><p className="text-sm text-muted-foreground">{item.depositDate} · {item.method} {item.instrumentReference ?? ''} · saisie {item.remittanceCreatedBy.slice(0,8)}</p></div><div><Label htmlFor={`reason-${item.itemId}`}>Motif de validation</Label><Input id={`reason-${item.itemId}`} className={fieldClass} readOnly={Boolean(pilotDataset)} value={reason} onChange={(e)=>setReasons((current)=>({...current,[item.remittanceId]:e.target.value}))} /></div><Button disabled={mutation.isPending || !reason.trim()} onClick={()=>mutation.mutate({id:item.remittanceId,reason})}>Valider</Button></CardContent></Card>})}</div>;
}

function PilotAdministrationPanel() {
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: ['collections-core', 'pilot-administration'], queryFn: inspectCollectionsCorePilotAdministration });
  const prepare = useMutation({ mutationFn: prepareCollectionsCoreStagingPilot, onSuccess: async()=>{toast.success('Pilote préparé.');await queryClient.invalidateQueries({queryKey:['collections-core']});}, onError:(error)=>toast.error(errorMessage(error)) });
  const close = useMutation({ mutationFn: closeCollectionsCoreStagingPilot, onSuccess: async()=>{toast.success('Pilote fermé et habilitations temporaires révoquées.');await queryClient.invalidateQueries({queryKey:['collections-core']});}, onError:(error)=>toast.error(errorMessage(error)) });
  return <Card><CardHeader><CardTitle>Administration bornée du pilote</CardTitle><CardDescription>G ne peut effectuer aucune action métier. La fermeture contrôle A/B avant de révoquer MANAGE_ACCESS en dernier.</CardDescription></CardHeader><CardContent className="space-y-4"><div className="grid gap-2 text-sm md:grid-cols-3"><p>A : {(state.data?.operatorActiveCapabilities ?? []).join(', ') || 'aucune'}</p><p>B : {(state.data?.controllerActiveCapabilities ?? []).join(', ') || 'aucune'}</p><p>G MANAGE_ACCESS : {state.data?.grantorManageAccessActive ? 'temporaire actif' : 'inactif'}</p></div>{state.isError&&<Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(state.error)}</AlertDescription></Alert>}<div className="flex gap-3"><Button disabled={prepare.isPending||close.isPending} onClick={()=>prepare.mutate()}>Préparer le pilote</Button><Button variant="destructive" disabled={prepare.isPending||close.isPending} onClick={()=>close.mutate()}>Fermer le pilote</Button></div></CardContent></Card>;
}

function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function MatchingPanel({ canPropose, canConfirm, pilotDataset }: { canPropose: boolean; canConfirm: boolean; pilotDataset?: CollectionsCorePilotDataset }) {
  const queryClient = useQueryClient();
  const phaseB=pilotDataset?.phaseB;
  const [itemId,setItemId]=useState(phaseB?.remittanceItemId??''); const [lineId,setLineId]=useState(''); const [basis,setBasis]=useState<EvidenceBasis>(phaseB?.evidenceBasis??'EXACT_CREDIT');
  const [dateFrom,setDateFrom]=useState(phaseB?.dateFrom??''); const [dateTo,setDateTo]=useState(phaseB?.dateTo??'');
  const [credit,setCredit]=useState(phaseB?.creditAmount??0); const [gross,setGross]=useState(phaseB?.settledGrossAmount??0); const [reason,setReason]=useState(phaseB?.proposalReason??''); const [decisionReasons,setDecisionReasons]=useState<Record<string,string>>({});
  const items = useQuery({ queryKey: ['collections-core', 'matchable-items'], queryFn: () => listRemittanceWorkItems(['SUBMITTED','PARTIALLY_CREDITED'],'phase_b_propose'), enabled: canPropose });
  const lines = useQuery({ queryKey: ['collections-core', 'match-candidates',itemId,dateFrom,dateTo], queryFn: () => listCollectionMatchCandidates({itemId,dateFrom,dateTo}), enabled: canPropose&&Boolean(itemId&&dateFrom&&dateTo) });
  const proposals = useQuery({ queryKey: ['collections-core', 'pending-proposals'], queryFn: listPendingMatchProposals, enabled: canConfirm });
  const selectedItem=items.data?.find((item)=>item.itemId===itemId);
  const selectedLine=lines.data?.find((line)=>line.id===lineId);
  const propose=useMutation({mutationFn:proposeCollectionMatch,onSuccess:async()=>{toast.success('Rapprochement proposé pour contrôle.');if(!phaseB){setItemId('');setLineId('');setCredit(0);setGross(0);setReason('');}await queryClient.invalidateQueries({queryKey:['collections-core']});},onError:(error)=>toast.error(errorMessage(error))});
  const decide=useMutation({mutationFn:({id,decision,why}:{id:string;decision:'CONFIRM'|'REJECT';why:string})=>decideCollectionMatch(id,decision,why),onSuccess:async()=>{toast.success('Décision enregistrée.');await queryClient.invalidateQueries({queryKey:['collections-core']});},onError:(error)=>toast.error(errorMessage(error))});
  const readError = items.error ?? lines.error ?? proposals.error;
  if (readError) return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(readError)}</AlertDescription></Alert>;
  return <div className="space-y-6">
    {canPropose ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />Proposer un rapprochement</CardTitle><CardDescription>Choisissez d’abord la remise. Le serveur recherche uniquement les crédits de son compte de dépôt exact et de sa devise. Les débits de frais séparés restent dans Daily v2.</CardDescription></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-2" onSubmit={(e)=>{e.preventDefault();if(selectedLine)propose.mutate({itemId,creditLine:selectedLine,creditConsumedAmount:credit,settledGrossAmount:gross,evidenceBasis:basis,reason});}}><div><Label htmlFor="match-item">Remise</Label><select id="match-item" disabled={Boolean(phaseB)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required value={itemId} onChange={(e)=>{const id=e.target.value;const item=items.data?.find((entry)=>entry.itemId===id);setItemId(id);setLineId('');setGross(item?.amount??0);setCredit(item?.amount??0);setDateFrom(item?.depositDate??'');setDateTo(item?addDays(item.depositDate,30):'');}}><option value="">Choisir…</option>{items.data?.map((item)=><option key={item.itemId} value={item.itemId}>{item.depositDate} · {item.clientName} · {money.format(item.amount)} {item.currency}</option>)}</select></div><div><Label>Compte de dépôt imposé</Label><Input className={fieldClass} readOnly value={selectedItem?.depositAccountId??phaseB?.accountRegistryId??''}/></div><div><Label htmlFor="date-from">Du</Label><Input id="date-from" disabled={Boolean(phaseB)} className={fieldClass} type="date" value={dateFrom} onChange={(e)=>{setDateFrom(e.target.value);setLineId('');}}/></div><div><Label htmlFor="date-to">Au</Label><Input id="date-to" disabled={Boolean(phaseB)} className={fieldClass} type="date" value={dateTo} onChange={(e)=>{setDateTo(e.target.value);setLineId('');}}/></div><div className="md:col-span-2"><Label htmlFor="credit-line">Crédit bancaire borné</Label><select id="credit-line" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required value={lineId} onChange={(e)=>{const id=e.target.value;const line=lines.data?.find((entry)=>entry.id===id);setLineId(id);setCredit(line?.amount??0);}}><option value="">Choisir…</option>{lines.data?.map((line)=><option key={line.id} value={line.id}>{line.accountingDate} · {money.format(line.amount)} {line.currency} · {line.description.slice(0,70)}</option>)}</select>{itemId&&lines.isPending&&<p className="mt-2 text-xs text-muted-foreground">Recherche bornée en cours…</p>}{itemId&&!lines.isPending&&!lines.data?.length&&<p className="mt-2 text-xs text-muted-foreground">Aucun candidat sur ce compte et cette période.</p>}</div>{selectedLine&&<Alert className="md:col-span-2"><ShieldCheck className="h-4 w-4"/><AlertDescription><strong>{selectedLine.referenceSignal}</strong> · {selectedLine.reasonCodes.join(' · ')}<br/>{selectedLine.accountingDate} · disponible {money.format(selectedLine.unallocatedAmount)} {selectedLine.currency} · {selectedLine.description}</AlertDescription></Alert>}<div><Label htmlFor="basis">Type de preuve</Label><select id="basis" disabled={Boolean(phaseB)} className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={basis} onChange={(e)=>setBasis(e.target.value as EvidenceBasis)}><option value="EXACT_CREDIT">Crédit au nominal</option><option value="NET_OF_DISCOUNT">Crédit net après retenue bancaire</option></select></div><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="gross">Nominal réglé</Label><Input id="gross" readOnly={Boolean(phaseB)} className={fieldClass} type="number" min="0.01" step="0.01" value={gross||''} onChange={(e)=>setGross(Number(e.target.value))}/></div><div><Label htmlFor="credit">Crédit observé</Label><Input id="credit" readOnly={Boolean(phaseB)} className={fieldClass} type="number" min="0.01" step="0.01" value={credit||''} onChange={(e)=>setCredit(Number(e.target.value))}/></div></div><div className="md:col-span-2"><Label htmlFor="match-reason">Justification</Label><Textarea id="match-reason" readOnly={Boolean(phaseB)} className={fieldClass} required value={reason} onChange={(e)=>setReason(e.target.value)} /></div><div className="md:col-span-2 flex justify-end"><Button disabled={propose.isPending||!selectedLine} type="submit">Proposer pour contrôle humain</Button></div></form></CardContent></Card> : <Empty>Votre compte ne peut pas proposer de rapprochement.</Empty>}
    {canConfirm && <Card><CardHeader><CardTitle>Rapprochements à confirmer</CardTitle><CardDescription>Aucune confirmation n’est automatique. Une autre personne relit le compte, le montant, la date et les signaux.</CardDescription></CardHeader><CardContent>{proposals.isPending?<Empty>Chargement…</Empty>:!proposals.data?.length?<Empty>Aucun rapprochement en attente.</Empty>:<div className="space-y-3">{proposals.data.map((proposal)=>{const why=phaseB?.confirmationReason??decisionReasons[proposal.id]??'';return <div key={proposal.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"><div><p className="font-medium">{proposal.clientName} · {money.format(proposal.nominalAmount)} nominal / {money.format(proposal.creditAmount)} crédit</p><p className="text-xs text-muted-foreground">{proposal.accountAlias} · {proposal.accountingDate} · {proposal.referenceSignal} · {proposal.reasonCodes.join(' · ')}</p><p className="text-xs text-muted-foreground">{proposal.description} · proposé par {proposal.proposedBy.slice(0,8)} · {proposal.reason}</p>{!proposal.evidenceAvailable&&<Badge variant="destructive">Preuve devenue indisponible</Badge>}</div><div><Label htmlFor={`decision-${proposal.id}`}>Motif de décision</Label><Input id={`decision-${proposal.id}`} readOnly={Boolean(phaseB)} className={fieldClass} value={why} onChange={(e)=>setDecisionReasons((current)=>({...current,[proposal.id]:e.target.value}))}/></div><Button variant="outline" disabled={!why.trim()||decide.isPending} onClick={()=>decide.mutate({id:proposal.id,decision:'REJECT',why})}>Rejeter</Button><Button disabled={!why.trim()||decide.isPending||!proposal.evidenceAvailable} onClick={()=>decide.mutate({id:proposal.id,decision:'CONFIRM',why})}>Confirmer</Button></div>})}</div>}</CardContent></Card>}
  </div>;
}

function RegisterPanel({ allowed }: { allowed: boolean }) {
  const rows=useQuery({queryKey:['collections-core','register'],queryFn:exportCollectionRegister,enabled:allowed});
  if(!allowed)return <Empty>Votre compte ne peut pas consulter le registre contrôlé.</Empty>;
  if(rows.isPending)return <Empty>Chargement du registre…</Empty>;
  if(rows.isError)return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(rows.error)}</AlertDescription></Alert>;
  if(!rows.data?.length)return <Empty>Le registre est vide.</Empty>;
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5"/>Registre Collections</CardTitle><CardDescription>Equivalent amélioré du Collection Report : l’attendu, la preuve bancaire et le reste sont conservés séparément.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><Table><TableHeader><TableRow><TableHead>Remise</TableHead><TableHead>Client</TableHead><TableHead>Attendu</TableHead><TableHead>Nominal réglé</TableHead><TableHead>Retenue bancaire observée</TableHead><TableHead>Liquidité nette</TableHead><TableHead>Preuve</TableHead><TableHead>Reste</TableHead><TableHead>État</TableHead></TableRow></TableHeader><TableBody>{rows.data.map((row)=><TableRow key={row.remittanceItemId}><TableCell className="whitespace-nowrap">{row.depositDate}<br/><span className="text-xs text-muted-foreground">{row.receiptMethod} {row.instrumentReference??''}</span></TableCell><TableCell>{row.clientName}</TableCell><TableCell>{money.format(row.expectedAmount)} {row.currency}</TableCell><TableCell>{money.format(row.settledGrossAmount)}</TableCell><TableCell>{money.format(row.observedFeeAmount)}</TableCell><TableCell>{money.format(row.netLiquidityAmount)}</TableCell><TableCell><Badge variant={row.proofClass==='UNPROVEN'?'outline':'default'}>{row.proofClass}</Badge><br/><span className="text-xs text-muted-foreground">déclarée {row.declaredCreditDate??'—'} / prouvée {row.provenCreditDate??'—'}</span></TableCell><TableCell>{money.format(row.remainingAmount)}</TableCell><TableCell>{row.itemStatus}{row.currentExceptionCode&&<Badge className="ml-2" variant="destructive">{row.currentExceptionCode}</Badge>}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>;
}

export default function CollectionsCore() {
  const { gate, actor } = useCollectionsCorePilotGate();
  const capabilities=useQuery({queryKey:['collections-core','capabilities'],queryFn:getCollectionCapabilities,staleTime:60_000});
  if(capabilities.isPending)return <Empty>Vérification des habilitations Collections…</Empty>;
  if(capabilities.isError)return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(capabilities.error)}</AlertDescription></Alert>;
  const has=(capability:CollectionCapability)=>capabilities.data?.[capability]===true;
  if(gate.status==='allowed'&&gate.environment==='staging'){
    const dataset=gate.pilotManifest.dataset;
    return <div className="space-y-6"><Alert><ShieldCheck className="h-4 w-4"/><AlertDescription><strong>PILOTE STAGING — données synthétiques uniquement — aucun paiement ni écriture comptable.</strong></AlertDescription></Alert><div><Badge>STAGING — PILOTE 0Z1B</Badge><h1 className="mt-3 flex items-center gap-2 text-3xl font-bold"><Landmark className="h-7 w-7"/>Collections et remises</h1><p className="mt-2 text-muted-foreground">Campagne {gate.pilotManifest.campaignId} · acteur {actor}</p></div><Alert><ShieldCheck className="h-4 w-4"/><AlertDescription>{dataset.phaseB?'Phase B bornée : une remise et une ligne Daily v2 synthétiques, scellées par UUID et empreintes.':'Phase A uniquement. Le rapprochement Daily v2 reste NOT_RUN et toute lecture ou mutation de phase B est bloquée avant réseau.'}</AlertDescription></Alert>{actor==='G'&&<PilotAdministrationPanel/>}{actor==='A'&&(dataset.phaseB?<MatchingPanel canPropose={has('PROPOSE_MATCH')} canConfirm={false} pilotDataset={dataset}/>:<EntryPanel allowed={has('ENTRY')} pilotDataset={dataset}/>)} {actor==='B'&&(dataset.phaseB?<div className="space-y-6"><MatchingPanel canPropose={false} canConfirm={has('CONFIRM_MATCH')} pilotDataset={dataset}/><RegisterPanel allowed={has('AUDIT')}/></div>:<div className="space-y-6"><ValidationPanel allowed={has('VALIDATE_REMITTANCE')} pilotDataset={dataset}/><RegisterPanel allowed={has('AUDIT')}/></div>)}</div>;
  }
  if(!Object.values(capabilities.data??{}).some(Boolean))return <Alert><AlertCircle className="h-4 w-4"/><AlertDescription>Aucune habilitation Collections ne vous est attribuée.</AlertDescription></Alert>;
  return <div className="space-y-6"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><Landmark className="h-7 w-7"/>Collections et remises</h1><p className="mt-2 text-muted-foreground">Préparer, contrôler et justifier les encaissements — sans exécuter de paiement ni passer d’écriture comptable.</p></div><Alert><CheckCircle2 className="h-4 w-4"/><AlertDescription>La banque de dépôt est une contrainte de rapprochement : un crédit dans une autre banque ne peut pas confirmer la remise.</AlertDescription></Alert><Tabs defaultValue={has('ENTRY')?'entry':has('VALIDATE_REMITTANCE')?'validation':has('PROPOSE_MATCH')||has('CONFIRM_MATCH')?'matching':'register'}><TabsList className="grid w-full grid-cols-4"><TabsTrigger value="entry">Saisir</TabsTrigger><TabsTrigger value="validation">Valider</TabsTrigger><TabsTrigger value="matching">Rapprocher</TabsTrigger><TabsTrigger value="register">Registre</TabsTrigger></TabsList><TabsContent value="entry" className="mt-4"><EntryPanel allowed={has('ENTRY')}/></TabsContent><TabsContent value="validation" className="mt-4"><ValidationPanel allowed={has('VALIDATE_REMITTANCE')}/></TabsContent><TabsContent value="matching" className="mt-4"><MatchingPanel canPropose={has('PROPOSE_MATCH')} canConfirm={has('CONFIRM_MATCH')}/></TabsContent><TabsContent value="register" className="mt-4"><RegisterPanel allowed={has('AUDIT')}/></TabsContent></Tabs></div>;
}
