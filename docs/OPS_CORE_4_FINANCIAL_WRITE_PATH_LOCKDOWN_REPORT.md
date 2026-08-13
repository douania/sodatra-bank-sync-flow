# OPS-CORE-4 — Verrouillage du chemin d'écriture financier

**Date :** 2026-08-13
**Statut :** `CLOSED — PRODUCTION_VALIDATED`

## Objectif

Rendre les deux RPC atomiques introduites par OPS-CORE-2 incontournables pour
les clients `authenticated`. Les écritures directes sur les sept tables
financières ne doivent plus pouvoir contourner la transaction, l'idempotence et
les contrôles métier portés par ces RPC.

## Périmètre

La migration additive
`20260813000000_ops_core_4_financial_write_path_lockdown.sql` :

- retire les policies RLS `ALL`, `INSERT`, `UPDATE` et `DELETE` des tables
  `bank_reports`, `bank_facilities`, `deposits_not_cleared`, `impayes`,
  `fund_position`, `fund_position_detail` et `fund_position_hold` ;
- révoque à `authenticated` les privilèges `INSERT`, `UPDATE`, `DELETE`,
  `TRUNCATE`, `REFERENCES` et `TRIGGER` sur ces tables ;
- conserve les policies et grants de lecture ;
- conserve l'exécution de `save_bank_report_atomic_v1` et
  `save_fund_position_atomic_v1` ;
- ne modifie ni les données, ni les privilèges `service_role`, ni une migration
  historique.

L'audit statique confirme qu'aucun consommateur actif sous `src/` n'effectue
d'écriture directe sur ces sept tables.

## Preuves locales

- contrats OPS-CORE-2 + OPS-CORE-4 : **22/22 PASS** ;
- replay PostgreSQL 17 jetable : **PASS** ;
- migration rejouée deux fois : **PASS** (idempotence) ;
- lignes synthétiques antérieures à la migration conservées : **PASS** ;
- lectures `authenticated` conservées : **PASS** ;
- écritures directes `authenticated` refusées : **PASS** ;
- deux RPC atomiques toujours exécutables : **PASS** ;
- deux RPC appelées sous un rôle membre de `authenticated` : **PASS** ;
- rollback transactionnel synthétique : **PASS** ;
- build Vite de production : **PASS** ;
- ESLint : **209 erreurs / 11 warnings**, baseline canonique inchangée ;
- TypeScript : **20 diagnostics**, baseline canonique inchangée ;
- `git diff --check` : **PASS**.

Le contrat `test:financial-write-lockdown` est branché dans GitHub Actions. Les
scripts CI ont aussi été exécutés séparément, comme sous GitHub Actions.
Tous passent localement sauf `test:upload-guard` (11/12) : sous ce runner
Windows/TSX, l'import existant de `src/integrations/supabase/client.ts` reçoit un
`import.meta.env` absent. Ce test et ce module ne sont pas modifiés par le lot ;
le contrôle Linux distant reste l'autorité pour ce diagnostic d'environnement.

La contre-review indépendante initiale a rendu `PASS_WITH_RESERVES`, sans P0 ni
P1. Ses deux P2 — appels RPC de replay exécutés comme superutilisateur et contrat
absent de la CI — ont été corrigés dans la draft PR avant toute validation
d'environnement.

## Validation staging

La migration a été appliquée sur le projet exact `gbbsqcscryygqlmqncyv`, dans
une transaction incluant l'entrée du ledger. Le marqueur d'application est
`OPS_CORE_4_STAGING_APPLY_OK`.

Les contrôles post-application ont confirmé :

- migration `20260813000000` présente au ledger ;
- RLS active sur les sept tables ;
- zéro policy et zéro privilège d'écriture directe pour `authenticated` ;
- sept lectures `authenticated` conservées ;
- deux RPC atomiques toujours exécutables ;
- privilèges `service_role` inchangés.

Le scénario authentifié a vérifié le refus de l'écriture directe, les deux
graphes atomiques parent/enfants, le rejeu idempotent et le ledger. Son rollback
a laissé zéro donnée et zéro commande synthétique. Marqueur :
`OPS_CORE_4_STAGING_AUTHENTICATED_E2E_ROLLBACK_OK`.

## Validation production

### Préflight et application

La cible a été verrouillée sur le projet canonique `leakcdbbawzysfqyqsnr`,
affiché `sodatra-accounting`, branche `main — Production`. Le préflight a
confirmé OPS-CORE-2 présente, OPS-CORE-4 absente, 37 migrations au ledger, 21
policies d'écriture et 42 privilèges d'écriture directe `authenticated`.

La migration et son entrée de ledger ont été appliquées dans une transaction
unique. Marqueur : `OPS_CORE_4_PRODUCTION_APPLY_OK`. Le contrôle immédiatement
postérieur a produit `OPS_CORE_4_PRODUCTION_POST_APPLY_OK` et confirmé :

- 38 migrations, dernière version `20260813000000` ;
- RLS active sur les sept tables ;
- 21 → 0 policies d'écriture directe ;
- 42 → 0 privilèges d'écriture directe `authenticated` ;
- sept lectures `authenticated` conservées ;
- deux RPC atomiques et leurs commentaires contractuels conservés ;
- privilèges d'écriture `service_role` conservés ;
- ledger d'idempotence vide avant le test runtime.

Les volumes sont restés identiques : 268 `bank_reports`, 26 `fund_position` et
zéro ligne dans les cinq tables enfants observées. Les empreintes calculées sur
les sept tables sont strictement identiques avant et après l'application.

Les trois migrations Collections Core des 3, 4 et 5 août restent absentes de
production conformément à leur périmètre staging explicite ; cet écart de
ledger est intentionnel et indépendant d'OPS-CORE-4.

### E2E authentifié avec rollback

Sous un acteur production possédant un rôle `admin` ou `manager`, le scénario a
validé dans une transaction destinée au rollback :

- refus de l'insertion directe par `authenticated` ;
- succès de `save_bank_report_atomic_v1` avec facility, dépôt et impayé ;
- succès de `save_fund_position_atomic_v1` avec détail et retenue ;
- même identifiant retourné au rejeu de chaque commande ;
- deux commandes complétées dans le ledger pendant la transaction ;
- présence exacte des deux graphes parent/enfants avant rollback.

Après rollback, zéro ligne et zéro commande synthétique subsistent, et les
volumes comme les empreintes correspondent au préflight. Marqueurs :
`OPS_CORE_4_PRODUCTION_AUTHENTICATED_E2E_ROLLBACK_OK` puis
`OPS_CORE_4_PRODUCTION_AUTHENTICATED_E2E_FINAL_STATE_OK`.

## Sécurité et retour arrière

La migration est transactionnelle : toute erreur pendant son application
annule automatiquement le lot. Après commit, un retour arrière nécessiterait
une migration additive distincte restaurant explicitement les anciens grants et
policies ; elle ne doit être préparée ou appliquée qu'avec un GO dédié.

Les SQL staging et production décrits ci-dessus ont été exécutés uniquement
sous leurs GO nominatifs. Les données synthétiques des validations runtime ont
été confinées à des transactions annulées. Aucun secret, identifiant personnel,
fichier bancaire ni donnée bancaire détaillée n'est consigné dans ce rapport.

## Clôture

OPS-CORE-4 et DEF-16 sont clos. En production, les clients `authenticated` ne
peuvent plus écrire directement dans les sept tables financières et doivent
passer par les RPC atomiques OPS-CORE-2. Aucun déploiement frontend
supplémentaire n'est requis pour ce lot.
