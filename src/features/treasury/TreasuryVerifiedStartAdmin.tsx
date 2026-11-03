import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { revokeVerifiedStart, setVerifiedStart, verifiedStartCommandKeys } from './treasuryService';
import {
  isWholeXofText,
  retainedUnitAtDate,
  TreasuryError,
  verifiedStartLabel,
  type RetainedDayUnit,
  type TreasuryAccount,
  type TreasuryBalances,
} from './treasuryModel';

// Points de départ vérifiés (C5). Réservé à l'administrateur unique côté
// serveur. Le point se pose sur la journée D lue : l'unité retenue et son
// empreinte affichées par la lecture sont transmises telles quelles, puis
// revérifiées sous verrou. L'ouverture lue sur la pièce est saisie en francs
// XOF entiers ; l'ouverture retenue n'est ni affichée ni préremplie : le
// serveur seul la compare et refuse toute différence.

export function TreasuryVerifiedStartAdmin({ result, onChanged }: { result: TreasuryBalances; onChanged: () => void }) {
  const [expectedId, setExpectedId] = useState('');
  const [opening, setOpening] = useState('');
  const [evidence, setEvidence] = useState('');
  const [reason, setReason] = useState('');
  const [revokeId, setRevokeId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const candidates = result.accounts
    .filter((account) => account.registry_account_id !== null && account.currency === 'XOF')
    .map((account) => ({ account, unit: retainedUnitAtDate(account) }))
    .filter((entry): entry is { account: TreasuryAccount; unit: RetainedDayUnit } => entry.unit !== null);
  const selected = candidates.find((entry) => entry.account.expected_account_id === expectedId) ?? null;
  const activePoints = result.accounts.flatMap((account) => account.verified_starts
    .filter((point) => point.state === 'ACTIVE')
    .map((point) => ({ account, point })));

  async function run(signature: unknown[], action: (commandKey: string) => Promise<unknown>, done: string) {
    const commandKey = verifiedStartCommandKeys.keyFor(JSON.stringify(signature));
    setBusy(true);
    setMessage(null);
    try {
      await action(commandKey);
      verifiedStartCommandKeys.succeeded(commandKey);
      setMessage(done);
      onChanged();
    } catch (error) {
      setMessage(error instanceof TreasuryError ? error.message : 'La décision a été refusée.');
    } finally {
      setBusy(false);
    }
  }

  function pose() {
    if (selected === null || selected.account.registry_account_id === null) return;
    const registryAccountId = selected.account.registry_account_id;
    const { unit } = selected;
    const verifiedOpening = opening.trim();
    // La signature inclut l'unité et l'empreinte affichées : une journée modifiée
    // entre-temps donne une nouvelle décision, jamais le rejeu d'une autre.
    void run(['set-verified-start', registryAccountId, result.as_of, unit.canonicalUnitId, unit.contentHash, verifiedOpening,
      evidence, reason],
    (key) => setVerifiedStart(key, {
      registryAccountId, day: result.as_of, unit, verifiedOpening, evidenceRef: evidence, reason,
    }),
    'Point de départ posé.');
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Points de départ vérifiés">
      <div>
        <h2 className="font-semibold">Points de départ vérifiés</h2>
        <p className="text-xs text-muted-foreground">
          Réservé à l’administrateur unique. Un point se pose sur la date D lue ({result.as_of}), ne vaut qu’à partir de
          cette journée et ne couvre pas les lacunes antérieures ; il est suspendu dès qu’une contradiction est datée au
          plus tard à l’horizon de la date lue.
        </p>
      </div>
      <Textarea
        aria-label="Motif de la décision"
        placeholder="Motif de la décision (5 caractères au moins)"
        value={reason}
        onChange={(event) => setReason(event.target.value)}
      />
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <div className="text-sm font-medium">Poser un point de départ au {result.as_of}</div>
          <select aria-label="Compte" className="w-full rounded border px-2 py-1 text-sm"
            value={expectedId} onChange={(event) => setExpectedId(event.target.value)}>
            <option value="">Compte dont la journée {result.as_of} est retenue…</option>
            {candidates.map(({ account }) => (
              <option key={account.expected_account_id} value={account.expected_account_id}>
                {account.bank} · {account.alias ?? '—'}
              </option>
            ))}
          </select>
          {selected && (
            <div className="text-xs text-muted-foreground" data-retained-unit={selected.unit.canonicalUnitId}>
              Journée retenue : unité {selected.unit.canonicalUnitId.slice(0, 8)}, empreinte{' '}
              <span className="font-mono">{selected.unit.contentHash.slice(0, 12)}…</span>
            </div>
          )}
          <Input aria-label="Ouverture lue sur la pièce (francs XOF entiers)" inputMode="numeric" autoComplete="off"
            placeholder="Ouverture lue sur la pièce, francs XOF entiers" value={opening}
            onChange={(event) => setOpening(event.target.value)} />
          <Input aria-label="Référence de la pièce" placeholder="Référence de la pièce archivée" value={evidence}
            onChange={(event) => setEvidence(event.target.value)} />
          <Button size="sm"
            disabled={busy || selected === null || !isWholeXofText(opening) || evidence.trim() === ''}
            onClick={pose}>
            Poser le point
          </Button>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Révoquer un point de départ</div>
          <select aria-label="Point à révoquer" className="w-full rounded border px-2 py-1 text-sm"
            value={revokeId} onChange={(event) => setRevokeId(event.target.value)}>
            <option value="">Point actif…</option>
            {activePoints.map(({ account, point }) => (
              <option key={point.verified_start_id} value={point.verified_start_id}>
                {account.bank} · {account.alias ?? '—'} · {point.day}
              </option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={busy || revokeId === ''}
            onClick={() => run(['revoke-verified-start', revokeId, reason],
              (key) => revokeVerifiedStart(key, revokeId, reason), 'Point de départ révoqué.')}>
            Révoquer
          </Button>
          <ul className="list-disc pl-4 text-xs text-muted-foreground">
            {activePoints.map(({ account, point }) => (
              <li key={point.verified_start_id}>{account.bank} · {verifiedStartLabel(point)}</li>
            ))}
          </ul>
        </div>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}
