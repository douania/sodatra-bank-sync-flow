import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  adminCreatePerson,
  adminRejectLegacyProposal,
  adminSetCapability,
  adminSetParameter,
  adminSetPersonLink,
  listCapabilityGrants,
  listParameters,
  listPersonLinks,
  listPersons,
} from './payablesChequesService';
import { PAYABLES_ASSIGNABLE_CAPABILITIES, type PayablesAccess } from './payablesChequesTypes';
import {
  adminState,
  currentLinks,
  effectiveGrants,
  expectedParameterVersion,
  legacyPendingProposals,
  type LegacyProposal,
} from './payablesAdminModel';
import { Field, nativeSelectClass, PAYABLES_QUERY_ROOT, shortId, today, usePayablesMutation } from './payablesUi';

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
  // Autorité reconnue par le serveur seul ; indépendante de l'interrupteur métier.
  const state = adminState(access);
  const isAdmin = state === 'ADMIN';

  const [personName, setPersonName] = useState('');
  const [link, setLink] = useState({ personId: '', userId: '' });
  const [grant, setGrant] = useState({ userId: '', capability: 'READ' });
  const [param, setParam] = useState({ kind: 'CATEGORY', subjectKey: 'ALL_PAYMENTS', validFrom: today(),
    payload: PAYLOAD_TEMPLATES.CATEGORY, evidenceRef: '' });
  const [reason, setReason] = useState('');
  const payloadValid = (() => { try { return typeof JSON.parse(param.payload) === 'object'; } catch { return false; } })();
  const expectedVersion = expectedParameterVersion(parameters.data ?? [], param.kind, param.subjectKey);
  const reasonValid = reason.trim().length >= 5;

  const personMutation = usePayablesMutation('admin-person', (key, _: void) => adminCreatePerson(key, personName, reason),
    'Personne créée.');
  const linkMutation = usePayablesMutation('admin-link', (key, input: { link: boolean }) =>
    adminSetPersonLink(key, link.personId, link.userId, input.link, reason), 'Rattachement enregistré.');
  const grantMutation = usePayablesMutation('admin-grant', (key, input: { grant: boolean }) =>
    adminSetCapability(key, grant.userId, grant.capability, input.grant, reason), 'Habilitation enregistrée.');
  const paramMutation = usePayablesMutation('admin-param', (key, _: void) => adminSetParameter(key, {
    kind: param.kind, subjectKey: param.subjectKey, validFrom: param.validFrom, payload: JSON.parse(param.payload),
    evidenceRef: param.evidenceRef || null, expectedVersionNo: expectedVersion, reason,
  }), 'Version de paramètre enregistrée.');
  const closeMutation = usePayablesMutation('admin-close-legacy', (key, item: LegacyProposal) =>
    adminRejectLegacyProposal(key, item.kind, item.id, reason), 'Proposition héritée close.');

  const rights = effectiveGrants(grants.data ?? []);
  const linkedPerson = currentLinks(links.data ?? []);
  const personName_ = (id: string) => (persons.data ?? []).find((p) => p.id === id)?.display_name ?? shortId(id);
  const legacy = legacyPendingProposals({
    persons: persons.data ?? [], links: links.data ?? [], grants: grants.data ?? [], parameters: parameters.data ?? [],
  });

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle>Administration du module</CardTitle>
          <CardDescription>
            L’administrateur du module, désigné par l’opérateur, attribue et retire les habilitations, gère les personnes,
            leurs rattachements et les paramètres versionnés. Chaque décision est tracée ; les versions décidées restent
            immuables. Les écritures métier restent soumises à l’interrupteur serveur et aux contrôles financiers.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {state === 'NOT_CONFIGURED' && (
            <Alert><AlertDescription>Aucun administrateur n’est désigné : l’administration du module est fermée.</AlertDescription></Alert>
          )}
          {state === 'NOT_ADMIN' && (
            <Alert><AlertDescription>Consultation seule : l’administration est réservée à l’administrateur du module.</AlertDescription></Alert>
          )}
          {isAdmin && !access.business_writes_enabled && (
            <Alert>
              <AlertDescription>
                Écritures métier fermées : l’administration reste possible, aucune opération financière ne l’est.
              </AlertDescription>
            </Alert>
          )}
          {isAdmin && (
            <>
              <Field label="Motif de la décision (tracé au journal)" htmlFor="admin-reason">
                <Input id="admin-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
              </Field>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-2">
                  <Field label="Nouvelle personne" htmlFor="admin-person">
                    <Input id="admin-person" value={personName} onChange={(e) => setPersonName(e.target.value)} />
                  </Field>
                  <Button size="sm" onClick={() => personMutation.mutate()} disabled={personName.trim().length < 2 || !reasonValid}>
                    Créer la personne
                  </Button>
                </div>
                <div className="space-y-2">
                  <Field label="Rattachement d’une personne à un compte utilisateur" htmlFor="admin-link-person">
                    <select id="admin-link-person" className={nativeSelectClass} value={link.personId}
                      onChange={(e) => setLink({ ...link, personId: e.target.value })}>
                      <option value="">Personne…</option>
                      {(persons.data ?? []).filter((p) => p.status === 'ACTIVE').map((p) => <option key={p.id} value={p.id}>{p.display_name}</option>)}
                    </select>
                  </Field>
                  <Input aria-label="Identifiant du compte utilisateur" placeholder="Identifiant du compte utilisateur" value={link.userId}
                    onChange={(e) => setLink({ ...link, userId: e.target.value.trim() })} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => linkMutation.mutate({ link: true })} disabled={!link.personId || !link.userId || !reasonValid}>
                      Rattacher
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => linkMutation.mutate({ link: false })}
                      disabled={!link.personId || !link.userId || !reasonValid}>
                      Détacher
                    </Button>
                  </div>
                </div>
                <div className="space-y-2">
                  <Field label="Habilitation" htmlFor="admin-grant-user">
                    <Input id="admin-grant-user" placeholder="Identifiant du compte utilisateur" value={grant.userId}
                      onChange={(e) => setGrant({ ...grant, userId: e.target.value.trim() })} />
                  </Field>
                  <select aria-label="Capacité" className={nativeSelectClass} value={grant.capability}
                    onChange={(e) => setGrant({ ...grant, capability: e.target.value })}>
                    {PAYABLES_ASSIGNABLE_CAPABILITIES.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => grantMutation.mutate({ grant: true })} disabled={!grant.userId || !reasonValid}>
                      Attribuer
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => grantMutation.mutate({ grant: false })}
                      disabled={!grant.userId || !reasonValid}>
                      Retirer
                    </Button>
                  </div>
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
                  <p className="text-xs text-muted-foreground">
                    Nouvelle version sur la version {expectedVersion} connue : une version enregistrée entre-temps est refusée,
                    jamais écrasée.
                  </p>
                  <Button size="sm" onClick={() => paramMutation.mutate()} disabled={!payloadValid || !reasonValid}>
                    Enregistrer la version
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Habilitations et rattachements en vigueur</CardTitle></CardHeader>
        <CardContent className="space-y-2 text-sm">
          {rights.size === 0 && <p className="text-muted-foreground">Aucune habilitation attribuée.</p>}
          {[...rights.entries()].map(([userId, caps]) => (
            <div key={userId} className="flex flex-wrap items-center gap-2">
              <span className="font-mono">{shortId(userId)}</span>
              {linkedPerson.has(userId) && <span>({personName_(linkedPerson.get(userId) as string)})</span>}
              {caps.map((c) => <Badge key={c} variant="outline">{c}</Badge>)}
            </div>
          ))}
        </CardContent>
      </Card>
      {legacy.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Propositions héritées en attente</CardTitle>
            <CardDescription>
              Issues de l’ancienne gouvernance, sans effet : elles ne sont plus validables et peuvent seulement être closes
              par l’administrateur.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {legacy.map((item) => (
              <div key={`${item.kind}:${item.id}`} className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="outline">{item.kind}</Badge> {item.label}
                {isAdmin && item.proposedBy !== access.user_id && (
                  <Button size="sm" variant="outline" disabled={!reasonValid} onClick={() => closeMutation.mutate(item)}>
                    Clore
                  </Button>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
