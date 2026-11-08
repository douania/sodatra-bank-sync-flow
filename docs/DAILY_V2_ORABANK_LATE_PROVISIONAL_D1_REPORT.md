# Rapport Claude Code — DAILY_V2_ORABANK_LATE_PROVISIONAL_D1

> Candidat local de l'itération 3 accepté par le CTO : verdict **`PASS_WITH_RESERVES`**
> (§ 0). Ce rapport accompagne son figement, son commit et sa draft PR. Aucun merge ;
> aucun environnement distant consulté, même en lecture, pendant la mise au point.
> Données exclusivement synthétiques.
>
> Itérations :
> - itération 2 : corrections C1, C2, C3 du premier verdict CTO « FAIL ciblé » ;
> - itération 3 : correction W5 et version d'analyse, second verdict « FAIL ciblé sur
>   W5 » (C1, C2, C3 acceptées dans les cas démontrés) ;
> - verdict final sur l'itération 3 : `PASS_WITH_RESERVES`.

## 0. Verdict CTO et réserves conservées

**Verdict CTO sur l'itération 3 : `PASS_WITH_RESERVES`.** Les points bloquants sont
levés.

**Garde de réfutation.** Elle est acceptée dans sa forme conservatrice actuelle et reste
inchangée : une livraison désignée comme preuve par une réfutation n'est pas retirée, y
compris si la réfutation est révoquée.

**Portée de l'acceptation.** Elle est **locale** : elle porte sur le candidat validé sur
des bases PostgreSQL jetables, avec des données synthétiques. Elle ne vaut ni
qualification d'environnement, ni migration distante, ni mise en service. Aucune
validation staging ou production n'a été faite par ce lot ; chaque environnement relève
d'un GO distinct.

**Réserves conservées :**

1. **W9 : preuve technique limitée.** Le témoin utilise une insertion synthétique
   directe. Un scénario par les vraies commandes de réfutation reste à réaliser avant
   activation métier. Le parcours complet n'est pas revendiqué comme démontré.
2. **États hérités.** Leur normalisation peut retirer une source, un témoin de propreté
   ou une preuve de clôture, et réduire la disponibilité affichée. Avant application à un
   environnement exploité, les journées concernées devront être identifiées et leur
   traitement vérifié. La conservation générale de la couverture historique n'est pas
   certifiée.
3. **Convergence bornée.** Les limites du § 8.6 restent applicables : W4 sans copie
   conforme, preuves protégées, versions non justifiées et séquence P2-1. D1 n'est pas
   une convergence générale de tous les fichiers de même contenu.
4. **Version du parseur.** Sa valeur doit évoluer lors d'un changement sémantique. Son
   égalité déclarée ne détecte pas automatiquement une modification du logiciel et
   n'authentifie pas le fichier.

**Également conservés :**
- la limite Windows CRLF/m14, préexistante, distincte du succès obtenu sur copie LF
  vérifiée ;
- l'absence de rejeu de relevés réels dans D1 ;
- O2 hors correctif.

Seule cette section, l'en-tête, la ligne « GO_COMMIT » et les mentions de la garde
(§ 5, § 6, § 15, § 18, § 19) ont été retouchées au figement ; sur GO distinct, le chemin
local du worktree (§ 1) a été remplacé par « worktree local isolé (chemin non publié) »,
le dépôt étant public. Les résultats, leurs limites
et les conclusions des revues sont ceux du candidat accepté ; les chiffres du § 16 datent
d'avant cette retouche.

## 1. Métadonnées

| Élément | Valeur |
|---|---|
| Repo | `douania/sodatra-bank-sync-flow` |
| GO initial | `GO_IMPLEMENT_DAILY_V2_ORABANK_LATE_PROVISIONAL_D1_LOCAL_ONLY` (cadrage R2, variante R, réserves CTO R1 à R4) |
| GO de correction | `GO_FIX_DAILY_V2_ORABANK_LATE_PROVISIONAL_D1_LOCAL_ONLY`, reconduit après le second verdict (même branche, mêmes 19 fichiers) |
| Arbitrages du second verdict | W4 accepté comme limite prudente ; W5 à corriger ; version d'analyse à exiger ; comparaison de surface supplémentaire non exigée |
| Niveau | très approfondi : intégrité bancaire, provenance, idempotence, concurrence |
| Base vérifiée | `origin/main` = `ba2bbedad69fa8f919b9bbadec9113bf04ba7b6d` après `git fetch origin`, à chaque préflight et en fin de lot (inchangée) |
| Branche, worktree | `codex/daily-v2-orabank-late-provisional-d1`, worktree local isolé (chemin non publié), HEAD = base, aucun commit |
| Checkout de référence | intact : branche `agent/pack-2-real-format-compatibility`, HEAD `dfcbe89`, aucun fichier modifié |
| GO_COMMIT / GO_PR / GO_MERGE | non / non / non pendant la mise au point ; commit unique, push de la branche et draft PR autorisés par le GO de figement ; merge : non |
| Outils | Node 22.23.1, npm 10.9.8, ESLint 9.13.0, TypeScript 5.6.3, tsx 4.22.3, Docker 29.9.2, images locales `postgres:15-alpine` et `postgres:17-alpine` (aucun téléchargement), Windows PowerShell 5.1 |

## 2. Objectif

Une livraison demandée provisoire, complètement identique à la version canonique
active et conforme, ne doit plus contester une couverture déjà acquise (constat D1 de la
simulation BDK/ORABANK).

Exigences des verdicts CTO :
- **C1** : aucune source résiduelle des redépôts identiques selon l'ordre d'activation ;
- **C2** : ordre ambigu jugé sur les valeurs numériques d'index et d'ordinal ;
- **C3** : le runner Trésorerie valide le candidat effectivement installé ;
- **W5** : un doublon justifié est retiré au dépôt avec les mêmes garanties qu'à
  l'activation ;
- **version d'analyse** : l'emprunt d'une copie existante exige une version d'analyse
  identifiée, non vide et identique.

## 3. Préflight (itérations 2 et 3)

- Règles relues dans l'ordre d'`AGENTS.md` : `CTO_GO_QUEUE.md` ne contient que le modèle
  `PENDING`, puis `CLAUDE.md`, le workflow, le rapport et les verdicts.
- Worktree : branche et HEAD conformes ; seules les modifications non commitées du
  candidat sont présentes (18 fichiers à l'itération 2, 19 à l'itération 3), donc aucune
  modification étrangère. Aucun nettoyage, stash ni réinitialisation.
- `git fetch origin` : `origin/main` = `ba2bbed`, inchangé.
- La migration D1 candidate, non commitée et jamais appliquée hors des bases jetables,
  est corrigée en place ; aucune seconde migration.
- Conteneurs préexistants d'autres travaux : non touchés.
- Stop condition déclenchée : aucune.

## 4. Périmètre

Liste blanche fermée de 19 fichiers : les 18 du GO initial, plus
`supabase/tests/treasury_v1_lot1/run_pg17_replay.ps1`. Fichiers touchés : les 19
(6 modifiés, 13 nouveaux), aucun autre. La migration n'intervient que sur F1, F2 et les
trois fonctions internes F3 à F5 ; elle n'ajoute aucun objet et aucun privilège.

## 5. Résumé exécutif

**Doublons du cycle provisoire (C1 et W5).** Un doublon R1-provisional est retiré
(`duplicate → superseded`) **au dépôt comme à l'activation**, avec les mêmes garanties,
toutes exigées :
- provenance : son événement de réception R1-provisional ;
- version : version complète du canonical actif, et cohérence ;
- conformité : une copie conforme détenue par le cycle provisoire du **même fichier** et
  reçue sous la **même version d'analyse** ;
- aucune réfutation ne le désigne comme preuve (garde ajoutée, § 6, acceptée par le CTO
  dans sa forme conservatrice actuelle).

Les doublons du canonical (R1, H1) ne sont jamais retirés.

**C2, C3.** Inchangés depuis l'itération 2 et acceptés.

**Version d'analyse.** La dispense de stockage au dépôt et la justification du doublon
exigent une `parser_version` identifiée, non vide et identique. À défaut, la copie n'est
pas empruntée. Une nouvelle charge vérifiée sur ses propres lignes est retirée, et stocke
sa copie.

**Portée réelle de la convergence (§ 8.6).**
- Elle vaut pour les réceptions d'un même fichier sous une même version d'analyse, avant
  comme après l'activation, ainsi que pour les états hérités justifiés.
- Pour un autre fichier de même contenu (W4), elle n'est atteinte qu'au redépôt conforme
  de ce fichier. Elle n'est pas annoncée pour tous les fichiers de même contenu.

**Contrôles.** Tout est vert :
- PostgreSQL 17, avec 25 mordants D1 distincts, tous tués ;
- PostgreSQL 15 ;
- Trésorerie sur copie LF : 83 / 83 et 83 / 83 ;
- lint et typecheck identiques à la baseline ; build sans effet sur l'artefact MCP ;
- suites TypeScript.

**Relecture indépendante du delta.** Avis « réserves », aucun défaut de code ; quatre
notes P3, documentées.

## 6. Diagnostic et conception

**Prédicat D1 (inchangé).** Il porte sur :
- un canonical actif `ingested` de la même journée ;
- `daily_stmt_version_compare(...) = 'SAME_VERSION'`, avec égalité numérique et absences
  comprises ;
- `daily_stmt_version_coherent` ;
- des lignes conformes selon `daily_stmt_line_facts_conform`, dans un ordre non ambigu
  (valeurs entières, C2).

**Dépôt (F1).** Une livraison qui satisfait le prédicat est reçue, puis retirée
(`late_provisional_same_version_superseded`). F5 retire ensuite les seules livraisons
préexistantes admissibles de la journée. Hors prédicat, le chemin existant est inchangé.

**Dispense de stockage.** Une copie existante du même fichier dispense de stocker de
nouvelles lignes, si elle remplit toutes les conditions :
- livraison du cycle provisoire (provisoire ou retirée) ;
- même journée, même empreinte de journée et mêmes faits ;
- lignes conformes, ordre non ambigu ;
- même version d'analyse identifiée :
  `nullif(btrim(a.parser_version), '') IS NOT NULL AND a.parser_version = nullif(btrim(coalesce(p_attempt ->> 'parser_version', '')), '')`.

**Activation (F2 → F5).** Le cœur commun à la promotion unitaire, à la promotion groupée,
au remplacement et à la correction des seuls soldes retire, sous le verrou de journée,
les seules livraisons admissibles pour la version activée.

**F5, les candidats (itération 3).**
- **Sélection.** Les trois sélections portent sur `s.status IN ('provisional', 'duplicate')`,
  au dépôt (livraison du dépôt exclue) comme à l'activation.
- **Retrait.** Chaque retrait vérifie son statut d'origine (`ROW_COUNT` = 1) et émet un
  `status_changed` avec le motif D1. Le détail `resolution` vaut :
  - `retired_at_deposit` ou `retired_at_activation` pour une provisoire ;
  - `provisional_duplicate_retired_at_deposit` ou
    `provisional_duplicate_retired_at_activation` pour un doublon.
- **Postcondition.** Les candidats restants sont exactement ceux qui ne satisfaisaient
  pas le prédicat avant le retrait.

**F4, branche doublon.** Toutes les conditions sont exigées :
- **provenance** : l'événement de réception `unit_duplicate` écrit par le seul chemin
  R1-provisional (motif `provisional_redeposit_duplicate`, aucun canonical désigné, même
  tentative, même empreinte de journée). Un doublon du canonical, de rejeu d'écartement
  ou du cœur BIS n'en a jamais. Ces écritures ne sont pas accessibles à l'API ;
- **version** : version complète du canonical, et cohérence ;
- **aucune réfutation** ne le désigne comme preuve (`proof_staging_unit_id`) ;
- **conformité** : une livraison du cycle provisoire du même fichier, de même empreinte
  et de mêmes faits, aux lignes conformes et à ordre non ambigu, reçue sous la même
  version d'analyse :
  `nullif(btrim(ao.parser_version), '') IS NOT NULL AND ao.parser_version = v_pv`.
- La livraison du dépôt, exclue des candidates, peut servir de copie si elle a stocké ses
  lignes vérifiées. C'est le cas du parcours W4 → Y.

**Garde « preuve de réfutation » (extension, acceptée par le CTO dans sa forme
conservatrice actuelle, inchangée).**
- Un doublon portant la version retenue est une preuve `FRESH_DELIVERY` admissible
  (commande de réfutation, `20261103120000` l. 1207). Le lecteur exige alors une preuve
  en statut `promoted` ou `duplicate` (`20261103130000` l. 523).
- Le retirer au dépôt suspendrait la réfutation ; la garde le laisse donc intact.
- La réfutation prend le verrou de journée : pas de course possible.
- La garde s'applique dans les deux contextes et couvre aussi une réfutation révoquée
  (prudence).

**Empreinte brute et version d'analyse.** Ce sont des données déclarées par le client.
Elles relient deux réceptions et réduisent le risque de dérive d'analyse. Elles
n'authentifient pas un fichier.

**C2 (inchangé).**
- F3 groupe par `(source_line_index)::integer` et `(daily_occurrence_ordinal)::integer`.
- Une valeur au-delà du domaine entier rend faux, sans erreur.
- La garde des lignes stockées (F4) porte sur des colonnes entières.

**C3 (inchangé).**
- Le scénario `upgrade` exclut D1 de sa chaîne initiale et l'applique après la migration
  22023 et la comparaison 64.
- `Assert-D1Effective` vérifie les cœurs installés et l'empreinte md5 des cinq
  définitions, identique en `upgrade` et en `fresh`, et inchangée en fin de scénario.

**Fonctions.**

| Fonction | Signature | Attributs |
|---|---|---|
| F1 redéfinie | `public.daily_stmt_pre_ingest_legacy_core_0u(jsonb, jsonb, jsonb, jsonb) RETURNS jsonb` | inchangés : plpgsql, `SECURITY DEFINER`, `SET search_path = public, pg_temp` |
| F2 redéfinie | `public.daily_stmt_promote_unit_core(uuid, uuid, uuid) RETURNS uuid` | inchangés : plpgsql, volatile, non `SECURITY DEFINER` |
| F3 | `public.daily_stmt_payload_lines_conform(jsonb, text, integer, numeric, numeric, text, numeric, numeric) RETURNS boolean` | plpgsql `IMMUTABLE`, non `SECURITY DEFINER`, chemin épinglé |
| F4 | `public.daily_stmt_provisional_same_version(uuid, uuid) RETURNS boolean` | plpgsql `STABLE`, non `SECURITY DEFINER`, chemin épinglé |
| F5 | `public.daily_stmt_retire_same_version_provisionals(text, uuid, uuid, uuid, text, uuid) RETURNS integer` | plpgsql volatile, non `SECURITY DEFINER`, chemin épinglé |

Les cinq fonctions ont l'exécution révoquée pour `PUBLIC`, `anon`, `authenticated` et
`service_role`, sans aucun `GRANT`. F1 diffère de sa source vivante par 102 lignes
ajoutées et deux retirées ; F2 par un seul appel. Le test de contrat contrôle ces écarts
ligne à ligne.

**Inchangés.**
- Enveloppes et contrôles de portée, cœurs 0w et BIS 0v.
- Chemin `staged` R1/R2/R3 : une journée close balaie toujours toutes les provisoires.
- Comparaison R1-provisional au dépôt, H1, non-promotion des provisoires.
- Écartement, réfutation, règles de clôture, lecteur Trésorerie, domaine des événements
  et liste blanche des détails.
- Aucune donnée existante n'est modifiée par la migration.

## 7. Changements réalisés

| Fichier | Changement |
|---|---|
| `supabase/migrations/20261108120000_..._same_version.sql` | F1 à F5 et révocations ; itération 2 : C1, C2, garde d'ordre de la dispense, domaine entier ; itération 3 : F5 (candidats au dépôt, audit), F4 (version d'analyse, garde de preuve), F1 (version d'analyse de la dispense), commentaires |
| `supabase/tests/daily_statement_units_v2/45a_d1_setup.sql` | outils `d1` (inchangé depuis l'itération 1) |
| `.../45b_d1_deposit_rules.sql` | V1 à V29, W1 à W9, V20 à oracle numérique, V19 par comptage, mordants M1 à M23 ; itération 3 : W5 inversé, W8, W9, V29, M16 redéfini, M21 à M23 |
| `.../45c_d1_treasury_reading.sql` | T1 à T7, C1 (`d1.p11`), parcours W4 → Y (`d1.w4y`), caractérisation P2-1, mordants M1, M4, M2b, M10, M16 |
| `.../46a` à `46h` | courses C1 à C5, correction ultérieure sur C4 et C5 (inchangés à l'itération 3) |
| `.../16_provisional_lifecycle_0z.sql`, `run_e2e_0r.sh` | inchangés depuis l'itération 1 |
| `.../run_operational_pg17.ps1` | en-tête et libellés des courses |
| `.../README.md` | section D1 et couverture des suites |
| `supabase/tests/treasury_v1_lot1/run_pg17_replay.ps1` | C3 : exclusion puis application ordonnée de D1, `Assert-D1Effective` |
| `src/features/daily-v2/dailyV2ApplicationContract.synthetic.test.ts` | gardes statiques C1, C2, C3, W5 et version d'analyse ; écart de F1 = 102 lignes |
| `docs/DAILY_V2_ORABANK_LATE_PROVISIONAL_D1_REPORT.md` | ce rapport |

## 8. Corrections des verdicts CTO

### 8.1 C1 — doublons issus du cycle provisoire (acceptée)

**Attentes fixées avant correction** (`d1.p11_expected`) :
- chaque réception du fichier tardif est retirée et auditée (canonical V08) ;
- volume du 08 = 3 ;
- une seule source (F09, 09/10 17:00) ;
- lecture identique entre les ordres, avant la correction et après celle du 22/10
  (1137.00, réfutation automatique).

| Ordre | Séquence | Résolutions (dans l'ordre de dépôt) |
|---|---|---|
| A | deux redépôts, promotion | `retired_at_activation`, `provisional_duplicate_retired_at_activation` |
| B | promotion, deux redépôts | `retired_at_deposit_lines_stored`, `retired_at_deposit_lines_not_restaged` |
| C | trois redépôts, promotion | `retired_at_activation`, puis deux `provisional_duplicate_retired_at_activation` |
| D | un redépôt, promotion, un redépôt | `retired_at_activation`, `retired_at_deposit_lines_not_restaged` |

**Résultats.**
- Avant correction (sondage) : `FAIL ... ordre A : réception 2 retirée` ; `FAIL 46h C4`.
- Après correction : les quatre ordres convergent ; M10 est tué.

**Courses C4 et C5** (B attend 3,2 s) : même état final, volume 4, une source, même
lecture avant et après la correction.

### 8.2 C2 — ordre ambigu numérique (acceptée)

Le cas est couvert par V26 :
- variantes : index « 01 », ordinal « 01 », combinaison, au dépôt et à l'activation ;
- témoin sans collision, à zéros initiaux ;
- V28 : index au-delà du domaine entier.

Résultats :
- avant correction : `FAIL V26 idx` ; `FAIL V20` ;
- après correction : vert. V20 (oracle numérique) compte 233 unités à ordre non ambigu,
  0 écart entre la règle de la charge et les lignes stockées (225 conformes, 8 non
  conformes), et 9 unités à ordre ambigu, toutes refusées. M14 est tué par V26 et par V20.

### 8.3 C3 — définitions effectives D1 (acceptée)

| Scénario | Étape | Empreinte des cinq définitions D1 (candidat final) |
|---|---|---|
| `upgrade` | après D1 (après la migration 22023 et la comparaison 64) | `330e64f266d07229f2a937380cc5d5d2` |
| `upgrade` | fin du scénario | identique |
| `fresh` | après la chaîne ordonnée | identique à `upgrade` |
| `fresh` | fin du scénario (différentiels, 167 mordants) | identique |

### 8.4 W5 — retrait au dépôt (itération 3)

**Attentes fixées avant correction.**
- **W5 inversé.** Un doublon R1-provisional hérité, justifié par la copie conforme de son
  fichier, est retiré au dépôt suivant d'une livraison D1 de la journée :
  - sans lignes ;
  - événement `provisional_duplicate_retired_at_deposit`, canonical actif, tentative du
    dépôt ;
  - événement de réception conservé.
- **Parcours W4 → redépôt conforme de Y → correction** (`d1.w4y`, 45c), sur le calendrier
  Q6 :

| Étape | Attendu |
|---|---|
| X (fichier x) et Y (fichier y) reçus le 20/10 pendant la fenêtre | X provisoire ; Y doublon R1-provisional, sans lignes |
| promotion du 08 | X retirée ; Y conservé (limite W4) ; deux sources : F09 et y (reçu le 20/10 17:02) ; 08 disponible |
| redépôt de y le 21/10 | réception retirée, copie stockée (1 ligne) ; ancien doublon Y retiré au dépôt (motif D1, `provisional_duplicate_retired_at_deposit`, canonical V08, tentative du redépôt) |
| après le redépôt | une seule source (F09, 09/10 17:00) ; volume du 08 = 4 ; trois événements D1 (X, redépôt, Y) ; 08 disponible |
| correction du 22/10 | disponible, 1137.00, réfutation automatique ; lecture identique à celle d'un compte témoin sans fichier tardif |

**Résultats bruts avant correction** (sondage sur le candidat d'itération 2) :
- `FAIL 45b V25 W5 : dépôt : doublon hérité retiré, sans lignes, audité` ;
- `FAIL 45c W4→Y : ancien doublon de y retiré au dépôt` ;
- `PASS W9` : la garde n'est pas encore sollicitée tant que les doublons ne sont pas
  candidats au dépôt.

**Après correction.**
- W5 et W4 → Y passent, la lecture après correction est égale au témoin.
- **M16** réintroduit l'exclusion fautive (doublons candidats à l'activation seulement) :
  il est tué par W5 et par W4 → Y.
- Tous les témoins négatifs restent verts : W1 (doublon canonique légitime, H1), W2, W3,
  W4 sans redépôt, W6, W7, V9, V10, V18, T3, C3, équivalents CD et CF.

### 8.5 Version d'analyse (itération 3)

**Attentes fixées avant correction.**
- **V29, dispense au dépôt.** Le même fichier tardif est redéposé avec quatre versions
  d'analyse (`structured-csv-0c`, absente, blanche, puis `0b`). Chaque réception est
  retirée :
  - une version différente, absente ou blanche ne permet pas l'emprunt de copie, et la
    réception stocke ses propres lignes ;
  - la version identique (`0b`) emprunte la copie (`retired_at_deposit_lines_not_restaged`).
  - Volume du 06 : 10.
- **W8, justification du doublon.** Pendant la fenêtre, quatre doublons du même fichier,
  avec les mêmes quatre versions. À l'activation, seul le doublon de version identique est
  retiré ; les trois autres restent intacts (empreinte complète, aucun événement).

**Résultats bruts avant correction** :
- `FAIL 45b V29 réception c : retirée (retired_at_deposit_lines_stored)` ;
- `FAIL 45b V25 W8 : doublons de version d'analyse différente, absente ou blanche intacts`.

**Après correction :** verts ; M22 est tué par V29, M23 par W8.

### 8.6 Portée réelle de la convergence

**Converge, quel que soit l'ordre :**
- les réceptions identiques d'un même fichier (même empreinte brute, même version
  d'analyse non vide) de la version active ou activée, avant ou après l'activation : ordres
  A à D, courses C4 et C5 ;
- les états hérités justifiés, au prochain dépôt D1 provisoire de la journée ou à la
  prochaine activation de leur version (W5) ;
- W4, dès qu'un redépôt conforme du fichier Y a lieu sous la même version d'analyse (W4 → Y).

**Reste fermé, donc sans convergence annoncée :**
- doublon d'un autre fichier sans copie conforme de ce fichier (W4, limite acceptée) ;
- doublon dont la copie est non conforme, à ordre ambigu, de faits différents, hors du
  cycle provisoire, ou d'une version d'analyse différente, absente ou blanche
  (W2, W6, W7, W8) ;
- doublon désigné comme preuve d'une réfutation (W9) ;
- livraisons divergentes, incohérentes, non conformes ou à ordre ambigu ;
- séquence P2-1 (coexistence acceptée).

**Déclencheurs.**
- Un état hérité n'est réévalué qu'à un dépôt D1 provisoire de la journée ou à une
  activation de sa version. Un dépôt de journée close balaie les provisoires, sans
  retirer les doublons.
- Après un balayage 0Z, le volume de lignes stockées peut différer selon l'ordre, sans
  effet sur les sources.

### 8.7 Arbitrages clos, appliqués

- **P2-1, coexistence.** La caractérisation `d1.c_p21` est conservée ; aucune convergence
  n'est généralisée à cette séquence.
- **Dispense « même fichier ».** Elle est conservée, désormais complétée par l'ordre non
  ambigu et la version d'analyse.
- **CRLF / m14.** Ni le mordant ni le lecteur ne sont modifiés. La copie LF extérieure au
  dépôt est vérifiée : 318 fichiers relus, 306 convertis, seules les fins de ligne
  diffèrent.
- **O2.** Hors D1 (§ 13).
- **W4.** Limite prudente acceptée, documentée (§ 8.6).
- **Comparaison de surface D1.** Non exigée ; non ajoutée.

## 9. Réserves CTO R1 à R4 (rappel)

- **R1, volumes.** Aucune ligne effacée ; aucun DELETE ; un doublon retiré reste sans
  lignes ; un emprunt de copie exige le même fichier, la même version d'analyse, des faits
  identiques et un ordre non ambigu.

  | Scénario | Volume |
  |---|---|
  | V18 | 6 |
  | T3 redépôts | 1 copie |
  | C1 | 3 |
  | Courses C4 et C5 | 4 |
  | W4 → Y | 4 |
  | V29 | 10 |

- **R2.** Générateur de la suite 16 (inchangé).
- **R3.** Empreinte complète des livraisons préservées : V8, V11b, V24, T5, C3, W2, W3, W4,
  W6, W7, W8, W9.
- **R4.** Réponse `superseded` acceptée par le client, sans correction applicative.

## 10. Sécurité / données sensibles

| Point | Réponse |
|---|---|
| Secret ajouté | non |
| Données bancaires réelles | non (calendriers inventés ; aucun relevé, aucun dossier privé) |
| SQL exécuté | uniquement sur des conteneurs PostgreSQL 15 et 17 jetables, créés et détruits par les runners ; aucun conteneur de test restant |
| Supabase live, staging, production, Lovable | non (aucun accès, même en lecture) |
| Migration | additive, corrigée en place, jamais appliquée hors des bases jetables |
| Auth / RLS / privilèges | non modifiés ; aucun objet ni privilège ajouté |
| Réseau | `git fetch origin` seulement |

## 11. Tests exécutés et baselines (candidat final)

Baselines mesurées sur la base exacte `ba2bbed`, avant toute modification (méthodologie
`docs/BASELINES.md`).

| Commande | Résultat | Détail |
|---|---|---|
| `git diff --check` (nouveaux fichiers inclus) | PASS | aucune erreur |
| `npm run lint` | conforme | base et candidat : 178 erreurs / 11 avertissements ; item par item : 0 nouveau, 0 disparu ; aucun item dans le test de contrat |
| `npx tsc -p tsconfig.app.json --noEmit` | conforme | 16 diagnostics, identiques à la base |
| `npx tsc -p tsconfig.node.json --noEmit` | PASS | 0 erreur |
| `npm run build` | PASS | `supabase/functions/mcp/index.ts` inchangé (`24afa74` avant et après), aucun fichier modifié sous `supabase/functions/` |
| `npm run test:daily-v2-application` | PASS | 109 / 109, test de contrat compris |
| `npm run test:daily-v2-reporting` | PASS | 70 / 70 |
| étape CI « Daily v2 operational decisions », 4 suites TypeScript | PASS | 49 / 49 |
| `treasuryMutation.proof.ts` | PASS | 26 / 26 |
| `run_operational_pg17.ps1` (PostgreSQL 17) | PASS | `DAILY_V2_OPERATIONAL_DECISIONS_PG17_PASS`, 51 s ; 25 mordants D1 distincts tués (30 preuves) ; courses : B attend 3,2 s |
| `run_e2e_0r.sh` (PostgreSQL 15) | PASS | `ALL_LOCAL_E2E_0R_PASS`, 40 s, suite 16 comprise |
| `treasury_v1_lot1/run_pg17_replay.ps1 -Mutants`, copie LF | PASS | `upgrade` puis `fresh` ; différentiels ; 83 / 83 ; 83 / 83 sur la référence ; m04 tué ; D1 effective (§ 8.3) ; 421 s |
| idem, worktree CRLF | arrêt préexistant | `upgrade` et `fresh` passent avec la même empreinte D1, puis arrêt au mordant m14 (§ 12.5) |

Aucun échec propre au lot. Les suites 16, 28 à 30 (PostgreSQL 15) restent vertes : leurs
doublons R1-provisional ne sont jamais suivis d'un dépôt D1 ou d'une activation de même
version.

## 12. Résultats détaillés

### 12.1 Règles du dépôt (45b)

| # | Cas | Résultat |
|---|---|---|
| V1–V24 | matrice des itérations précédentes | verts |
| V19 | privilèges et attributs ; cohérence comptée dans les deux branches de F4 | vert |
| V20 | parité de la règle de la charge | 233 unités non ambiguës, 0 écart ; 9 ambiguës refusées |
| V25 W1–W9 | doublons : W1 canonique légitime (H1) ; W2 copie non conforme ; W3 version financière différente ; W4 autre fichier ; W5 hérité retiré au dépôt ; W6 copie de faits différents ; W7 copie hors cycle ; W8 version d'analyse ; W9 preuve de réfutation | verts (§ 8.1, 8.4, 8.5) |
| V26 | collisions numériques d'index et d'ordinal | vert |
| V27 | dispense face à une copie à ordre ambigu | copie non empruntée, lignes stockées |
| V28 | index au-delà du domaine entier | règle fausse sans erreur, chemin existant |
| V29 | dispense et version d'analyse | § 8.5 |

### 12.2 Mordants D1

25 mordants distincts, tous tués (30 preuves d'élimination).

| Mutant | Mutation | Tué par |
|---|---|---|
| M1 | aucun retrait au dépôt | V1 ; 45c T1 |
| M2a / M2b | prédicat toujours vrai / sans postcondition | postcondition / V8, T5 |
| M3 / M3b | conformité supprimée / stockée seule | V7 / V23 |
| M4 | aucun retrait à l'activation | V11a ; T2 |
| M5 | clé textuelle au lieu de la comparaison numérique | V5 |
| M6 | cohérence supprimée (équivalent en comportement) | garde structurelle V19 |
| M7 | une copie à chaque redépôt | V18 |
| M8 | contrôle du verrou supprimé | V22 |
| M9 | gardes d'ordre ambigu supprimées | V21 |
| M10 | doublons ignorés comme candidats | 45c C1, ordre A |
| M11 | provenance non exigée | W1 |
| M12 | copie non conforme admise | W2 |
| M13 | version du doublon non exigée | W3 |
| M14 | garde d'ordre textuelle réintroduite | V26 ; V20 |
| M15 | copie d'un autre fichier admise | W4 |
| M16 | exclusion des doublons au dépôt réintroduite | W5 ; 45c W4 → Y |
| M17 | égalités d'empreinte et de faits de la copie supprimées | W6 |
| M18 | copie hors du cycle provisoire admise | W7 |
| M19 | dispense sans garde d'ordre ambigu | V27 |
| M20 | règle de la charge sans garde de domaine entier | V28 (erreur 22003) |
| M21 | doublon preuve de réfutation admis | W9 |
| M22 | dispense sans version d'analyse identique | V29 |
| M23 | copie du doublon sans version d'analyse identique | W8 |

Les égalités prises une à une (clôture, totaux) et le test « non vide » de la version
d'analyse sont en partie impliqués par d'autres conditions. Ce sont des mutants
équivalents partiels, notés par la relecture et non bloquants.

### 12.3 Lecture « Soldes à date » (45c)

T1, T2, T4, T5 et T7 sont verts et inchangés. C1 : § 8.1. Parcours W4 → Y : § 8.4.
P2-1 : caractérisation acceptée.

### 12.4 Oracle Q6 et équivalents CD / CF

**Oracle Q6** (avec D1 comme dans sa colonne « avant D1 ») :

| Étape | Résultat |
|---|---|
| E4 | `AVAILABLE`, 1130.00 |
| E5 | avec D1, `AVAILABLE` et source inchangée ; sans D1, `DAY_CONTESTED` |
| E6 | `DAY_CONFLICT` |
| E7 | `AVAILABLE`, 1137.00 |
| Variante « trois redépôts » | avec D1, une copie et E7 `AVAILABLE` ; sans D1, E7 `DAY_CONFLICT` |

**Équivalents CD / CF** (identiques avec et sans D1) :

| Scénario | Résultat |
|---|---|
| BDK | réfutations refusées les 18 et 19/10, acceptées le 20/10 |
| ORABANK | réfutations refusées du 24 au 26/10, acceptées le 27/10 |
| CF | correction du 01/11 acceptée avec la preuve du fichier du 31 ; redépôt du 31 sans effet |

Aucun attendu n'a été ajusté.

### 12.5 Suite Trésorerie

- **Copie LF** du candidat final : `TREASURY_V1_LOT1_PG17_REPLAY_PASS` (§ 8.3, § 11).
- **Worktree CRLF** : `upgrade` et `fresh` passent avec la même empreinte D1 que la copie
  LF (les fichiers D1 y sont en LF), puis arrêt au mordant m14. Son ancre multi-ligne ne
  correspond pas aux corps CRLF : c'est la limite antérieure à D1, documentée depuis
  l'itération 1.

### 12.6 Courses à sessions réelles (46)

| Course | Attente de B | Issue |
|---|---|---|
| C1 + C4 | 3,2 s | provisoire retirée à l'activation ; C4 : provisoire et deux doublons retirés |
| C2 + C5 | 3,2 s | retrait au dépôt ; C5 : promotion, puis redépôt retiré sans copie |
| C3 | 3,2 s | deux retraits, une copie, divergente intacte |

C1 = C2 et C4 = C5, y compris après la correction ultérieure. Aucun interblocage.

## 13. Erratum O2 (inchangé)

La voie `conflict → duplicate` existe statiquement (`supersede_daily_statement_unit`,
critère de mouvements seulement). La comparaison du lecteur inclut déjà ces deux statuts
et dépend des faits de version. Son efficacité sur les résidus réels (14 BDK, 8 ORABANK)
n'est pas démontrée. Aucun correctif ni nettoyage O2 dans ce lot.

## 14. Exclusions maintenues

- Aucun fichier hors des 19 de la liste blanche.
- Non modifiés :
  - `MASTER_CONTEXT.md`, `STATUS_REGISTRY.md`, `CTO_GO_QUEUE.md` ;
  - le lecteur et les migrations Trésorerie ;
  - les suites et mordants `treasury_v1_lot1` (hors runner) ;
  - toute migration historique, le code applicatif, `package.json`, le lockfile, `ci.yml`,
    l'artefact MCP, les fichiers d'environnement.
- Aucune seconde migration, aucune correction O2, aucun nettoyage de données, aucun
  refactor.
- Copies jetables (copies LF, sondes) dans l'espace temporaire, supprimées en fin de lot.

## 15. Revues indépendantes

| Itération | Avis | Traitement |
|---|---|---|
| 1 | réserves, aucun P0 | constats techniques corrigés ; P1-1, P2-1 et runner remontés au CTO, devenus C1, P2-1 et C3 |
| 2 | réserves, aucun P0 ni P1 | constats 4, 5, 6 et 8 corrigés et contre-vérifiés ; constats 1 (W4), 2 (W5), 7 (version d'analyse) et 9 (surface) remontés, puis arbitrés par le second verdict |
| 3, delta W5 et version d'analyse | **RÉSERVES, aucun défaut de code** | ci-dessous |

Points jugés conformes à l'itération 3 :
- retrait au dépôt gardé exactement comme à l'activation (mêmes trois sélections, même
  prédicat) ;
- doublons canoniques jamais retirés ;
- emprunt de la livraison du dépôt sain (charge vérifiée par F3, version d'analyse exigée) ;
- postconditions 0Z ;
- règle de version d'analyse fermée pour une valeur NULL, blanche ou faite d'espaces, et
  cohérente entre F1 et F4 ;
- garde de réfutation justifiée et non contournable par une course ;
- concurrence ;
- tests déterministes, sans assertion affaiblie.

| # | Constat | Gravité | Traitement |
|---|---|---|---|
| 1 | sur un état hérité, le retrait au dépôt peut retirer une source, un témoin `unit_clean` ou une preuve de clôture (fichiers BDK à date de référence) d'une journée déjà retenue, au moment d'un dépôt ultérieur ; l'effet converge vers l'autre ordre | P3 | documenté (RR2) |
| 2 | un doublon hérité n'est réévalué qu'à un dépôt D1 provisoire de la journée ou à une activation de sa version, pas à un dépôt de journée close | P3 | documenté (§ 8.6, RR2) |
| 3 | garde de réfutation : extension non demandée ; elle bloque aussi les réfutations révoquées ; W9 insère la réfutation en mode réplica (sans déclencheurs ni garde serveur) ; un scénario par commandes réelles serait plus probant (état atteignable avec des fichiers BDK à date de référence) | P3 | **acceptée par le CTO** dans sa forme actuelle ; réserve W9 conservée (§ 0) |
| 4 | le test « non vide » de la version d'analyse est redondant avec le stockage normalisé (`nullif(btrim(...))`) : mutant équivalent partiel | P3 | noté (§ 12.2), conservé en défense |

La relecture signale aussi que le pipeline réel renseigne la version d'analyse par une
constante (`structured-csv-0b`, `dailyV2BrowserPipeline.ts`) : un changement de parseur
n'est détecté que si cette constante change (RR13).

## 16. Diff summary

19 fichiers ; worktree non commité ; décompte hors fins de ligne, fichiers nouveaux comptés
par intention d'ajout (index rétabli ensuite) : 4 745 lignes ajoutées, 23 supprimées, dont
ce rapport (624), la migration (1 189), 45b (1 190), 45c (692), 45a (503), 46a–46h (189),
test de contrat (118), runners (75 / 9), README (51 / 3), suite 16 (114 / 11).

## 17. Risques résiduels

- **RR1** : la réponse `superseded` pour une livraison neuve peut surprendre ; aucune
  modification d'interface.
- **RR2 (états hérités)** :
  - une provisoire ou un doublon hérité justifié est retiré au prochain dépôt D1
    provisoire de la journée, ou à la prochaine activation de sa version ;
  - ce retrait peut faire disparaître une source, un témoin de propreté ou une preuve de
    clôture d'une journée déjà retenue, en convergeant vers l'ordre « promue puis
    déposée » ;
  - un dépôt de journée close ne déclenche pas ce retrait ;
  - aucun contrôle d'environnement n'est fait dans ce lot.
- **RR3** : F3 est une quatrième écriture de l'agrégation des lignes ; contrôlée par V20 et
  M3.
- **RR4** : le retrait passe par le cœur partagé ; couvert par V12, V24 et W1.
- **RR5** : une livraison identique non conforme, incohérente ou à ordre ambigu continue de
  contester (prudence).
- **RR6** : relevés réels non rejoués.
- **RR7 (W4)** : un doublon d'un autre fichier de même contenu reste source jusqu'au
  redépôt conforme de ce fichier. Si une réexportation bancaire produit des octets
  différents (en-tête horodaté, par exemple), ce cas pourrait être courant : hypothèse non
  vérifiée, aucun relevé réel consulté.
- **RR8** : contrôle `pg_locks` à chaque retrait ; logique sous verrou en READ COMMITTED.
- **RR9** : l'événement de réception d'une livraison retirée porte `canonical_unit_id`.
- **RR10** : la CI tourne sous `pwsh` Linux et Node 20 ; le rejeu local sous Windows
  PowerShell 5.1 et Node 22.
- **RR11** : l'empreinte brute et la version d'analyse sont déclarées par le client. Elles
  relient deux réceptions, elles n'authentifient pas un fichier. Un utilisateur habilité
  au dépôt pourrait obtenir le retrait d'un doublon R1-provisional de même version, mais
  jamais celui d'un doublon du canonical, et sans perte de lignes.
- **RR12** : le scénario `upgrade` exclut D1 par son nom ; une migration future postérieure
  à D1 demandera le même traitement.
- **RR13** : la version d'analyse du pipeline est une constante ; une dérive de parseur
  n'est couverte que si la constante est incrémentée.
- **RR14** : le témoin W9 de la garde de réfutation repose sur une ligne synthétique
  insérée en mode réplica.

## 18. Recommandation Claude Code

**PASS_WITH_RESERVES.**

La correction W5 est faite : un doublon justifié est retiré au dépôt avec exactement les
garanties de l'activation. Le parcours W4 → redépôt conforme de Y → correction est
démontré : une source, volume 4, lecture égale au témoin. La version d'analyse est
exigée dans les deux emprunts de copie.

Les attentes ont été fixées avant la correction, et leur échec avant correction est
démontré. Tous les contrôles sont verts et les 25 mordants D1 sont tués.

Réserves : notes P3 de la relecture (RR2, RR11 à RR14), reprises dans les quatre
réserves CTO du § 0.

**Verdict CTO : `PASS_WITH_RESERVES`** (§ 0). Acceptation locale, sans qualification
d'environnement.

## 19. Suites

1. Le verdict CTO est rendu (§ 0) ; la garde « preuve de réfutation » est acceptée dans
   sa forme actuelle, inchangée.
2. Le candidat est figé, commité et publié en draft PR pour contre-revue ; aucun merge,
   aucune mise en service.
3. Restent hors de ce lot, chacun soumis à un GO distinct :
   - le scénario W9 par les vraies commandes de réfutation ;
   - l'identification et la vérification des journées héritées avant toute application à
     un environnement exploité ;
   - toute migration staging ou production.
