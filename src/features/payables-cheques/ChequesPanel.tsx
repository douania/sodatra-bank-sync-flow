import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  assignChequeForm,
  confirmIssuance,
  declareIssuanceException,
  listContents,
  listDeliveries,
  listExits,
  listForms,
  listIssuances,
  listParameters,
  listPayments,
  listPersons,
  listPrintEvents,
  listSignatures,
  readAccounts,
  recordDelivery,
  recordPrintIntent,
  recordPrintOutcome,
  recordSignature,
  recordUnusedForm,
  requestExit,
  reviseChequeContent,
  validateExit,
} from './payablesChequesService';
import { ChequePrintSheet } from './ChequePrintSheet';
import {
  allowedExitKinds,
  buildChequeRegister,
  PROVENANCE_LABELS,
  REGISTER_FILTER_LABELS,
  type RegisterEntry,
  type RegisterFilter,
} from './chequeRegisterModel';
import type { ChequeContentFields } from './chequeLayout';
import {
  ISSUANCE_EXCEPTION_REASONS,
  type AccountRow,
  type ChequeFormRow,
  type PayablesAccess,
  type PaymentRow,
  type PrintOutcome,
} from './payablesChequesTypes';

const ACTIVE_FORM_STATES: readonly string[] = ['ASSIGNED', 'PRINT_PENDING', 'PRINTED', 'PRINT_UNCERTAIN', 'ISSUED', 'CLEARED'];
import { canDeclarePrintOutcome, INITIAL_PRINT_FLOW, PRINT_OUTCOME_LABELS, printFlowReducer } from './printFlow';
import { Amount, Field, hasCapability, nativeSelectClass, PAYABLES_QUERY_ROOT, today, usePayablesMutation } from './payablesUi';

const FORM_STATE_LABELS: Record<string, string> = {
  ASSIGNED: 'Formule assignée', PRINT_PENDING: 'Impression en attente de résultat', PRINTED: 'Imprimé, en attente de signature',
  PRINT_UNCERTAIN: 'Impression incertaine', UNUSED: 'Formule inutilisée', LOST: 'Formule perdue', PRESIGNED_HELD: 'Pré-signée en garde',
  ISSUED: 'Émis, en circulation', CLEARED: 'Débité (sorti par la banque)', CANCELLED: 'Annulé', REPLACED: 'Remplacé',
};

function useChequeData() {
  const payments = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'payments'], queryFn: listPayments });
  const forms = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'forms'], queryFn: listForms });
  const contents = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'contents'], queryFn: listContents });
  const printEvents = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'print-events'], queryFn: listPrintEvents });
  const signatures = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'signatures'], queryFn: listSignatures });
  const persons = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'persons'], queryFn: listPersons });
  const parameters = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'parameters'], queryFn: listParameters });
  const exits = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'exits'], queryFn: listExits });
  const issuances = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'issuances'], queryFn: listIssuances });
  const deliveries = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'deliveries'], queryFn: listDeliveries });
  return { payments, forms, contents, printEvents, signatures, persons, parameters, exits, issuances, deliveries };
}

function PrintStep({ form, contentId, fields, layout, pendingEventId }: {
  form: ChequeFormRow; contentId: string; fields: ChequeContentFields; layout: unknown; pendingEventId: string | null;
}) {
  const [flow, dispatch] = useReducer(printFlowReducer, INITIAL_PRINT_FLOW);
  const [outcomeReason, setOutcomeReason] = useState('');
  const intentMutation = usePayablesMutation('print-intent', (key, _: void) =>
    recordPrintIntent(key, form.id, form.row_version, contentId, 'Impression sur formule ORABANK'), 'Intention d’impression enregistrée.');
  const outcomeMutation = usePayablesMutation('print-outcome', (key, input: { eventId: string; outcome: PrintOutcome }) =>
    recordPrintOutcome(key, input.eventId, input.outcome, input.outcome === 'PRINTED' ? null : outcomeReason),
  'Résultat d’impression enregistré.');

  // Impression navigateur : afterprint n'ouvre que la demande de confirmation.
  // L'écouteur (unique) et l'appel d'impression survivent au passage à l'étape
  // « printing » ; le calque d'impression est alors déjà rendu dans le document.
  // Ils ne sont retirés qu'à la fermeture déclarée ou au démontage.
  const afterPrintRef = useRef<(() => void) | null>(null);
  const printTimerRef = useRef<number | null>(null);
  const detachAfterPrint = () => {
    if (afterPrintRef.current) window.removeEventListener('afterprint', afterPrintRef.current);
    afterPrintRef.current = null;
  };
  useEffect(() => () => {
    if (afterPrintRef.current) window.removeEventListener('afterprint', afterPrintRef.current);
    if (printTimerRef.current !== null) window.clearTimeout(printTimerRef.current);
  }, []);
  useEffect(() => {
    if (flow.step !== 'intent_recorded') return;
    const onAfterPrint = () => {
      afterPrintRef.current = null;
      dispatch({ type: 'AFTERPRINT' });
    };
    afterPrintRef.current = onAfterPrint;
    window.addEventListener('afterprint', onAfterPrint, { once: true });
    dispatch({ type: 'PRINT_STARTED' });
    printTimerRef.current = window.setTimeout(() => {
      printTimerRef.current = null;
      window.print();
    }, 50);
  }, [flow.step]);

  const eventId = flow.step === 'awaiting_confirmation' || flow.step === 'printing' || flow.step === 'intent_recorded'
    ? flow.intent.print_event_id : pendingEventId;
  const askOutcome = canDeclarePrintOutcome(flow) || (flow.step === 'idle' && pendingEventId !== null);

  return (
    <div className="space-y-3">
      <ChequePrintSheet fields={fields} layout={layout} mode="preview" />
      <p className="text-xs text-muted-foreground">
        Aperçu des seuls champs imprimés. Vérifiez à l’impression : échelle 100 %, aucun ajustement à la page, formule
        dans le bac prévu par le profil validé. L’application ne règle pas le pilote.
      </p>
      {flow.step === 'idle' && pendingEventId === null && form.state === 'ASSIGNED' && (
        <Button onClick={() => intentMutation.mutate(undefined, {
          onSuccess: (intent) => dispatch({ type: 'INTENT_RECORDED', intent }),
        })} disabled={intentMutation.isPending}>
          Enregistrer l’intention puis imprimer
        </Button>
      )}
      {flow.step === 'printing' && (
        <Button variant="outline" onClick={() => {
          detachAfterPrint();
          dispatch({ type: 'DIALOG_CLOSED_BY_USER' });
        }}>
          J’ai fermé la boîte d’impression
        </Button>
      )}
      {(flow.step === 'intent_recorded' || flow.step === 'printing') && createPortal(
        <ChequePrintSheet fields={flow.intent.fields as unknown as ChequeContentFields} layout={flow.intent.layout} mode="print" />,
        document.body,
      )}
      {askOutcome && eventId && (
        <Alert>
          <AlertDescription className="space-y-2">
            <p>Qu’est-il réellement sorti de l’imprimante ? Cette déclaration fait foi, pas le navigateur.</p>
            <Input aria-label="Motif (obligatoire sauf impression correcte)" value={outcomeReason}
              onChange={(e) => setOutcomeReason(e.target.value)} />
            <div className="flex flex-wrap gap-2">
              {(Object.keys(PRINT_OUTCOME_LABELS) as PrintOutcome[]).map((outcome) => (
                <Button key={outcome} size="sm" variant={outcome === 'PRINTED' ? 'default' : 'outline'}
                  disabled={outcomeMutation.isPending || (outcome !== 'PRINTED' && outcomeReason.trim().length < 3)}
                  onClick={() => outcomeMutation.mutate({ eventId, outcome }, {
                    // Le résultat est enregistré : retour à l'état initial, la
                    // formule rechargée décide de la suite (réimpression si
                    // elle redevient assignée, signature si elle est imprimée).
                    onSuccess: () => {
                      dispatch({ type: 'OUTCOME_RECORDED', outcome });
                      dispatch({ type: 'RESET' });
                      setOutcomeReason('');
                    },
                  })}>
                  {PRINT_OUTCOME_LABELS[outcome]}
                </Button>
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

function ChequeRow({ payment, access, data }: { payment: PaymentRow; access: PayablesAccess; data: ReturnType<typeof useChequeData> }) {
  const form = (data.forms.data ?? []).find((f) => f.payment_id === payment.id && ACTIVE_FORM_STATES.includes(f.state));
  const content = form ? (data.contents.data ?? []).filter((c) => c.form_id === form.id).sort((a, b) => b.version_no - a.version_no)[0] : undefined;
  const profile = content ? (data.parameters.data ?? []).find((p) => p.id === content.profile_version_id) : undefined;
  const pendingEvent = form ? (data.printEvents.data ?? []).find((e) => e.form_id === form.id && e.status === 'PENDING') : undefined;
  const signatures = content ? (data.signatures.data ?? []).filter((s) => s.content_id === content.id) : [];
  const activePersons = (data.persons.data ?? []).filter((p) => p.status === 'ACTIVE');

  const [assign, setAssign] = useState({ number: '', profile: 'ORA_CHQ_170X95', printedDate: today() });
  const [signature, setSignature] = useState({ personId: '', signedOn: today() });
  const [issue, setIssue] = useState({ date: today(), presigned: false });
  const [reason, setReason] = useState('');
  const [exceptionForm, setExceptionForm] = useState({ reasonCode: 'OTHER_OUTSIDE_CIRCUIT', amount: String(payment.amount), evidence: '' });

  const assignMutation = usePayablesMutation('assign-form', (key, _: void) => assignChequeForm(key, payment.id, payment.row_version,
    assign.number, assign.profile, assign.printedDate), 'Formule assignée.');
  const reviseMutation = usePayablesMutation('revise-content', (key, _: void) => reviseChequeContent(key, form!.id, form!.row_version,
    assign.printedDate, reason), 'Nouvelle version du contenu.');
  const unusedMutation = usePayablesMutation('unused-form', (key, _: void) => recordUnusedForm(key, form!.id, form!.row_version, reason),
    'Formule enregistrée inutilisée.');
  const signatureMutation = usePayablesMutation('signature', (key, _: void) => recordSignature(key, form!.id, content!.id,
    signature.personId, signature.signedOn), 'Signature enregistrée.');
  const issueMutation = usePayablesMutation('confirm-issue', (key, _: void) => confirmIssuance(key, form!.id, form!.row_version,
    issue.date, issue.presigned), 'Émission confirmée : chèque en circulation.');
  const exceptionMutation = usePayablesMutation('declare-exception', (key, _: void) => declareIssuanceException(key, {
    accountId: payment.bank_account_id, chequeNumber: form!.cheque_number,
    amount: /^[1-9][0-9]*$/.test(exceptionForm.amount) ? Number(exceptionForm.amount) : null, issueDate: issue.date,
    paymentId: payment.id, reasonCode: exceptionForm.reasonCode, evidenceRef: exceptionForm.evidence, reason,
  }), 'Émission déclarée en exception (aucune approbation créée).');

  const canPrepare = hasCapability(access, 'CHEQUE_PREPARE_PRINT');
  const canConfirm = hasCapability(access, 'CHEQUE_CONFIRM_ISSUE');

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex flex-wrap items-center gap-2 text-base">
          {payment.beneficiary} — <Amount value={payment.amount} />
          <Badge variant="outline">{form ? `N° ${form.cheque_number} · ${FORM_STATE_LABELS[form.state]}` : 'Sans formule'}</Badge>
        </CardTitle>
        <CardDescription>Catégorie {payment.category_code}{payment.is_partial ? ' · paiement partiel' : ''}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Field label="Motif (pour les actions qui l’exigent)" htmlFor={`reason-${payment.id}`}>
          <Input id={`reason-${payment.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>

        {!form && payment.status === 'OPEN' && canPrepare && (
          <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); assignMutation.mutate(); }}>
            <Input aria-label="Numéro préimprimé" placeholder="Numéro préimprimé" value={assign.number}
              onChange={(e) => setAssign({ ...assign, number: e.target.value })} />
            <Input aria-label="Profil d’impression" value={assign.profile} onChange={(e) => setAssign({ ...assign, profile: e.target.value })} />
            <Input aria-label="Date imprimée" type="date" value={assign.printedDate}
              onChange={(e) => setAssign({ ...assign, printedDate: e.target.value })} />
            <Button type="submit" disabled={assignMutation.isPending || !/^[0-9]{1,16}$/.test(assign.number)}>Assigner la formule</Button>
          </form>
        )}

        {form && content && profile && ['ASSIGNED', 'PRINT_PENDING'].includes(form.state) && canPrepare && (
          <>
            <PrintStep form={form} contentId={content.id} fields={content.fields as unknown as ChequeContentFields}
              layout={profile.payload} pendingEventId={pendingEvent?.id ?? null} />
            {form.state === 'ASSIGNED' && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={() => reviseMutation.mutate()} disabled={reason.trim().length < 5}>
                  Nouvelle version (date imprimée)
                </Button>
                <Button variant="outline" onClick={() => unusedMutation.mutate()} disabled={reason.trim().length < 5}>
                  Formule inutilisée
                </Button>
              </div>
            )}
          </>
        )}

        {form?.state === 'PRINTED' && (
          <div className="space-y-3">
            <p className="text-sm">
              Signatures sur la version courante : {signatures.length === 0 ? 'aucune' : signatures.map((s) =>
                activePersons.find((p) => p.id === s.person_id)?.display_name ?? s.person_id).join(', ')}
            </p>
            {canConfirm && (
              <div className="grid gap-2 sm:grid-cols-3">
                <select aria-label="Signataire" className={nativeSelectClass} value={signature.personId}
                  onChange={(e) => setSignature({ ...signature, personId: e.target.value })}>
                  <option value="">Signataire…</option>
                  {activePersons.map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                </select>
                <Input aria-label="Date de signature" type="date" value={signature.signedOn}
                  onChange={(e) => setSignature({ ...signature, signedOn: e.target.value })} />
                <Button variant="outline" onClick={() => signatureMutation.mutate()} disabled={!signature.personId}>Enregistrer la signature</Button>
                <Input aria-label="Date réelle d’émission" type="date" value={issue.date} onChange={(e) => setIssue({ ...issue, date: e.target.value })} />
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={issue.presigned} onChange={(e) => setIssue({ ...issue, presigned: e.target.checked })} />
                  Formule pré-signée
                </label>
                <Button onClick={() => issueMutation.mutate()}>Confirmer l’émission</Button>
              </div>
            )}
            {canConfirm && (
              <div className="grid gap-2 rounded border p-3 sm:grid-cols-4">
                <p className="text-sm sm:col-span-4">
                  Chèque réellement émis hors circuit approuvé : enregistrer le fait, sans approbation.
                </p>
                <select aria-label="Motif d’exception" className={nativeSelectClass} value={exceptionForm.reasonCode}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, reasonCode: e.target.value })}>
                  {ISSUANCE_EXCEPTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
                <Input aria-label="Montant connu (vide si inconnu)" value={exceptionForm.amount}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, amount: e.target.value })} />
                <Input aria-label="Justificatif" placeholder="Justificatif" value={exceptionForm.evidence}
                  onChange={(e) => setExceptionForm({ ...exceptionForm, evidence: e.target.value })} />
                <Button variant="destructive" onClick={() => exceptionMutation.mutate()} disabled={reason.trim().length < 5}>
                  Déclarer en exception
                </Button>
              </div>
            )}
            {canPrepare && (
              <Button variant="outline" onClick={() => unusedMutation.mutate()} disabled={reason.trim().length < 5}>
                Formule renvoyée ou détruite : inutilisée
              </Button>
            )}
          </div>
        )}

        {form?.state === 'ISSUED' && <IssuedFormActions form={form} access={access} />}
      </CardContent>
    </Card>
  );
}

/** Actions sur un chèque émis en circulation, quelle que soit son origine. */
function IssuedFormActions({ form, access }: { form: ChequeFormRow; access: PayablesAccess }) {
  const kinds = allowedExitKinds({
    form, issuance: null, issuanceRevisions: [], delivery: null, exits: [], hasPayment: form.payment_id !== null,
    inCirculation: form.state === 'ISSUED',
  });
  const [reason, setReason] = useState('');
  const [deliveredOn, setDeliveredOn] = useState(today());
  const [exitForm, setExitForm] = useState({ kind: 'CANCELLATION', beneficiary: '', amount: '', issueDate: '', evidence: '' });
  const deliveryMutation = usePayablesMutation('delivery', (key, _: void) => recordDelivery(key, form.id, deliveredOn, null),
    'Remise enregistrée.');
  const exitMutation = usePayablesMutation('request-exit', (key, _: void) => requestExit(key, form.id, form.row_version, exitForm.kind,
    exitForm.kind === 'REPLACEMENT'
      ? { ...(exitForm.beneficiary ? { beneficiary: exitForm.beneficiary } : {}), ...(exitForm.amount ? { amount: Number(exitForm.amount) } : {}) }
      : exitForm.kind === 'CORRECTION' ? { issue_date: exitForm.issueDate } : {},
    exitForm.evidence, reason), 'Demande transmise pour validation par un autre comptable.');
  return (
    <div className="space-y-3">
      <Field label="Motif (pour les actions qui l’exigent)" htmlFor={`issued-reason-${form.id}`}>
        <Input id={`issued-reason-${form.id}`} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {hasCapability(access, 'CHEQUE_CONFIRM_ISSUE') && (
        <div className="flex gap-2">
          <Input aria-label="Date de remise" type="date" value={deliveredOn} onChange={(e) => setDeliveredOn(e.target.value)} />
          <Button variant="outline" onClick={() => deliveryMutation.mutate()}>Remise au bénéficiaire</Button>
        </div>
      )}
      {hasCapability(access, 'EXIT_REQUEST') && kinds.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-5">
          <select aria-label="Type de sortie" className={nativeSelectClass} value={exitForm.kind}
            onChange={(e) => setExitForm({ ...exitForm, kind: e.target.value })}>
            {kinds.includes('CANCELLATION') && <option value="CANCELLATION">Annulation</option>}
            {kinds.includes('REPLACEMENT') && <option value="REPLACEMENT">Remplacement</option>}
            {kinds.includes('CORRECTION') && <option value="CORRECTION">Correction de la date d’émission</option>}
          </select>
          {exitForm.kind === 'REPLACEMENT' && (
            <Input aria-label="Nouveau bénéficiaire (facultatif)" value={exitForm.beneficiary}
              onChange={(e) => setExitForm({ ...exitForm, beneficiary: e.target.value })} />
          )}
          {exitForm.kind === 'CORRECTION' && (
            <Input aria-label="Date réelle corrigée" type="date" value={exitForm.issueDate}
              onChange={(e) => setExitForm({ ...exitForm, issueDate: e.target.value })} />
          )}
          <Input aria-label="Justificatif de la sortie" placeholder="Justificatif" value={exitForm.evidence}
            onChange={(e) => setExitForm({ ...exitForm, evidence: e.target.value })} />
          <Button variant="outline" onClick={() => exitMutation.mutate()} disabled={reason.trim().length < 5}>Demander</Button>
        </div>
      )}
    </div>
  );
}

const EXIT_KIND_LABELS: Record<string, string> = {
  CANCELLATION: 'Annulation', REPLACEMENT: 'Remplacement', CORRECTION: 'Correction de date', BANK_MATCH: 'Débit rapproché',
};

function RegisterDetail({ entry, access }: { entry: RegisterEntry; access: PayablesAccess }) {
  return (
    <div className="space-y-3 rounded border p-3" data-testid="register-detail">
      <div className="text-sm">
        <span className="font-medium">N° {entry.form.cheque_number}</span> · {PROVENANCE_LABELS[entry.form.provenance]} ·{' '}
        {FORM_STATE_LABELS[entry.form.state]}{entry.hasPayment ? '' : ' · sans paiement rattaché'}
      </div>
      <div className="text-sm">
        Émission : {entry.issuanceRevisions.length === 0 ? 'aucune' : entry.issuanceRevisions.map((i) =>
          `révision ${i.revision_no} (${i.path}) le ${i.issue_date}, ${i.amount === null ? 'montant inconnu' : `${i.amount} XOF`}`).join(' ; ')}
      </div>
      <div className="text-sm">Remise : {entry.delivery ? `le ${entry.delivery.delivered_on}` : 'non enregistrée'}</div>
      <div className="text-sm">
        Sorties : {entry.exits.length === 0 ? 'aucune' : entry.exits.map((e) =>
          `${EXIT_KIND_LABELS[e.kind] ?? e.kind} (${e.status})`).join(' ; ')}
      </div>
      {entry.inCirculation && <IssuedFormActions form={entry.form} access={access} />}
    </div>
  );
}

/** Registre complet : circuit, reprise et émissions déclarées sans paiement. */
function ChequeRegister({ access, data, accounts }: {
  access: PayablesAccess; data: ReturnType<typeof useChequeData>; accounts: AccountRow[];
}) {
  const [filter, setFilter] = useState<RegisterFilter>('CIRCULATION');
  const [selected, setSelected] = useState<string | null>(null);
  const entries = useMemo(() => buildChequeRegister(data.forms.data ?? [], data.issuances.data ?? [],
    data.deliveries.data ?? [], data.exits.data ?? [], filter),
  [data.forms.data, data.issuances.data, data.deliveries.data, data.exits.data, filter]);
  const error = data.forms.error ?? data.issuances.error ?? data.deliveries.error ?? data.exits.error;
  const accountLabel = (id: string) => {
    const account = accounts.find((a) => a.account_id === id);
    return account ? `${account.bank} — ${account.account_alias}` : id;
  };
  const selectedEntry = entries.find((e) => e.form.id === selected);
  return (
    <Card>
      <CardHeader>
        <CardTitle>Registre des chèques</CardTitle>
        <CardDescription>
          Toutes les formules : circuit, reprise initiale et émissions déclarées sans paiement. Chaque chèque est consultable
          individuellement ; les actions autorisées y sont proposées.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <select aria-label="Filtre du registre" className={nativeSelectClass} value={filter}
          onChange={(e) => { setFilter(e.target.value as RegisterFilter); setSelected(null); }}>
          {(Object.keys(REGISTER_FILTER_LABELS) as RegisterFilter[]).map((f) => (
            <option key={f} value={f}>{REGISTER_FILTER_LABELS[f]}</option>
          ))}
        </select>
        {error && <Alert variant="destructive"><AlertDescription>{(error as Error).message}</AlertDescription></Alert>}
        {!error && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>N°</TableHead>
                <TableHead>Compte</TableHead>
                <TableHead>Origine</TableHead>
                <TableHead>État</TableHead>
                <TableHead>Émis le</TableHead>
                <TableHead>Montant</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.form.id} data-testid="register-row">
                  <TableCell className="font-mono">{entry.form.cheque_number}</TableCell>
                  <TableCell>{accountLabel(entry.form.bank_account_id)}</TableCell>
                  <TableCell>{PROVENANCE_LABELS[entry.form.provenance]}{entry.hasPayment ? '' : ' (sans paiement)'}</TableCell>
                  <TableCell>{FORM_STATE_LABELS[entry.form.state]}</TableCell>
                  <TableCell>{entry.issuance?.issue_date ?? '—'}</TableCell>
                  <TableCell>{entry.issuance ? <Amount value={entry.issuance.amount} /> : '—'}</TableCell>
                  <TableCell>
                    <Button size="sm" variant="outline"
                      onClick={() => setSelected(selected === entry.form.id ? null : entry.form.id)}>
                      {selected === entry.form.id ? 'Fermer' : 'Consulter'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        {!error && entries.length === 0 && <p className="text-sm text-muted-foreground">Aucun chèque pour ce filtre.</p>}
        {selectedEntry && <RegisterDetail entry={selectedEntry} access={access} />}
      </CardContent>
    </Card>
  );
}

export function ChequesPanel({ access }: { access: PayablesAccess }) {
  const data = useChequeData();
  const accounts = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'accounts'], queryFn: readAccounts });
  const cheques = useMemo(() => (data.payments.data ?? []).filter((p) => p.mode === 'CHEQUE'
    && ['OPEN', 'ISSUED'].includes(p.status)), [data.payments.data]);
  const pendingExits = (data.exits.data ?? []).filter((e) => e.status === 'REQUESTED');
  const [exitReason, setExitReason] = useState('');
  const exitDecision = usePayablesMutation('validate-exit', (key, input: { id: string; version: number; approve: boolean }) =>
    validateExit(key, input.id, input.version, input.approve, exitReason), 'Décision enregistrée.');

  const [orphan, setOrphan] = useState({ accountId: '', number: '', amount: '', issueDate: today(), reasonCode: 'OTHER_OUTSIDE_CIRCUIT',
    evidence: '', reason: '' });
  const orphanMutation = usePayablesMutation('declare-orphan', (key, _: void) => declareIssuanceException(key, {
    accountId: orphan.accountId, chequeNumber: orphan.number,
    amount: /^[1-9][0-9]*$/.test(orphan.amount) ? Number(orphan.amount) : null, issueDate: orphan.issueDate, paymentId: null,
    reasonCode: orphan.reasonCode, evidenceRef: orphan.evidence, reason: orphan.reason,
  }), 'Émission déclarée en exception.');

  if (data.payments.error) return <p className="text-sm text-destructive">{(data.payments.error as Error).message}</p>;
  return (
    <div className="space-y-4">
      {!access.business_writes_enabled && (
        <Alert><AlertDescription>Le serveur est fermé en écriture : consultation seule.</AlertDescription></Alert>
      )}
      {cheques.map((payment) => <ChequeRow key={payment.id} payment={payment} access={access} data={data} />)}
      {cheques.length === 0 && <p className="text-sm text-muted-foreground">Aucun paiement par chèque en cours.</p>}

      <ChequeRegister access={access} data={data} accounts={accounts.data ?? []} />

      {hasCapability(access, 'EXIT_VALIDATE') && pendingExits.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Sorties hors banque à valider</CardTitle>
            <CardDescription>Jamais par le demandeur ; une annulation libère l’engagement, un remplacement le transfère.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <Input aria-label="Motif de décision" value={exitReason} onChange={(e) => setExitReason(e.target.value)} />
            {pendingExits.map((exit) => (
              <div key={exit.id} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{exit.kind}</Badge> {exit.reason}
                <Button size="sm" onClick={() => exitDecision.mutate({ id: exit.id, version: exit.row_version, approve: true })}
                  disabled={exitReason.trim().length < 5}>Valider</Button>
                <Button size="sm" variant="outline" onClick={() => exitDecision.mutate({ id: exit.id, version: exit.row_version, approve: false })}
                  disabled={exitReason.trim().length < 5}>Refuser</Button>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {hasCapability(access, 'CHEQUE_CONFIRM_ISSUE') && (
        <Card>
          <CardHeader><CardTitle>Chèque émis absent du registre</CardTitle>
            <CardDescription>Enregistrer le fait réel ; montant inconnu admis (indisponible, jamais zéro) ; compte bloqué jusqu’à instruction.</CardDescription>
          </CardHeader>
          <CardContent>
            <form className="grid gap-2 sm:grid-cols-3" onSubmit={(e) => { e.preventDefault(); orphanMutation.mutate(); }}>
              <select aria-label="Compte" className={nativeSelectClass} value={orphan.accountId}
                onChange={(e) => setOrphan({ ...orphan, accountId: e.target.value })}>
                <option value="">Compte…</option>
                {(accounts.data ?? []).filter((a) => a.currency === 'XOF').map((a) => (
                  <option key={a.account_id} value={a.account_id}>{a.bank} — {a.account_alias}</option>
                ))}
              </select>
              <Input aria-label="Numéro du chèque" placeholder="Numéro" value={orphan.number} onChange={(e) => setOrphan({ ...orphan, number: e.target.value })} />
              <Input aria-label="Montant connu" placeholder="Montant (vide si inconnu)" value={orphan.amount}
                onChange={(e) => setOrphan({ ...orphan, amount: e.target.value })} />
              <Input aria-label="Date réelle d’émission" type="date" value={orphan.issueDate} onChange={(e) => setOrphan({ ...orphan, issueDate: e.target.value })} />
              <select aria-label="Motif d’exception" className={nativeSelectClass} value={orphan.reasonCode}
                onChange={(e) => setOrphan({ ...orphan, reasonCode: e.target.value })}>
                {ISSUANCE_EXCEPTION_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
              <Input aria-label="Justificatif" placeholder="Justificatif" value={orphan.evidence} onChange={(e) => setOrphan({ ...orphan, evidence: e.target.value })} />
              <Input aria-label="Motif" placeholder="Motif" value={orphan.reason} onChange={(e) => setOrphan({ ...orphan, reason: e.target.value })} />
              <Button type="submit" variant="destructive" disabled={orphanMutation.isPending}>Déclarer</Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
