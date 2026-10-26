import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  decideCapability,
  decideParameter,
  decidePerson,
  decidePersonLink,
  listCapabilityGrants,
  listParameters,
  listPersonLinks,
  listPersons,
  proposeCapability,
  proposeParameter,
  proposePerson,
  proposePersonLink,
} from './payablesChequesService';
import { PAYABLES_CAPABILITIES, type PayablesAccess } from './payablesChequesTypes';
import { Field, hasCapability, nativeSelectClass, PAYABLES_QUERY_ROOT, shortId, today, usePayablesMutation } from './payablesUi';

const PAYLOAD_TEMPLATES: Record<string, string> = {
  CATEGORY: JSON.stringify({ code: 'ALL_PAYMENTS', label: 'Tous règlements', state: 'ACTIVE' }, null, 2),
  SIGNATURE_RULE: JSON.stringify({ account_registry_id: '<compte>', required_signatures: 1 }, null, 2),
  SIGNATORY: JSON.stringify({ person_id: '<personne>', account_registry_id: '<compte>', state: 'ACTIVE', categories: ['*'],
    ceiling: { kind: 'AMOUNT', amount: 0 } }, null, 2),
  PRINT_PROFILE: JSON.stringify({
    profile_code: 'ORA_CHQ_170X95', bank: 'ORA', state: 'ACTIVE', page: { width_mm: 170, height_mm: 95 },
    font: { family: 'Courier New', size_pt: 10 }, offset: { x_mm: 0, y_mm: 0 },
    fields: {
      beneficiary: { x_mm: 0, y_mm: 0, max_chars: 48 }, amount_figures: { x_mm: 0, y_mm: 0, max_chars: 18 },
      amount_words: { x_mm: 0, y_mm: 0, max_chars: 60, lines: 2, line_gap_mm: 6 },
      issue_date: { x_mm: 0, y_mm: 0, max_chars: 10 }, place: { x_mm: 0, y_mm: 0, max_chars: 20 },
    },
    place_label: 'Dakar', amount_words_suffix: 'francs CFA', amount_words_case: 'UPPER', printer_model: '<modèle>',
    signable_fields: ['account', 'cheque_number', 'currency', 'beneficiary', 'amount_figures', 'amount_words', 'issue_date', 'place'],
  }, null, 2),
};

export function ParametersPanel({ access }: { access: PayablesAccess }) {
  const persons = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'persons'], queryFn: listPersons });
  const links = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'person-links'], queryFn: listPersonLinks });
  const grants = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'grants'], queryFn: listCapabilityGrants });
  const parameters = useQuery({ queryKey: [PAYABLES_QUERY_ROOT, 'parameters'], queryFn: listParameters });
  const canPropose = hasCapability(access, 'PARAM_PROPOSE');
  const canValidate = hasCapability(access, 'PARAM_VALIDATE');

  const [personName, setPersonName] = useState('');
  const [link, setLink] = useState({ personId: '', userId: '' });
  const [grant, setGrant] = useState({ userId: '', capability: 'READ', action: 'GRANT' as 'GRANT' | 'REVOKE' });
  const [param, setParam] = useState({ kind: 'CATEGORY', subjectKey: 'ALL_PAYMENTS', validFrom: today(),
    payload: PAYLOAD_TEMPLATES.CATEGORY, evidenceRef: '' });
  const [reason, setReason] = useState('');
  const payloadValid = (() => { try { return typeof JSON.parse(param.payload) === 'object'; } catch { return false; } })();

  const personMutation = usePayablesMutation('propose-person', (key, _: void) => proposePerson(key, personName, reason), 'Personne proposée.');
  const linkMutation = usePayablesMutation('propose-link', (key, _: void) => proposePersonLink(key, link.personId, link.userId, 'LINK', reason),
    'Rattachement proposé.');
  const grantMutation = usePayablesMutation('propose-grant', (key, _: void) => proposeCapability(key, grant.userId, grant.capability,
    grant.action, reason), 'Habilitation proposée.');
  const paramMutation = usePayablesMutation('propose-param', (key, _: void) => proposeParameter(key, {
    kind: param.kind, subjectKey: param.subjectKey, validFrom: param.validFrom, payload: JSON.parse(param.payload),
    evidenceRef: param.evidenceRef || null, reason,
  }), 'Version de paramètre proposée.');
  const decision = usePayablesMutation('decide-governance', (key, input: { type: string; id: string; approve: boolean }) => {
    if (input.type === 'person') return decidePerson(key, input.id, input.approve, reason);
    if (input.type === 'link') return decidePersonLink(key, input.id, input.approve, reason);
    if (input.type === 'grant') return decideCapability(key, input.id, input.approve, reason);
    return decideParameter(key, input.id, input.approve, reason);
  }, 'Décision enregistrée.');

  const pending: { type: string; id: string; by: string; label: string; content?: string }[] = [
    ...(persons.data ?? []).filter((p) => p.status === 'PROPOSED').map((p) => ({ type: 'person', id: p.id, by: p.proposed_by,
      label: `Personne : ${p.display_name}` })),
    ...(links.data ?? []).filter((l) => l.status === 'PROPOSED').map((l) => ({ type: 'link', id: l.id, by: l.proposed_by,
      label: `Rattachement ${l.action} : personne ${shortId(l.person_id)} ↔ compte ${shortId(l.user_id)}` })),
    ...(grants.data ?? []).filter((g) => g.status === 'PROPOSED').map((g) => ({ type: 'grant', id: g.id, by: g.proposed_by,
      label: `Habilitation ${g.action} ${g.capability} → ${shortId(g.user_id)}` })),
    ...(parameters.data ?? []).filter((v) => v.status === 'PROPOSED').map((v) => ({ type: 'param', id: v.id, by: v.proposed_by,
      label: `${v.kind} ${v.subject_key} v${v.version_no} à partir du ${v.valid_from}`,
      // Le valideur voit le contenu exact proposé : jamais de validation à l'aveugle.
      content: JSON.stringify(v.payload, null, 2) })),
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Gouvernance et paramètres versionnés</CardTitle>
          <CardDescription>
            Toute modification est proposée par un habilité et validée par un autre ; aucune auto-attribution ; aucune
            version modifiée en place. L’administration technique ne donne aucun droit métier.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Field label="Motif commun aux propositions et décisions" htmlFor="gov-reason">
            <Input id="gov-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {canPropose && (
            <div className="grid gap-4 lg:grid-cols-2">
              <div className="space-y-2">
                <Field label="Nouvelle personne" htmlFor="gov-person">
                  <Input id="gov-person" value={personName} onChange={(e) => setPersonName(e.target.value)} />
                </Field>
                <Button size="sm" onClick={() => personMutation.mutate()} disabled={personName.trim().length < 2 || reason.trim().length < 5}>
                  Proposer la personne
                </Button>
              </div>
              <div className="space-y-2">
                <Field label="Rattacher une personne à un compte utilisateur" htmlFor="gov-link-person">
                  <select id="gov-link-person" className={nativeSelectClass} value={link.personId}
                    onChange={(e) => setLink({ ...link, personId: e.target.value })}>
                    <option value="">Personne…</option>
                    {(persons.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                  </select>
                </Field>
                <Input aria-label="Identifiant du compte utilisateur" placeholder="Identifiant du compte utilisateur" value={link.userId}
                  onChange={(e) => setLink({ ...link, userId: e.target.value.trim() })} />
                <Button size="sm" onClick={() => linkMutation.mutate()} disabled={!link.personId || !link.userId || reason.trim().length < 5}>
                  Proposer le rattachement
                </Button>
              </div>
              <div className="space-y-2">
                <Field label="Habilitation" htmlFor="gov-grant-user">
                  <Input id="gov-grant-user" placeholder="Identifiant du compte utilisateur" value={grant.userId}
                    onChange={(e) => setGrant({ ...grant, userId: e.target.value.trim() })} />
                </Field>
                <div className="flex gap-2">
                  <select aria-label="Capacité" className={nativeSelectClass} value={grant.capability}
                    onChange={(e) => setGrant({ ...grant, capability: e.target.value })}>
                    {PAYABLES_CAPABILITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select aria-label="Action" className={nativeSelectClass} value={grant.action}
                    onChange={(e) => setGrant({ ...grant, action: e.target.value as 'GRANT' | 'REVOKE' })}>
                    <option value="GRANT">Attribuer</option>
                    <option value="REVOKE">Retirer</option>
                  </select>
                </div>
                <Button size="sm" onClick={() => grantMutation.mutate()} disabled={!grant.userId || reason.trim().length < 5}>
                  Proposer
                </Button>
              </div>
              <div className="space-y-2">
                <div className="grid grid-cols-3 gap-2">
                  <select aria-label="Type de paramètre" className={nativeSelectClass} value={param.kind}
                    onChange={(e) => setParam({ ...param, kind: e.target.value, payload: PAYLOAD_TEMPLATES[e.target.value] })}>
                    {Object.keys(PAYLOAD_TEMPLATES).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                  <Input aria-label="Clé du paramètre" value={param.subjectKey} onChange={(e) => setParam({ ...param, subjectKey: e.target.value })} />
                  <Input aria-label="Date d’effet" type="date" value={param.validFrom} onChange={(e) => setParam({ ...param, validFrom: e.target.value })} />
                </div>
                <Textarea aria-label="Contenu (JSON)" rows={8} className="font-mono text-xs" value={param.payload}
                  onChange={(e) => setParam({ ...param, payload: e.target.value })} />
                <Input aria-label="Pièce justificative" placeholder="Pièce justificative (pouvoirs, essai papier…)" value={param.evidenceRef}
                  onChange={(e) => setParam({ ...param, evidenceRef: e.target.value })} />
                <Button size="sm" onClick={() => paramMutation.mutate()} disabled={!payloadValid || reason.trim().length < 5}>
                  Proposer la version
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Propositions en attente</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {pending.length === 0 && <p className="text-sm text-muted-foreground">Aucune proposition en attente.</p>}
          {pending.map((item) => (
            <div key={`${item.type}:${item.id}`} className="flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="outline">{item.type}</Badge> {item.label}
              {canValidate && item.by !== access.user_id && (
                <>
                  <Button size="sm" disabled={reason.trim().length < 5} onClick={() => decision.mutate({ type: item.type, id: item.id, approve: true })}>
                    Valider
                  </Button>
                  <Button size="sm" variant="outline" disabled={reason.trim().length < 5}
                    onClick={() => decision.mutate({ type: item.type, id: item.id, approve: false })}>Refuser</Button>
                </>
              )}
              {item.content && (
                <pre aria-label="Contenu proposé" className="w-full overflow-x-auto rounded bg-muted p-2 font-mono text-xs">
                  {item.content}
                </pre>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
