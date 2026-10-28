# PAYABLES-CHEQUES-CORE — rejeu PostgreSQL 17 local

Suite de validation des migrations
`20261026090000_payables_cheques_core.sql`,
`20261026090100_payables_cheques_bank_followup.sql` et
`20261028090000_payables_cheques_single_admin.sql` (administrateur unique du module). Données strictement
synthétiques (utilisateurs `.invalid`, comptes, factures, libellés bancaires et
montants inventés). Aucune connexion à Supabase, au staging ou à la production.

Depuis la racine du dépôt :

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/payables_cheques_core/run_pg17_replay.ps1
```

Le runner joue deux scénarios, chacun dans un conteneur `postgres:17-alpine` jetable au
nom aléatoire, supprimé dans `finally` :

- **upgrade** : shim Supabase/Daily v2 (y compris le privilège `service_role` par défaut
  observé en staging), les deux premières migrations, toute la recette sous l'ancienne
  gouvernance (10 à 80, courses comprises), relevé du domaine (84), migration
  administrateur unique, contrôle de conservation et de neutralisation (85), puis la
  suite administrateur unique (90 à 99c) ;
- **fresh** : les trois migrations sur une base neuve, désignation opérateur (11), les
  mêmes outils de gouvernance réalisés par l'administrateur (21), les suites
  financières 30 à 80 inchangées et leurs courses, puis la suite 90 à 99c.

Chaque course réelle à deux sessions mesure la durée de la seconde session : preuve
qu'elle a attendu le verrou. Le SQL est transmis à `docker` en UTF-8 imposé (sous Windows
PowerShell 5.1, le tube est ASCII par défaut).

| Fichier | Couverture |
|---|---|
| `00_platform_daily_v2_shim.sql` | rôles, `auth.uid()`, `has_role`, colonnes Daily v2 lues, outils `pc_test` |
| `10_structure_security.sql` | RLS, privilèges, interrupteur fermé, admin sans droit métier, amorçage |
| `15_amount_words_corpus.sql` | montant en lettres (corpus partagé avec le test TypeScript) |
| `20_governance.sql` | capacités, personnes, rattachements, paramètres versionnés, profil ORABANK |
| `30_invoices_payments.sql` | fournisseurs, factures, collisions, plafonds, virements, fusions, verrous |
| `40_cheque_print_issue.sql` | formule, contenu signable, impression, réimpression |
| `41_cheque_issuance.sql` | formules gâchées/incertaines, signatures, émission (deux voies), remise |
| `50_exits_takeover_exceptions.sql` | annulation, remplacement, correction, reprise, pré-signées, instruction |
| `60_bank_followup_position.sql` | grammaires (corpus partagé), propositions, recontrôle complet, preuve périmée, capacité `BANK_READ`, vue par compte datée, chaîne des soldes |
| `70`–`75` | courses réelles : réservation simultanée, double confirmation |
| `76`–`78` | course réelle : fusion de fournisseurs pendant une réservation |
| `79a`–`79c` | course réelle : rattachement bancaire pendant une remise en revue de l'unité |
| `79d`–`79f` | course réelle : lecture d'une liste pendant une écriture concurrente (un seul instantané) |
| `80_immutability_hygiene.sql` | ajout seul, immuabilité, vocabulaire fermé, refermeture |
| `05_single_admin_users.sql` | identités synthétiques du modèle administrateur unique |
| `11_single_admin_fresh.sql` | installation neuve : administration fermée sans désignation, gouvernance héritée désactivée, désignation opérateur |
| `21_single_admin_governance_setup.sql` | outils de `20_governance` réalisés par l'administrateur, même état final, règles de contenu inchangées |
| `84_single_admin_upgrade_snapshot.sql` / `85_single_admin_upgrade.sql` | mise à niveau : lignes, historique et définitions hors gouvernance identiques ; `PARAM_*` sans effet ; propositions héritées closes |
| `90_single_admin.sql` | administration sans second approbateur module fermé, non-élévation, capacités héritées, revendications falsifiées, révocation sur session ouverte, seul signataire, traces et immuabilité, rejeu et version attendue |
| `91`–`93b` | courses réelles : révocation pendant une écriture du titulaire, puis écriture pendant une révocation |
| `94`–`95` | course réelle : deux décisions administratives identiques |
| `95a`–`95b` | course réelle : changement de rattachement pendant une préparation du titulaire |
| `96`–`99c` | courses réelles : retrait puis remplacement de l'administrateur pendant son usage ; refermeture |

Marqueurs attendus en fin de rejeu : `PASS <fichier>` pour chaque fichier,
`CONCURRENT_RESERVATION_BLOCKED`, `CONCURRENT_CONFIRMATION_BLOCKED`,
`CONCURRENT_MERGE_SEES_RESERVATION`, `CONCURRENT_REBIND_SEES_UNIT_REVIEW`,
`READ_SNAPSHOT_STABLE_DURING_WRITE`, `SWITCH_CHANGE_WAITS_FOR_WRITES`,
`REVOCATION_WAITS_FOR_INFLIGHT_WRITE`, `WRITE_WAITS_FOR_INFLIGHT_REVOCATION`,
`CONCURRENT_ADMIN_DECISION_SERIALIZED`, `LINK_CHANGE_WAITS_FOR_INFLIGHT_PREPARATION`,
`AUTHORITY_WITHDRAWAL_WAITS_FOR_ADMIN_WRITE`,
`AUTHORITY_REPLACEMENT_WAITS_FOR_ADMIN_DECISION` (dans chacun des deux scénarios),
`PAYABLES_CHEQUES_SCENARIO_PASS upgrade`, `PAYABLES_CHEQUES_SCENARIO_PASS fresh` et
`PAYABLES_CHEQUES_CORE_PG17_REPLAY_PASS`.

Preuve d'impression (hors CI, Chromium local, données synthétiques, aucune
imprimante) : `npm run test:payables-cheques-print` doit afficher
`PRINT_ISOLATION_PAGES=1` et `PRINT_ISOLATION_PAGE_MM=170x95`.
