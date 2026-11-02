import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  addRegistryAccountToInventory,
  addUnregisteredAccountToInventory,
  attestInventory,
  inventoryCommandKeys,
  linkExpectedAccount,
  retireExpectedAccount,
} from './treasuryService';
import { TreasuryError, type TreasuryBalances } from './treasuryModel';

// Administration de l'inventaire des comptes attendus. Le serveur réserve ces
// décisions à l'administrateur unique (autorité existante) ; l'interface ne
// fait qu'exposer les commandes. Aucune habilitation n'est attribuée ici.

const BANKS = ['BDK', 'ORA', 'ATB', 'BICIS', 'BIS', 'BRIDGE', 'NSIA'] as const;

export function TreasuryInventoryAdmin({ result, onChanged }: { result: TreasuryBalances; onChanged: () => void }) {
  const [reason, setReason] = useState('');
  const [registryId, setRegistryId] = useState('');
  const [bank, setBank] = useState<string>('NSIA');
  const [currency, setCurrency] = useState('XOF');
  const [alias, setAlias] = useState('');
  const [linkExpectedId, setLinkExpectedId] = useState('');
  const [linkRegistryId, setLinkRegistryId] = useState('');
  const [retireId, setRetireId] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const unregistered = result.accounts.filter((account) => account.registry_account_id === null);
  const unlisted = result.inventory.unlisted_registry_accounts;

  async function run(signature: unknown[], action: (commandKey: string) => Promise<unknown>, done: string) {
    const commandKey = inventoryCommandKeys.keyFor(JSON.stringify(signature));
    setBusy(true);
    setMessage(null);
    try {
      await action(commandKey);
      inventoryCommandKeys.succeeded(commandKey);
      setMessage(done);
      onChanged();
    } catch (error) {
      setMessage(error instanceof TreasuryError ? error.message : 'La décision a été refusée.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-3 rounded-lg border bg-card p-4" aria-label="Inventaire des comptes attendus">
      <div>
        <h2 className="font-semibold">Inventaire des comptes attendus</h2>
        <p className="text-xs text-muted-foreground">
          Réservé à l’administrateur unique. Chaque décision est motivée, journalisée et rejouable sans doublon.
          Empreinte actuelle : <span className="font-mono">{result.inventory.fingerprint.slice(0, 16)}…</span>
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
          <div className="text-sm font-medium">Ajouter un compte du registre</div>
          <select aria-label="Compte du registre hors inventaire" className="w-full rounded border px-2 py-1 text-sm"
            value={registryId} onChange={(event) => setRegistryId(event.target.value)}>
            <option value="">Choisir…</option>
            {unlisted.map((account) => (
              <option key={account.registry_account_id} value={account.registry_account_id}>
                {account.bank} · {account.alias} · {account.currency}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={busy || registryId === ''}
            onClick={() => run(['add-registry', registryId, reason],
              (key) => addRegistryAccountToInventory(key, registryId, reason), 'Compte ajouté à l’inventaire.')}>
            Ajouter
          </Button>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Ajouter un compte attendu sans relevé (ex. NSIA)</div>
          <div className="flex gap-2">
            <select aria-label="Banque" className="rounded border px-2 py-1 text-sm" value={bank} onChange={(event) => setBank(event.target.value)}>
              {BANKS.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
            <Input aria-label="Devise" className="w-20" value={currency} onChange={(event) => setCurrency(event.target.value)} />
            <Input aria-label="Alias" placeholder="Alias sans numéro de compte" value={alias} onChange={(event) => setAlias(event.target.value)} />
          </div>
          <Button size="sm" disabled={busy || alias.trim() === ''}
            onClick={() => run(['add-unregistered', bank, currency, alias, reason],
              (key) => addUnregisteredAccountToInventory(key, { bank, currency, alias, reason }), 'Compte attendu ajouté.')}>
            Ajouter
          </Button>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Rattacher un compte attendu à son compte du registre</div>
          <select aria-label="Compte attendu à rattacher" className="w-full rounded border px-2 py-1 text-sm"
            value={linkExpectedId} onChange={(event) => setLinkExpectedId(event.target.value)}>
            <option value="">Compte attendu…</option>
            {unregistered.map((account) => (
              <option key={account.expected_account_id} value={account.expected_account_id}>{account.bank} · {account.alias}</option>
            ))}
          </select>
          <select aria-label="Compte du registre cible" className="w-full rounded border px-2 py-1 text-sm"
            value={linkRegistryId} onChange={(event) => setLinkRegistryId(event.target.value)}>
            <option value="">Compte du registre…</option>
            {unlisted.map((account) => (
              <option key={account.registry_account_id} value={account.registry_account_id}>{account.bank} · {account.alias}</option>
            ))}
          </select>
          <Button size="sm" disabled={busy || linkExpectedId === '' || linkRegistryId === ''}
            onClick={() => run(['link', linkExpectedId, linkRegistryId, reason],
              (key) => linkExpectedAccount(key, linkExpectedId, linkRegistryId, reason), 'Compte rattaché.')}>
            Rattacher
          </Button>
        </div>
        <div className="space-y-2">
          <div className="text-sm font-medium">Retirer un compte attendu</div>
          <select aria-label="Compte attendu à retirer" className="w-full rounded border px-2 py-1 text-sm"
            value={retireId} onChange={(event) => setRetireId(event.target.value)}>
            <option value="">Compte attendu…</option>
            {result.accounts.map((account) => (
              <option key={account.expected_account_id} value={account.expected_account_id}>{account.bank} · {account.alias ?? '—'}</option>
            ))}
          </select>
          <Button size="sm" variant="outline" disabled={busy || retireId === ''}
            onClick={() => run(['retire', retireId, reason],
              (key) => retireExpectedAccount(key, retireId, reason), 'Compte retiré de l’inventaire.')}>
            Retirer
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <Button size="sm" disabled={busy || result.inventory.active_accounts === 0}
          onClick={() => run(['attest', result.inventory.fingerprint, reason],
            (key) => attestInventory(key, result.inventory.fingerprint, reason), 'Inventaire attesté.')}>
          Attester l’inventaire affiché comme complet
        </Button>
        <span className="text-xs text-muted-foreground">
          {result.inventory.attested ? 'Inventaire attesté dans son état actuel.' : 'Inventaire non attesté dans son état actuel.'}
        </span>
      </div>
      {message && <p role="status" className="text-sm">{message}</p>}
    </section>
  );
}
