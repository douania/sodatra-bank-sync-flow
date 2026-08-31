# Daily v2 — Session et accès : durcissement UX

## Qualification

- GO : `GO_IMPLEMENT_DAILY_V2_SESSION_AND_ACCESS_UX_HARDENING`.
- Base : `be8555c541846b63a98c39decf1ba697c0813c9d` (PR #140 fusionnée).
- Branche : `codex/daily-v2-session-and-access-ux-hardening`, créée depuis la base vérifiée, arbre propre.
- Niveau : très approfondi pour les frontières UI et les réponses asynchrones ; aucune modification Auth/RLS, RPC, reader financier ou permission serveur.
- Livrable autorisé : pack local, tests synthétiques, contre-review Claude, commit/push/draft PR. Aucun merge/environnement.
- Préflight : premier fetch interrompu par une indisponibilité réseau ; second fetch réussi avant création de branche ou patch. Tree précédente identique à la base.

## Liste blanche

- `src/App.tsx` : messages de la route Daily v2 uniquement.
- `src/pages/DailyStatementV2.tsx` : enveloppe session, états affichés, cache local et callbacks UI.
- `src/features/daily-v2/dailyV2Access.ts`, `dailyV2AccessState.ts`, `dailyV2AccessState.synthetic.test.ts` : état de session/actualisation des droits, sans changer les rôles autorisés.
- `src/features/daily-v2/DailyV2Reporting.tsx` : invalidation et réponses tardives de l'UI, calculs/services/export inchangés.
- `src/features/daily-v2/session/` : nouveaux composants/petits helpers et tests dédiés au pack.
- `src/features/daily-v2/dashboard/DailyV2OperationalDashboard.tsx`, `DailyV2DashboardView.tsx`, `DailyV2DashboardView.synthetic.test.tsx` : retours d'accès et tests, sans modifier les calculs ni le reader.
- `src/features/daily-v2/dailyV2ApplicationContract.synthetic.test.ts` : actualisation des assertions de raccordement UI concernées uniquement.
- `.github/workflows/ci.yml` : ajout des suites du pack uniquement.
- `tests/daily-v2-session/` : harness navigateur loopback, mocks exclusivement synthétiques, aucune connexion externe.
- Ce rapport, `docs/MASTER_CONTEXT.md`, `docs/STATUS_REGISTRY.md` : statut du pack.

Interdits : AuthContext/ProtectedRoute, client Supabase, services/RPC, calculs financiers, parsers, migrations/SQL, `.env`, package/lockfiles, artefact MCP et tout environnement. Pas de fichier bancaire réel. STOP si besoin hors liste.

## Diagnostic initial

- Badge `Session requise` statique malgré `useAuth().user` disponible.
- Route Daily v2 ne neutralisant pas les rôles en cache pendant un refetch ; dashboard déjà plus restrictif.
- Queries métier Daily v2 non isolées par utilisateur ; état de formulaire/dialogues et callbacks de mutation pouvant survivre à une transition d'accès.
- Reporting UI conservant son résultat pendant une modification de filtre.

## Baseline locale mesurée avant patch

Sur la tree exacte de la base, dépendances locales existantes, aucun cache déplacé ni installation :

- ESLint via `ESLint.lintFiles(['.'])` : 180 erreurs, 11 warnings ; diagnostics conservés pour comparaison item par item.
- `tsc -p tsconfig.app.json --noEmit --pretty false` : 17 erreurs préexistantes ; sortie conservée pour comparaison.
- Suites application + reporting + dashboard + accessState : 211 PASS, 0 FAIL/SKIP.

## Implémentation locale

- Badge issu de l'état de session, messages distincts pour connexion, vérification, droits refusés et lecture indisponible ; aucun identifiant ou token affiché.
- Pendant un chargement/refetch/échec de rôles, aucune ancienne liste de rôles n'autorise la vue. Les rôles autorisés restent inchangés.
- Workspace Daily v2 remonté par identité/ensemble de rôles, cache QueryClient privé à cette durée d'accès et détruit au démontage. Formulaires, fichier en mémoire, payload préparé, dialogues, résultats et caches ne traversent pas cette frontière.
- Callbacks de mutations protégés par une génération de vue ; vérification après les étapes asynchrones UI. Une opération déjà acceptée par le serveur n'est pas annulée : ne jamais réessayer aveuglément.
- Résultat de préparation invalidé si le formulaire change pendant son calcul. Rapport retiré immédiatement quand ses filtres changent ; ancienne réponse et notification refusées.
- Verrou en cours de lecture/refetch ou en erreur : commandes d'écriture suspendues. Un verrou maître ouvert n'est pas présenté comme une autorisation suffisante : droits/scopes serveur toujours requis. Le parse-only local reste disponible pour les rôles qui y ont droit.
- Dashboard : frontière par utilisateur, retours d'accès explicites ; reader snapshot, calculs, export et contrôleur métier inchangés.

## Validations après patch

| Vérification | Résultat local |
|---|---|
| Application + reporting + dashboard + accessState + session (`tsx --test`) | 220 PASS, 0 FAIL/SKIP ; 211 tests de base + 9 nouveaux |
| `vite build` | PASS ; warnings préexistants de chunks/imports mixtes ; artefact MCP inchangé |
| Contrat logs production sur le build généré | 4 PASS |
| ESLint complet | 180 erreurs / 11 warnings, diagnostics identiques à la base hors décalages de lignes ; zéro nouveau diagnostic |
| Typecheck app | 17 erreurs préexistantes, aucune dans le delta |
| `git diff --check` | PASS |
| Harness React réel sous StrictMode, navigateur local | 10 scénarios PASS, zéro mutation/export ni connexion externe |

Harness reproductible : lancer `node tests/daily-v2-session/serve.mjs`, ouvrir l'URL loopback imprimée et cliquer « Exécuter les scénarios ». Les services/Auth sont remplacés exclusivement par des fixtures synthétiques, le client Supabase réel est interdit à la compilation et la CSP interdit les connexions. Aucun `.env` lu, fichier bancaire ouvert ni bundle de harness écrit sur disque.

Scénarios navigateur : session connectée/verrou fermé ; refetch puis révocation des rôles ; changement A→B avec réponse canonical A tardive ; erreur de lookup/logout/session en chargement ; polling réel du verrou après 30 secondes, ancien `true`, champ admin conservé avec focus/caret/saisie, bouton désactivé pendant la réponse différée puis réactivé ; verrou pending/ouvert/indisponible ; callbacks tardifs succès/erreur après démontage sous StrictMode ; modification de filtres reporting pendant/après génération ; dashboard refetch/logout avec lecture tardive ; nettoyage et compteur d'opérations nul. Les unitaires couvrent aussi l'ancien verrou `true` pendant refetch et le composant de feedback réellement partagé avec la route.

La CI conserve ses seuils et commandes existants ; ajout des tests session/accessState uniquement. Aucun package, lockfile ou cache de dépendances modifié.

## Sécurité et réserves

- Aucune donnée réelle, aucun secret, SQL, migration, accès Supabase live, changement AuthContext/ProtectedRoute/RLS ou autorisation serveur.
- Frontière UI uniquement, jamais une nouvelle barrière serveur. Une révocation non encore observée par le client reste du ressort des contrôles serveur ; pas de souscription temps réel aux rôles ajoutée.
- Pas d'annulation d'une RPC ni d'un téléchargement déjà engagé. L'export XLSX existant n'est pas réécrit ; seul son démarrage/callback UI est gardé par la durée de vue.
- Validation locale synthétique, pas de JWT réel, de matrice multi-rôles réelle ni de trafic concurrent en staging/production. Le harness local n'est pas exécuté dans la CI ; les tests unitaires du pack y sont raccordés.
- Chaque revalidation des droits peut fermer le formulaire en cours, même si le rôle finalement confirmé est identique : choix fail-closed explicite, signalé dans l'UI, notamment au retour d'onglet/reconnexion si les droits sont périmés après cinq minutes. Le polling du verrou (distinct du refetch de rôles) conserve les saisies admin mais suspend les actions.
- Pas de revendication de correction déjà publiée : le runtime production reste celui du pack précédent.

## Contre-review et statut

Première revue Claude Code (abonnement Max, mode read-only, modèle observé `claude-opus-5[1m]`) sur l'index initial `9c66293809e6fb8b8b7693ad88d95dc77a447770` : contenu jugé `PASS_WITH_RESERVES`, mais **préflight BLOCKED** (Git introuvable dans son shell, chemins alternatifs refusés). Ce n'est pas une certification du diff. Recontrôle CTO : tree exacte confirmée, aucun unstaged, diff-check PASS ; `DailyV2DashboardPanel.tsx` et ses filtres soumis proviennent bien de la base PR #139 et ne sont pas modifiés.

Réconciliation des findings avant revalidation indépendante :

| Finding Claude | Arbitrage/correction bornée |
|---|---|
| P1-1, perte de focus admin au polling du verrou | Montage du formulaire limité au rôle + capacité statique ; quatre boutons et quatre handlers restent soumis à `canAdminister`. Test React du polling réel de 30 s avec focus/caret/saisie conservés et action désactivée. Les boutons de décision des lignes restent temporairement masqués pendant la vérification : réserve UX mineure acceptée, sans perte de texte (le dialogue ouvert reste monté, confirmation désactivée). La table partagée n'est pas modifiée. |
| P2-1, déclencheurs de destruction mal expliqués | Retour d'onglet et reconnexion après cinq minutes explicités dans l'UI et ici ; fail-closed conservé, pas de maintien caché d'un payload après incertitude des rôles. |
| P2-2, effet layout enfant avant activation | Invariant documenté dans la frontière : mutations sur événement utilisateur uniquement, jamais dans un effet layout de montage enfant. Aucune mutation automatique existante. |
| P2-3, badge local à paramètres constants | Lecture directe de `useAuth` dans le workspace pour le badge ; garde parente conservée. |
| P2-4 / P2-5, messages divergents et accessibilité | Composant de feedback commun route/page, `role=status` ou `role=alert`, test SSR des états et raccordement des deux consommateurs. Aucune logique de routage/Auth modifiée. |
| P2-6, relecture à chaque changement de tab | Non retenu comme défaut actuel : les `useQuery` métier résident dans le workspace, hors des `TabsContent`, et ne sont pas démontés à chaque tab. Reporting ne relit que sur clic. `gcTime:0` conservé pour les queries réellement désobservées. |
| P2-7, glob CI | Deux extensions `.ts` et `.tsx` explicitement raccordées avec tests présents pour chacune. |

Le stub des permissions du harness inclut désormais aussi la capacité statique deposit, sans prétendre tester la véritable matrice de cible (celle-ci reste couverte séparément par les unitaires existants).

Revalidation Claude Code : **`PASS_WITH_RESERVES`**, aucun P0/P1 ouvert. Préflight exécuté avec le Git absolu : fetch OK, HEAD/origin-main conformes, 23 fichiers stagés dans la liste blanche, aucun unstaged/untracked, diff-check PASS. Le reviewer a certifié le contenu worktree = index ; ses commandes additionnelles de comparaison aux hashes de tree ont été refusées par sa liste de permissions. Il ne revendique donc pas cette preuve cryptographique ni l'exécution des tests.

Complément CTO après son verdict : `git diff --cached 128100d5dfd3cfedd62ca26eb4fae33d086ef284 --exit-code` vide et exit 0 ; comparaison mécanique à la première tree effectuée, 12 fichiers du correctif uniquement. Après cette revalidation, seuls ce rapport, MASTER_CONTEXT et STATUS_REGISTRY sont finalisés ; code/tests/CI restent identiques à la tree revue.

Preuve de non-régression conservée dans les sorties de la session CTO : comparaison des 191 diagnostics lint par multiensemble `(fichier, règle, sévérité, message)` avec occurrences conservées (positions seules neutralisées) : **0 ajouté, 0 supprimé**. La sortie TypeScript finale est **strictement identique** à celle mesurée avant patch. Ce n'est pas une comparaison au seul plafond CI. Dépendances locales existantes conservées ; la CI avec `npm ci` reste la validation de référence de la lockfile.

Réserves finales acceptées : affichage transitoire des boutons de décision et de l'option backfill pendant polling ; invariant « pas de mutation dans un effet layout enfant » documenté mais non linté ; pas de preuve JWT/RLS réelle ni annulation d'une opération/export déjà lancé. Le risque supposé de relecture à chaque tab est écarté par la position réelle des hooks. Aucun élargissement Auth/RLS, table partagée, calculs ou permissions serveur.

### Fichiers livrés (23)

- `.github/workflows/ci.yml`
- `docs/DAILY_V2_SESSION_AND_ACCESS_UX_HARDENING_REPORT.md`
- `docs/MASTER_CONTEXT.md`
- `docs/STATUS_REGISTRY.md`
- `src/App.tsx`
- `src/pages/DailyStatementV2.tsx`
- `src/features/daily-v2/DailyV2Reporting.tsx`
- `src/features/daily-v2/dailyV2Access.ts`
- `src/features/daily-v2/dailyV2AccessState.ts`
- `src/features/daily-v2/dailyV2ApplicationContract.synthetic.test.ts`
- `src/features/daily-v2/dashboard/DailyV2DashboardView.tsx`
- `src/features/daily-v2/dashboard/DailyV2DashboardView.synthetic.test.tsx`
- `src/features/daily-v2/dashboard/DailyV2OperationalDashboard.tsx`
- `src/features/daily-v2/session/DailyV2AccessFeedback.tsx`
- `src/features/daily-v2/session/DailyV2AccessFeedback.synthetic.test.tsx`
- `src/features/daily-v2/session/DailyV2SessionBoundary.tsx`
- `src/features/daily-v2/session/dailyV2Session.synthetic.test.ts`
- `src/features/daily-v2/session/dailyV2SessionLifetime.ts`
- `src/features/daily-v2/session/dailyV2SessionPresentation.ts`
- `src/features/daily-v2/session/dailyV2SessionScope.ts`
- `tests/daily-v2-session/fixtures.tsx`
- `tests/daily-v2-session/harness.tsx`
- `tests/daily-v2-session/serve.mjs`

Verdict CTO : **`PASS_WITH_RESERVES — LOCAL_REVIEWED — READY_FOR_DRAFT_PR`**. Les serveurs et onglets synthétiques sont fermés ; aucun cache de dépendances déplacé. Commit/push/draft PR autorisés par le GO initial ; merge et toute action d'environnement restent interdits sans leur GO distinct.
