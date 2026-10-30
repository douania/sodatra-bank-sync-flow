# PAYABLES-CHEQUES — drapeau de build « administration seule » en production

`GO_IMPLEMENT_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY_BUILD_FLAG`, 30 octobre 2026. Arbitrage CTO : option A, avec une exception strictement limitée au drapeau public `VITE_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY`.

**Lot de configuration et de contrat : aucun code métier, aucune garde ni liste blanche modifiée, aucune publication, aucune action Lovable ou Supabase. Les écritures métier et les exports restent fermés.**

## 1. Contexte
- **Préparation du 30 octobre** : le drapeau de la PR #153 ne pouvait pas atteindre la build Lovable de production. Le `.env` versionné est le seul canal que Lovable lit pour les `VITE_*`, et le contrat de sécurité §6, vérifié par un test de la CI, le limitait à trois variables Supabase.
- **Effet sans ce lot** : publié tel quel, `8c0600e` laisse le module refusé en production (« Le module chèques reste interdit en production »), y compris pour l'administrateur désigné.

## 2. Changements (cinq fichiers autorisés)
| Fichier | Changement |
|---|---|
| `.env` | Une seule ligne ajoutée : `VITE_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY=true`. Les trois valeurs Supabase restent strictement identiques. En-tête mis à jour, sans écrire l'affectation en commentaire. |
| `.env.example` | Le drapeau est documenté, avec une valeur vide par défaut. Le comportement des builds locales est décrit selon leur cible (§3). |
| `docs/SECURITY_CONTRACT.md` §6 | Liste fermée de quatre variables, dans cet ordre, le drapeau ne prenant que la valeur `true`. Ajouts : ce qu'est le drapeau, les builds locales, la conservation par Lovable non acquise (arrêt si la normalisation touche la ligne), l'aperçu Lovable, la distinction confinement / retour arrière, des interdits complétés. Toutes les interdictions antérieures sont conservées. |
| `src/features/daily-v2/dailyV2BundleSafety.synthetic.test.ts` | Liste fermée de quatre noms, dans cet ordre. Forme exacte exigée pour chaque ligne d'affectation, valeur `true` comprise. Seules les fins de ligne LF et CRLF sont admises : refus du CR isolé, de U+2028 et de U+2029. Refus explicite de tout drapeau de module local, staging ou Collections. Toutes les assertions antérieures sont conservées. |
| `docs/PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY_BUILD_FLAG_REPORT.md` | Ce rapport. |

**Inchangés** : `payablesRuntimeTarget.ts`, service, garde, page, liste blanche, migrations, Auth/RLS, dépendances, CI, artefact MCP, et tout `.env.local`.

## 3. Comportement établi
La garde de cible inchangée, évaluée sur les environnements que produit Vite (`loadEnv` du projet) :

| Environnement | Drapeau effectif | Verdict |
|---|---|---|
| `.env` seul : build Lovable, ou build locale sans `.env.local` | `"true"` | `production`, `admin-only` |
| Production sans drapeau (`8c0600e`) | absent | refus : « Le module chèques reste interdit en production » |
| `.env.local` staging **sans** neutralisation | `"true"` (hérité) | refus : « Le mode administration seule est réservé au projet de production » |
| `.env.local` staging **avec** `VITE_PAYABLES_CHEQUES_PRODUCTION_ADMIN_ONLY=` | `""` | `staging`, `full` |
| Production avec drapeau et drapeau staging | `"true"` | refus : « cible de production contradictoire » |
| Production avec `TRUE` | `"TRUE"` | refus : « Le module chèques reste interdit en production » |

Une build locale qui vise la production ouvre donc, depuis le poste, le même mode « administration seule » que la build publiée, sous la même autorisation serveur.

Build local : le bundle compile `productionAdminOnly:"true"`, et les drapeaux local et staging valent `undefined`. Cette preuve vaut pour Vite en local, **pas pour Lovable**.

## 4. Conservation par Lovable : non acquise
La normalisation native de `.env` par Lovable (`CLAUDE.md` §7bis) porte sur les trois valeurs Supabase. Qu'elle conserve la quatrième ligne **n'est pas démontré**. Avant toute publication, il faut :
1. vérifier en lecture seule que le `.env` du projet Lovable de production (`e52d9fce…`) contient la ligne, une fois la fusion synchronisée ;
2. après publication, vérifier que le bundle servi compile le drapeau à `true` et que sa provenance désigne le SHA fusionné.

Une normalisation qui retire ou modifie la ligne sort de la liste blanche §7bis et impose l'arrêt. Un drapeau perdu échoue en sécurité : le module reste refusé en production.

## 5. Confinement et retour arrière
- **Confinement serveur, sous GO de production dédié** : `payables_private.set_module_admin(<titulaire>, NULL, <motif>)` par l'opérateur. L'administration se ferme aussitôt pour tout le monde, interface publiée ou non. Ce retrait ne révoque pas les habilitations déjà attribuées par l'administrateur à d'autres comptes ; il n'y en a aucune à ce jour.
- **Retour arrière du frontend** : PR retirant le drapeau de `.env`, puis republication sous un GO de publication distinct ; le module redevient refusé en production.
- **Non prévues par le contrat** : la restauration d'une version dans Lovable et la dépublication du site. Leur usage relèverait d'une décision CTO.

## 6. Validations exécutées (local, sur la branche)
| Contrôle | Résultat |
|---|---|
| Base | `origin/main` = `8c0600e8a5a5f2207e21f7d09bc8b405a32d41f0`, vérifiée avant travail ; worktree isolé, autres checkouts intacts |
| Test de la liste fermée sur `.env` | 5/5 |
| Mutants de `.env` | **25 sur 25 tués**, chacun par l'échec du test lui-même. Variantes couvertes : sans drapeau, `false`, `TRUE`, guillemets, espace final, vide, doublon, ordre, drapeaux staging/local/Collections, autre `VITE_`, non-`VITE_`, clé backend, drapeau en commentaire seulement, URL staging, clé legacy, CR isolé (deux variantes), U+2028, commentaire en fin de ligne, `export`, espace initial, valeur multiligne, URL avec chemin. `.env` restauré à l'octet près. |
| Contournement par CR isolé sur la base | confirmé : le test de `8c0600e` acceptait un `.env` glissant une URL étrangère et une variable non `VITE_` ; fermé par ce lot |
| Suites de tests de la CI | 19/19 vertes, dont `test:daily-v2-application` 106/106 et `test:payables-cheques` 88/88 ; étapes complémentaires : tableau de bord 34, session 11, provenance du build 7, hygiène des journaux 4 |
| ESLint, comparé élément par élément à `8c0600e` | 178 / 11 de part et d'autre, aucun élément nouveau ni disparu |
| `tsc` application / projet Node | 16 erreurs, liste identique à la base / 0 |
| `npm run build` | réussi ; artefact MCP intact |
| `git diff --check` | conforme |

Non exécutés en local : les rejeux PostgreSQL 17 de la CI, car aucun SQL n'est touché.

## 7. Revue indépendante
- **Verdict** : aucun P1. Toutes les interdictions antérieures du §6 sont conservées, et la seule ouverture est ce drapeau avec la valeur `true`.
- **P2-1, corrigé** : contournement du test par un CR isolé, préexistant à la base (§6).
- **P2-2, corrigé** : le contrat affirmait à tort qu'une build locale non neutralisée refusait toujours le module (§3).
- **P3, traités dans les fichiers autorisés** :
  - arrêt si la normalisation Lovable touche la ligne ;
  - aperçu Lovable mentionné ;
  - GO de republication distinct ;
  - restauration et dépublication renvoyées à une décision CTO ;
  - portée du confinement précisée ;
  - formulation « autre valeur que `true` » limitée à la production.
- **P3 hors périmètre** : la documentation périmée est consignée en réserve.

## 8. Réserves
1. La conservation par Lovable reste à prouver (§4) : c'est un prérequis du GO de publication.
2. Les builds locales héritent du drapeau. Celles qui visent une autre cible doivent le neutraliser dans `.env.local` ; celles qui visent la production ouvrent l'administration seule depuis le poste, sous l'autorisation serveur. Le projet Lovable staging suit un autre dépôt et n'est pas concerné.
3. La limite serveur déjà acceptée est inchangée : l'administrateur garde, par l'API, les lectures que lui donnent ses capacités, dont `BANK_READ`.
4. Dès la fusion, l'aperçu Lovable du projet de production compilera aussi le drapeau, avec la même garde serveur.
5. Des documents hors du périmètre autorisé deviennent inexacts à la fusion et devront être mis à jour sous un GO documentaire : `docs/STATUS_REGISTRY.md` (drapeau « positionné nulle part ») et `docs/PAYABLES_CHEQUES_PRODUCTION_ADMIN_ACCESS.md`.

## 9. Suite proposée (GO distincts)
1. Contre-revue CTO, puis `GO_MERGE_PR_<n>`.
2. `GO_PRODUCTION_PAYABLES_CHEQUES_ADMIN_ONLY_PUBLISH` : vérification de `.env` dans Lovable, un seul « Update », contrôles après publication, usage limité à la création de la fiche de l'administrateur.
3. `GO_PRODUCTION_PAYABLES_CHEQUES_ESTABLISH_ADMIN_IDENTITY` : rattachement par l'opérateur.
4. GO documentaire pour les documents de la réserve 5.
