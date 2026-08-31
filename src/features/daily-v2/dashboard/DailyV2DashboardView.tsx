import React from 'react';
import { formatDailyV2MinorUnits } from '../dailyV2Money';
import type { DashboardState } from './dailyV2DashboardController';

export function DailyV2DashboardAccessGate({ status, reason, renderAuthorized }: {
  status: 'checking' | 'allowed' | 'blocked';
  reason?: 'session' | 'target' | 'lookup' | 'role';
  renderAuthorized: () => React.ReactNode;
}) {
  if (status === 'checking') return <p role="status">Vérification de {reason === 'session' ? 'la session' : 'l’accès Daily v2'}… Les anciens résultats sont masqués.</p>;
  const detail = reason === 'session' ? 'Connexion requise.' : reason === 'target' ? 'Cible Daily v2 non autorisée.'
    : reason === 'lookup' ? 'Vérification des droits impossible. Réessayez après rétablissement de l’accès.'
      : 'Un rôle admin ou auditor vérifié est requis.';
  if (status !== 'allowed') return <p role="alert">Vue Daily v2 indisponible : {detail} Aucun ancien résultat ni indicateur historique ne remplace cette vue. Les sources historiques restent consultables séparément par le bouton « Sources historiques — vue séparée ».</p>;
  return <>{renderAuthorized()}</>;
}

function amount(value: bigint | null, currency: string) {
  return value === null ? 'Indisponible' : formatDailyV2MinorUnits(value, currency);
}
const cell = 'p-3 text-left align-top border-b';

export function DailyV2DashboardView({ state }: { state: DashboardState }) {
  if (state.status === 'loading') return <p role="status" className="p-4">Lecture des journées validées…</p>;
  if (state.status === 'idle') return <p role="status" className="p-4">Paramètres modifiés : actualisez la vue pour afficher un résultat correspondant.</p>;
  if (state.status === 'error') {
    const messages = {
      filters: 'Paramètres invalides : dates calendaires requises, période de flux ordonnée de 1 à 400 jours ; banque et devise limitées aux lettres A–Z et chiffres, 12 caractères maximum.',
      volume: 'Plus de 5 000 journées de compte : filtrez par banque ou devise. La recherche des positions reste fixe à 400 jours ; raccourcir la période de flux ne réduit pas le volume lu. Si le périmètre filtré reste trop volumineux, cette vue ne peut pas être produite.',
      access: 'Accès refusé : une session et un rôle admin ou auditor autorisés sont nécessaires.',
      concurrent: 'Les données canonical ont changé pendant la lecture. Actualisez pour demander un nouveau snapshot cohérent.',
      generic: 'Lecture indisponible. Vérifiez votre session et réessayez ; si le refus persiste, faites contrôler la source. Aucun résultat partiel ne sera calculé.',
    };
    return <p role="alert" className="rounded border border-red-200 bg-red-50 p-4">{messages[state.failure ?? 'generic']} Aucun ancien résultat ni total partiel n’est affiché.</p>;
  }
  const { snapshot } = state;
  return (
    <div className="space-y-5">
      <div className="rounded-lg border bg-slate-50 p-4 text-sm space-y-2">
        <p><strong>Source exclusive : Daily v2 canonical actif.</strong> Situation recherchée au {snapshot.plan.asOfDate}.</p>
        <p>Recherche des positions : {snapshot.plan.read.startDate} → {snapshot.plan.asOfDate}. Flux observés : {snapshot.plan.flowStartDate} → {snapshot.plan.asOfDate}.</p>
        <p>{snapshot.accounts.length} identités de compte observées · {snapshot.sourceUnitCount} journées de compte lues · calcul effectué le {snapshot.generatedAt} (UTC).</p>
        <p>Couverture limitée aux comptes ayant un relevé dans ces 400 jours : pas un inventaire exhaustif SODATRA. Une journée non observée ne signifie ni zéro mouvement ni un relevé manquant obligatoire.</p>
        <p>Un alias désigne une identité canonical, pas une preuve de compte physique distinct. Aucun total de soldes par devise n’est calculé. Les flux agrègent les journées canonical observées, sans dédoublonnage entre identités d’un même compte physique.</p>
      </div>

      {snapshot.accounts.length === 0 ? (
        <p role="status" className="rounded-lg border p-6">Aucune position connue dans la fenêtre et les filtres demandés. Cela ne signifie pas un solde nul. Les données en staging ne sont pas incluses.</p>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {snapshot.currencies.map((summary) => (
              <section key={summary.currency} className="rounded-lg border p-5 space-y-2" aria-label={`Synthèse ${summary.currency}`}>
                <h2 className="font-semibold text-lg">{summary.currency} — identités observées</h2>
                <p>Positions détaillées par identité dans le tableau ; aucun total de soldes.</p>
                <p className="text-sm">{summary.knownPositionCount}/{summary.accountCount} positions exploitables · {summary.olderStatementCount} relevés antérieurs à la date de situation.</p>
                <p className="text-sm">Dates des derniers relevés : {summary.oldestStatementDate} → {summary.newestStatementDate}. Ce n’est pas une position certifiée à date commune.</p>
                <p className="text-sm">{summary.observedAccountDays}/{summary.possibleAccountDays} journées-compte calendaires observées sur la période de flux. Couverture partielle, sauf si toutes les journées sont observées.</p>
                <dl className="grid grid-cols-1 gap-1 text-sm pt-2">
                  <div><dt className="inline">Débits observés : </dt><dd className="inline">{amount(summary.debitsMinor, summary.currency)}</dd></div>
                  <div><dt className="inline">Crédits observés : </dt><dd className="inline">{amount(summary.creditsMinor, summary.currency)}</dd></div>
                  <div><dt className="inline">Flux net observé : </dt><dd className="inline">{amount(summary.netMinor, summary.currency)}</dd></div>
                </dl>
                <p className="text-xs text-slate-600">Pas de conversion entre devises. Un flux indisponible dans une identité rend la somme de flux correspondante indisponible ; des identités différentes ne prouvent pas des comptes physiques distincts.</p>
              </section>
            ))}
          </div>
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-sm">
              <caption className="p-3 text-left font-semibold">Positions et flux par compte — alias du reporting Daily v2</caption>
              <thead className="bg-slate-50"><tr>
                {['Banque / compte', 'Dernier relevé', 'Ancienneté calendaire', 'Dernier solde', 'Couverture des flux', 'Débits observés', 'Crédits observés', 'Flux net observé'].map((label) => <th key={label} scope="col" className={cell}>{label}</th>)}
              </tr></thead>
              <tbody>{snapshot.accounts.map((account) => (
                <tr key={`${account.bank}-${account.currency}-${account.accountAlias}`}>
                  <th scope="row" className={cell}>{account.bank} · {account.currency}<span className="block font-normal text-xs">{account.accountAlias}</span></th>
                  <td className={cell}>{account.lastStatementDate}</td>
                  <td className={`${cell} ${account.ageDays > 0 ? 'text-amber-800' : ''}`}>{account.ageDays === 0 ? 'Relevé à la date demandée' : `${account.ageDays} jours avant la date demandée`}</td>
                  <td className={cell}>{amount(account.closingMinor, account.currency)}{account.positionUnavailable && <span className="block text-xs">Dernier relevé sans solde exploitable ; aucun repli sur un ancien solde.</span>}</td>
                  <td className={cell}>{account.observedDays}/{snapshot.plan.periodDays} jours calendaires observés · {account.lineCount} lignes<span className="block text-xs">{account.unobservedCalendarDays} jours non observés · {account.reviewDays} à revoir · {account.unavailableDays} sans agrégats</span></td>
                  <td className={cell}>{amount(account.debitsMinor, account.currency)}</td>
                  <td className={cell}>{amount(account.creditsMinor, account.currency)}</td>
                  <td className={cell}>{amount(account.netMinor, account.currency)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
