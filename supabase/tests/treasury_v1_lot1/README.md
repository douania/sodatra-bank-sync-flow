# TREASURY V1 — LOT 1 : soldes fiables multibanques — rejeu PostgreSQL 17 local

Suite de validation de la migration `20261102090000_treasury_v1_lot1_bank_balances.sql`
(couche « solde » seule du cadrage trésorerie R3). Données strictement synthétiques
(utilisateurs `.invalid`, comptes, montants et exports inventés). Aucune connexion à
Supabase, au staging ou à la production.

Depuis la racine du dépôt :

```powershell
pwsh -File supabase/tests/treasury_v1_lot1/run_pg17_replay.ps1            # suites
pwsh -File supabase/tests/treasury_v1_lot1/run_pg17_replay.ps1 -Mutants   # + preuves de mordant
```

Deux scénarios, chacun dans un conteneur `postgres:17-alpine` jetable au nom aléatoire,
supprimé dans `finally` :

- **upgrade** : chaîne complète des migrations SANS celle du lot (shim plateforme
  minimal de `full_chain_replay`), utilisateurs et habilitations par le mécanisme
  existant, données Daily v2 synthétiques, relevé de la surface d'accès, migration
  du lot sur cette base peuplée, comparaison de surface, puis les suites du lot ;
- **fresh** : chaîne complète AVEC la migration du lot sur une base neuve, puis les
  mêmes suites ; avec `-Mutants`, preuves de mordant (dont la course en volatile).

Les fichiers d'assertions (12, 25, 40, 45) s'exécutent dans une transaction annulée :
aucun effet ne subsiste. Les données Daily v2 sont amorcées en mode réplica (les gardes
d'écriture Daily v2 ne concernent pas un jeu d'essai) et leur cohérence de clés est
vérifiée ensuite (`tr_test.assert_seed_consistent`).

| Fichier | Couverture |
|---|---|
| `00_tools.sql` | outils `tr_test` : identités, bascule de rôle, attentes d'erreur, amorçage Daily v2, lecture et contrôle d'un compte à D, mutation |
| `05_users_governance.sql` | administrateur unique désigné par le canal opérateur ; READ, AUDIT, BANK_READ attribués par lui ; profil global `user` du déclencheur existant |
| `10_structure_security.sql` | schéma privé fermé, RLS sans politique, fonctions internes non exécutables, cinq fonctions publiques à `authenticated` seul, lecture STABLE en une instruction SQL, provenance par format, aucune qualification posée par la migration |
| `12_access.sql` | module refermé : lecture et commandes refusées à tous ; refus sans READ, sans BANK_READ, en anonyme, sans session ; date absente ou future refusée ; READ+BANK_READ, AUDIT+BANK_READ et administrateur autorisés |
| `20_inventory_setup.sql` / `25_inventory_rules.sql` | module fermé par défaut puis ouvert par le canal opérateur ; inventaire par les commandes publiques ; ni doublon ni double comptage ; rattachement ; retrait ; attestation de l'empreinte vue ; idempotence et clé réutilisée ; autorité unique ; ajout seul |
| `30_qualification_setup.sql` | qualification par le seul canal opérateur, journalisée ; couples et statuts hors vocabulaire refusés |
| `35_seed_daily_v2.sql` | trente-quatre cas synthétiques (voir le rapport du lot) |
| `40_balances.sql` | couverture positive et absence de preuve, journée provisoire, non close ou close (ligne ultérieure, ouverture suivante), disputée ou en conflit, version de parseur, export à revoir, ligne datée après le dépôt, chaîne rompue à D ou contredite après D, rupture portée par une journée disputée, continuité appuyée sur une journée non résolue ou l'enjambant, premier ancrage précédé d'une journée disputée, report arrière non continu ou d'une autre devise, clôture refusée sur un fichier non digne de preuve, écart inexpliqué, chaîne non prouvée sans réancrage, compte absent ou inactif, solde historique, devise contradictoire, NSIA sans format, aucun zéro par défaut, dates et fraîcheur (date couverte = dernière date disponible, vérifiée sur tous les comptes ; date observée à part), preuves de clôture et de continuité rendues, dates de valeur, pilote et suspension ; reproduction exacte du constat CTO P1 |
| `45_consolidation.sql` | partiel (registre non attesté, comptes hors inventaire, compte non couvert), complet, bloqué |
| `50`–`52` | course réelle : l'écrivain attend la lecture active et prouve qu'elle l'est encore après sa validation ; un import et une suspension validés pendant la lecture ne sont pas vus ; l'état postérieur l'est par une nouvelle lecture ; état rétabli |
| `60`–`61` | surface d'accès et définitions avant/après : aucun objet existant modifié ; seuls nouveaux accès = exécution des cinq fonctions publiques par `authenticated` |
| `70_isolation.sql` | aucune table legacy ni de paiement lue ; seuls `require_bank_read` et `require_admin` du module chèques appelés |
| `mutants/` | une règle critique altérée par fichier, dans une transaction annulée ; la suite visée doit échouer |
