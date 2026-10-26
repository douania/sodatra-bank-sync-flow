import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  assignChequeForm,
  confirmIssuance,
  declareIssuanceException,
  listContents,
  listExits,
  listForms,
  listParameters,
  listPayments,
  listPersons,
  listPrintEvents,
  listSignatures,
  readAccountPositions,
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
import type { ChequeContentFields } from './chequeLayout';
import {
  ISSUANCE_EXCEPTION_REASONS,
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
  return { payments, forms, contents, printEvents, signatures, persons, parameters, exits };
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
  const [exitForm, setExitForm] = useState({ kind: 'CANCELLATION', beneficiary: '', amount: '', issueDate: '', evidence: '' });
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
  const deliveryMutation = usePayablesMutation('delivery', (key, _: void) => recordDelivery(key, form!.id, issue.date, null),
    'Remise enregistrée.');
  const exitMutation = usePayablesMutation('request-exit', (key, _: void) => requestExit(key, form!.id, form!.row_version, exitForm.kind,
    exitForm.kind === 'REPLACEMENT'
      ? { ...(exitForm.beneficiary ? { beneficiary: exitForm.beneficiary } : {}), ...(exitForm.amount ? { amount: Number(exitForm.amount) } : {}) }
      : exitForm.kind === 'CORRECTION' ? { issue_date: exitForm.issueDate } : {},
    exitForm.evidence, reason), 'Demande transmise pour validation par un autre comptable.');

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

        {form?.state === 'ISSUED' && (
          <div className="space-y-3">
            {canConfirm && (
              <div className="flex gap-2">
                <Input aria-label="Date de remise" type="date" value={issue.date} onChange={(e) => setIssue({ ...issue, date: e.target.value })} />
                <Button variant="outline" onClick={() => deliveryMutation.mutate()}>Remise au bénéficiaire</Button>
              </div>
            )}
            {hasCapability(access, 'EXIT_REQUEST') && (
              <div className="grid gap-2 sm:grid-cols-5">
                <select aria-label="Type de sortie" className={nativeSelectClass} value={exitForm.kind}
                  onChange={(e) => setExitForm({ ...exitForm, kind: e.target.value })}>
                  <option value="CANCELLATION">Annulation</option>
                  <option value="REPLACEMENT">Remplacement</option>
                  <option value="CORRECTION">Correction de la date d’émission</option>
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
        )}
      </CardContent>
    </Card>
  );
}

export function ChequesPanel({ access }: { access: PayablesAccess }) {
  const data = useChequeData();
  const accounts = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'positions', today()], queryFn: () => readAccountPositions(today()) });
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
