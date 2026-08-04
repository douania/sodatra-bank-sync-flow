import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertCircle, CheckCircle2, Landmark, Link2, ListChecks, PlusCircle } from 'lucide-react';
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
  listActiveCreditLines,
  listCollectionAccounts,
  listPendingMatchProposals,
  listRemittanceWorkItems,
  proposeCollectionMatch,
  validateCollectionRemittance,
} from '@/features/collections-core/collectionsCoreService';
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

function EntryPanel({ allowed }: { allowed: boolean }) {
  const queryClient = useQueryClient();
  const accounts = useQuery({ queryKey: ['collections-core', 'accounts'], queryFn: listCollectionAccounts, enabled: allowed });
  const [form, setForm] = useState<CollectionEntryInput>({
    clientName: '', method: 'CHECK', amount: 0, currency: 'XOF', clientBank: '',
    depositAccountId: '', depositDate: '', declaredCreditDate: '', instrumentReference: '',
    maturityDate: '', invoiceReference: '', slipReference: '', businessNature: 'STANDARD', note: '',
  });
  const [workflowKey, setWorkflowKey] = useState(readEntryWorkflowKey);
  const submit = useMutation({
    mutationFn: createCollectionEntry,
    onSuccess: async () => {
      toast.success('Remise enregistrée en brouillon.');
      setWorkflowKey(rotateEntryWorkflowKey());
      setForm((current) => ({ ...current, clientName: '', amount: 0, clientBank: '', instrumentReference: '', maturityDate: '', invoiceReference: '', slipReference: '', note: '' }));
      await queryClient.invalidateQueries({ queryKey: ['collections-core'] });
    },
    onError: (error) => toast.error(`${errorMessage(error)} Aucun brouillon incomplet n’a été conservé.`),
  });
  const set = <K extends keyof CollectionEntryInput>(key: K, value: CollectionEntryInput[K]) =>
    setForm((current) => ({ ...current, [key]: value }));
  const chosenAccount = accounts.data?.find((account) => account.id === form.depositAccountId);

  if (!allowed) return <Empty>Votre compte ne peut pas saisir de remise.</Empty>;
  if (accounts.isError) return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(accounts.error)}</AlertDescription></Alert>;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><PlusCircle className="h-5 w-5" />Nouvelle remise</CardTitle>
        <CardDescription>Cette saisie remplace le nouveau remplissage manuel du fichier Collection Report.</CardDescription>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 md:grid-cols-3" onSubmit={(event) => { event.preventDefault(); submit.mutate({ input: form, workflowKey }); }}>
          <div><Label htmlFor="deposit-date">Date de remise</Label><Input id="deposit-date" className={fieldClass} type="date" required value={form.depositDate} onChange={(e) => set('depositDate', e.target.value)} /></div>
          <div><Label htmlFor="method">Mode</Label><select id="method" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.method} onChange={(e) => set('method', e.target.value as ReceiptMethod)}><option value="CHECK">Chèque</option><option value="EFFECT">Effet</option><option value="TRANSFER">Virement</option><option value="CASH">Espèces</option></select></div>
          <div><Label htmlFor="amount">Montant</Label><Input id="amount" className={fieldClass} type="number" min="0.01" step="0.01" required value={form.amount || ''} onChange={(e) => set('amount', Number(e.target.value))} /></div>
          <div><Label htmlFor="client">Client SODATRA</Label><Input id="client" className={fieldClass} required value={form.clientName} onChange={(e) => set('clientName', e.target.value)} /></div>
          <div><Label htmlFor="client-bank">Banque du client</Label><Input id="client-bank" className={fieldClass} value={form.clientBank} onChange={(e) => set('clientBank', e.target.value)} /></div>
          <div><Label htmlFor="deposit-account">Banque de dépôt SODATRA</Label><select id="deposit-account" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required value={form.depositAccountId} onChange={(e) => { const id=e.target.value; const account=accounts.data?.find((entry)=>entry.id===id); setForm((current)=>({...current,depositAccountId:id,currency:account?.currency ?? current.currency})); }}><option value="">Choisir…</option>{accounts.data?.map((account)=><option key={account.id} value={account.id}>{account.bank} — {account.safeAlias} ({account.currency})</option>)}</select></div>
          {(form.method === 'CHECK' || form.method === 'EFFECT') && <div><Label htmlFor="instrument">{form.method === 'CHECK' ? 'N° du chèque' : 'Référence effet (facultative)'}</Label><Input id="instrument" className={fieldClass} required={form.method === 'CHECK'} value={form.instrumentReference} onChange={(e) => set('instrumentReference', e.target.value)} /></div>}
          {form.method === 'EFFECT' && <div><Label htmlFor="maturity">Échéance de l’effet</Label><Input id="maturity" className={fieldClass} type="date" required value={form.maturityDate} onChange={(e) => set('maturityDate', e.target.value)} /></div>}
          <div><Label htmlFor="invoice">Facture n° (facultatif)</Label><Input id="invoice" className={fieldClass} value={form.invoiceReference} onChange={(e) => set('invoiceReference', e.target.value)} /></div>
          <div><Label htmlFor="slip">Bordereau / référence</Label><Input id="slip" className={fieldClass} value={form.slipReference} onChange={(e) => set('slipReference', e.target.value)} /></div>
          <div><Label htmlFor="declared-date">Date de crédit déclarée</Label><Input id="declared-date" className={fieldClass} type="date" value={form.declaredCreditDate} onChange={(e) => set('declaredCreditDate', e.target.value)} /></div>
          <div><Label htmlFor="nature">Nature</Label><select id="nature" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={form.businessNature} onChange={(e) => set('businessNature', e.target.value as 'STANDARD'|'PROROGATION')}><option value="STANDARD">Standard</option><option value="PROROGATION">Prorogation</option></select></div>
          <div className="md:col-span-3"><Label htmlFor="note">Note</Label><Textarea id="note" className={fieldClass} value={form.note} onChange={(e) => set('note', e.target.value)} /></div>
          <div className="md:col-span-3 flex items-center justify-between"><span className="text-xs text-muted-foreground">Devise : {chosenAccount?.currency ?? form.currency}. Une autre personne devra valider.</span><Button disabled={submit.isPending || accounts.isPending} type="submit">{submit.isPending ? 'Enregistrement…' : 'Enregistrer le brouillon'}</Button></div>
        </form>
      </CardContent>
    </Card>
  );
}

function ValidationPanel({ allowed }: { allowed: boolean }) {
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
  return <div className="space-y-3">{drafts.data.map((item)=><Card key={item.itemId}><CardContent className="grid gap-3 pt-5 md:grid-cols-[1fr_1fr_auto] md:items-end"><div><p className="font-medium">{item.clientName} — {money.format(item.amount)} {item.currency}</p><p className="text-sm text-muted-foreground">{item.depositDate} · {item.method} {item.instrumentReference ?? ''} · saisie {item.remittanceCreatedBy.slice(0,8)}</p></div><div><Label htmlFor={`reason-${item.itemId}`}>Motif de validation</Label><Input id={`reason-${item.itemId}`} className={fieldClass} value={reasons[item.remittanceId] ?? ''} onChange={(e)=>setReasons((current)=>({...current,[item.remittanceId]:e.target.value}))} /></div><Button disabled={mutation.isPending || !(reasons[item.remittanceId]?.trim())} onClick={()=>mutation.mutate({id:item.remittanceId,reason:reasons[item.remittanceId]})}>Valider</Button></CardContent></Card>)}</div>;
}

function MatchingPanel({ canPropose, canConfirm }: { canPropose: boolean; canConfirm: boolean }) {
  const queryClient = useQueryClient();
  const items = useQuery({ queryKey: ['collections-core', 'matchable-items'], queryFn: () => listRemittanceWorkItems(['SUBMITTED','PARTIALLY_CREDITED']), enabled: canPropose });
  const lines = useQuery({ queryKey: ['collections-core', 'credit-lines'], queryFn: listActiveCreditLines, enabled: canPropose });
  const proposals = useQuery({ queryKey: ['collections-core', 'pending-proposals'], queryFn: listPendingMatchProposals, enabled: canConfirm });
  const [itemId,setItemId]=useState(''); const [lineId,setLineId]=useState(''); const [basis,setBasis]=useState<EvidenceBasis>('EXACT_CREDIT');
  const [credit,setCredit]=useState(0); const [gross,setGross]=useState(0); const [reason,setReason]=useState(''); const [decisionReasons,setDecisionReasons]=useState<Record<string,string>>({});
  const selectedItem=items.data?.find((item)=>item.itemId===itemId);
  const compatibleLines=useMemo(()=>lines.data?.filter((line)=>!selectedItem || (line.accountId===selectedItem.depositAccountId && line.currency===selectedItem.currency)) ?? [],[lines.data,selectedItem]);
  const propose=useMutation({mutationFn:proposeCollectionMatch,onSuccess:async()=>{toast.success('Rapprochement proposé pour contrôle.');setItemId('');setLineId('');setCredit(0);setGross(0);setReason('');await queryClient.invalidateQueries({queryKey:['collections-core']});},onError:(error)=>toast.error(errorMessage(error))});
  const decide=useMutation({mutationFn:({id,decision,why}:{id:string;decision:'CONFIRM'|'REJECT';why:string})=>decideCollectionMatch(id,decision,why),onSuccess:async()=>{toast.success('Décision enregistrée.');await queryClient.invalidateQueries({queryKey:['collections-core']});},onError:(error)=>toast.error(errorMessage(error))});
  const readError = items.error ?? lines.error ?? proposals.error;
  if (readError) return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(readError)}</AlertDescription></Alert>;
  return <div className="space-y-6">
    {canPropose ? <Card><CardHeader><CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />Proposer un rapprochement</CardTitle><CardDescription>Seules les lignes crédit de la même banque de dépôt et de la même devise sont proposées. Les débits de frais séparés restent dans le relevé bancaire et ne sont pas rattachés à la remise.</CardDescription></CardHeader><CardContent><form className="grid gap-4 md:grid-cols-2" onSubmit={(e)=>{e.preventDefault();propose.mutate({itemId,creditLineId:lineId,creditConsumedAmount:credit,settledGrossAmount:gross,evidenceBasis:basis,reason});}}><div><Label htmlFor="match-item">Remise</Label><select id="match-item" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required value={itemId} onChange={(e)=>{const id=e.target.value;const item=items.data?.find((entry)=>entry.itemId===id);setItemId(id);setLineId('');setGross(item?.amount ?? 0);setCredit(item?.amount ?? 0);}}><option value="">Choisir…</option>{items.data?.map((item)=><option key={item.itemId} value={item.itemId}>{item.depositDate} · {item.clientName} · {money.format(item.amount)} {item.currency}</option>)}</select></div><div><Label htmlFor="credit-line">Crédit bancaire</Label><select id="credit-line" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" required value={lineId} onChange={(e)=>{const id=e.target.value;const line=compatibleLines.find((entry)=>entry.id===id);setLineId(id);setCredit(line?.amount ?? 0);}}><option value="">Choisir…</option>{compatibleLines.map((line)=><option key={line.id} value={line.id}>{line.accountingDate} · {money.format(line.amount)} {line.currency} · {line.description.slice(0,70)}</option>)}</select></div><div><Label htmlFor="basis">Type de preuve</Label><select id="basis" className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm" value={basis} onChange={(e)=>setBasis(e.target.value as EvidenceBasis)}><option value="EXACT_CREDIT">Crédit au nominal</option><option value="NET_OF_DISCOUNT">Crédit net après retenue bancaire</option></select></div><div className="grid grid-cols-2 gap-2"><div><Label htmlFor="gross">Nominal réglé</Label><Input id="gross" className={fieldClass} type="number" min="0.01" step="0.01" value={gross||''} onChange={(e)=>setGross(Number(e.target.value))}/></div><div><Label htmlFor="credit">Crédit observé</Label><Input id="credit" className={fieldClass} type="number" min="0.01" step="0.01" value={credit||''} onChange={(e)=>setCredit(Number(e.target.value))}/></div></div><div className="md:col-span-2"><Label htmlFor="match-reason">Justification</Label><Textarea id="match-reason" className={fieldClass} required value={reason} onChange={(e)=>setReason(e.target.value)} /></div><div className="md:col-span-2 flex justify-end"><Button disabled={propose.isPending} type="submit">Proposer</Button></div></form></CardContent></Card> : <Empty>Votre compte ne peut pas proposer de rapprochement.</Empty>}
    {canConfirm && <Card><CardHeader><CardTitle>Rapprochements à confirmer</CardTitle><CardDescription>La confirmation doit être faite par une autre personne que le proposant.</CardDescription></CardHeader><CardContent>{proposals.isPending?<Empty>Chargement…</Empty>:!proposals.data?.length?<Empty>Aucun rapprochement en attente.</Empty>:<div className="space-y-3">{proposals.data.map((proposal)=><div key={proposal.id} className="grid gap-3 rounded-md border p-3 md:grid-cols-[1fr_1fr_auto_auto] md:items-end"><div><p className="font-medium">{money.format(proposal.creditAmount)} · {proposal.evidenceBasis}</p><p className="text-xs text-muted-foreground">Proposé par {proposal.proposedBy.slice(0,8)} · {proposal.reason}</p></div><div><Label htmlFor={`decision-${proposal.id}`}>Motif de décision</Label><Input id={`decision-${proposal.id}`} className={fieldClass} value={decisionReasons[proposal.id]??''} onChange={(e)=>setDecisionReasons((current)=>({...current,[proposal.id]:e.target.value}))}/></div><Button variant="outline" disabled={!decisionReasons[proposal.id]?.trim()||decide.isPending} onClick={()=>decide.mutate({id:proposal.id,decision:'REJECT',why:decisionReasons[proposal.id]})}>Rejeter</Button><Button disabled={!decisionReasons[proposal.id]?.trim()||decide.isPending} onClick={()=>decide.mutate({id:proposal.id,decision:'CONFIRM',why:decisionReasons[proposal.id]})}>Confirmer</Button></div>)}</div>}</CardContent></Card>}
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
  const capabilities=useQuery({queryKey:['collections-core','capabilities'],queryFn:getCollectionCapabilities,staleTime:60_000});
  if(capabilities.isPending)return <Empty>Vérification des habilitations Collections…</Empty>;
  if(capabilities.isError)return <Alert variant="destructive"><AlertCircle className="h-4 w-4"/><AlertDescription>{errorMessage(capabilities.error)}</AlertDescription></Alert>;
  const has=(capability:CollectionCapability)=>capabilities.data?.[capability]===true;
  if(!Object.values(capabilities.data??{}).some(Boolean))return <Alert><AlertCircle className="h-4 w-4"/><AlertDescription>Aucune habilitation Collections ne vous est attribuée.</AlertDescription></Alert>;
  return <div className="space-y-6"><div><h1 className="flex items-center gap-2 text-3xl font-bold"><Landmark className="h-7 w-7"/>Collections et remises</h1><p className="mt-2 text-muted-foreground">Préparer, contrôler et justifier les encaissements — sans exécuter de paiement ni passer d’écriture comptable.</p></div><Alert><CheckCircle2 className="h-4 w-4"/><AlertDescription>La banque de dépôt est une contrainte de rapprochement : un crédit dans une autre banque ne peut pas confirmer la remise.</AlertDescription></Alert><Tabs defaultValue={has('ENTRY')?'entry':has('VALIDATE_REMITTANCE')?'validation':has('PROPOSE_MATCH')||has('CONFIRM_MATCH')?'matching':'register'}><TabsList className="grid w-full grid-cols-4"><TabsTrigger value="entry">Saisir</TabsTrigger><TabsTrigger value="validation">Valider</TabsTrigger><TabsTrigger value="matching">Rapprocher</TabsTrigger><TabsTrigger value="register">Registre</TabsTrigger></TabsList><TabsContent value="entry" className="mt-4"><EntryPanel allowed={has('ENTRY')}/></TabsContent><TabsContent value="validation" className="mt-4"><ValidationPanel allowed={has('VALIDATE_REMITTANCE')}/></TabsContent><TabsContent value="matching" className="mt-4"><MatchingPanel canPropose={has('PROPOSE_MATCH')} canConfirm={has('CONFIRM_MATCH')}/></TabsContent><TabsContent value="register" className="mt-4"><RegisterPanel allowed={has('AUDIT')}/></TabsContent></Tabs></div>;
}
