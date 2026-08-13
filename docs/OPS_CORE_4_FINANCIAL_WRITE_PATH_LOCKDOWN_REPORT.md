# OPS-CORE-4 — Verrouillage du chemin d'écriture financier

**Date :** 2026-08-13
**Statut :** `LOCAL_IMPLEMENTED — ENVIRONMENT_NOT_APPLIED`

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

## Sécurité et retour arrière

La migration est transactionnelle : toute erreur pendant son application
annule automatiquement le lot. Après commit, un retour arrière nécessiterait
une migration additive distincte restaurant explicitement les anciens grants et
policies ; elle ne doit être préparée ou appliquée qu'avec un GO dédié.

Aucun SQL n'a été exécuté sur Supabase staging ou production dans ce lot. La
validation puis l'application environnementale restent soumises à des GO
séparés.
