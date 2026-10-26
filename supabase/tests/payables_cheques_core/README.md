# PAYABLES-CHEQUES-CORE — rejeu PostgreSQL 17 local

Suite de validation des deux migrations candidates
`20261026090000_payables_cheques_core.sql` et
`20261026090100_payables_cheques_bank_followup.sql`. Données strictement
synthétiques (utilisateurs `.invalid`, comptes, factures, libellés bancaires et
montants inventés). Aucune connexion à Supabase, au staging ou à la production.

Depuis la racine du dépôt :

```powershell
powershell -ExecutionPolicy Bypass -File supabase/tests/payables_cheques_core/run_pg17_replay.ps1
```

Le runner crée un unique conteneur `postgres:17-alpine` au nom aléatoire, applique
le shim Supabase/Daily v2 (y compris le privilège `service_role` par défaut observé
en staging), les deux migrations et les assertions, exécute cinq courses réelles à
deux sessions (la durée mesurée est celle de la seconde session : preuve qu'elle a
attendu le verrou) et une refermeture concurrente de l'interrupteur, puis supprime le
conteneur dans `finally`. Le SQL est transmis à `docker` en UTF-8 imposé (sous Windows
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

Marqueurs attendus en fin de rejeu : `PASS <fichier>` pour chaque fichier,
`CONCURRENT_RESERVATION_BLOCKED`, `CONCURRENT_CONFIRMATION_BLOCKED`,
`CONCURRENT_MERGE_SEES_RESERVATION`, `CONCURRENT_REBIND_SEES_UNIT_REVIEW`,
`READ_SNAPSHOT_STABLE_DURING_WRITE`, `SWITCH_CHANGE_WAITS_FOR_WRITES` et
`PAYABLES_CHEQUES_CORE_PG17_REPLAY_PASS`.

Preuve d'impression (hors CI, Chromium local, données synthétiques, aucune
imprimante) : `npm run test:payables-cheques-print` doit afficher
`PRINT_ISOLATION_PAGES=1` et `PRINT_ISOLATION_PAGE_MM=170x95`.
