# OPS-CORE-3 — Hygiène des logs frontend de production

## Statut

`LOCAL_IMPLEMENTED`

## Objectif

Empêcher le bundle navigateur de production d'émettre des diagnostics pouvant
contenir des noms de fichiers, montants, identifiants métier, objets parsés ou
résultats d'analyse. Les diagnostics de développement restent disponibles.

## Diagnostic

Le smoke authentifié OPS-CORE-2 a observé 168 messages informatifs au chargement
du Dashboard. L'inventaire statique confirme que les traces sont transversales :
pages, parsers bancaires, pipelines d'import, rapprochement et services de
persistance. Une réécriture fichier par fichier aurait mélangé sécurité,
refactor de dette historique et logique bancaire critique.

## Correctif

- `vite.config.ts` applique une politique esbuild uniquement lorsque le mode
  vaut exactement `production` ;
- les appels `console.*` et les instructions `debugger` sont retirés du bundle
  navigateur de production ;
- le mode `development` conserve les diagnostics existants ;
- un contrat automatisé inspecte les fichiers JavaScript réellement générés et
  refuse toute invocation directe de `console.*` ou instruction `debugger` ;
- la CI exécute ce contrat immédiatement après le build de production.

La suppression esbuild de `console` retire également l'évaluation de ses
arguments. L'inventaire des appels actuels a donc été contrôlé avant le choix :
les appels imbriqués observés servent au formatage ou à la construction du
diagnostic (`toLocaleString`, `toFixed`, `map`, `filter`, `slice`, `join`,
`substring`, résumé pur), sans mutation DB, état applicatif ou effet réseau.

## Périmètre

Fichiers du pack :

- `vite.config.ts` ;
- `src/config/productionLogHygiene.ts` ;
- `src/config/productionLogHygiene.synthetic.test.ts` ;
- `.github/workflows/ci.yml` ;
- le présent rapport ;
- `docs/STATUS_REGISTRY.md`.

## Sécurité et environnement

- aucune donnée bancaire réelle ajoutée ou reproduite ;
- aucun secret ajouté ou lu ;
- aucun accès Supabase live ;
- aucun SQL ni migration ;
- aucune modification Auth/RLS ;
- aucun déploiement ni changement Lovable ;
- aucun comportement de développement supprimé.

## Validation locale

- build Vite production : PASS ;
- contrat bundle production (`.js` et `.mjs`) : 4/4 PASS ;
- smoke du bundle compilé : accueil chargé puis redirection protégée vers
  `/auth`, 0 message console sur les deux parcours ;
- ESLint : baseline et branche identiques, 209 erreurs / 11 warnings ;
- TypeScript : baseline et branche identiques, 20 erreurs historiques ;
- suites canoniques ciblées : 415/415 PASS hors `upload-guard` ;
- Collections Core : 27/27 PASS ;
- `upload-guard` : 11/12 sur la branche et 11/12 sur `origin/main`, même échec
  environnemental préexistant sous le runtime Node local (`import.meta.env`
  absent avant le stub Supabase) ; aucune nouvelle régression ;
- `git diff --check` : PASS.

## Risques résiduels

- la production ne disposera plus des traces console pour le diagnostic ; une
  future observabilité devra être structurée, expurgée et explicitement
  autorisée ;
- tout futur argument de `console.*` ayant un effet de bord serait supprimé du
  build production. La review de code doit donc continuer à interdire les
  mutations dans les arguments de logs ;
- la correction n'est pas active sur le site publié tant que la PR n'est pas
  fusionnée puis le runtime republié sous des GO distincts.

## Verdict local

`PASS_WITH_RESERVES` — correctif et gate de bundle conformes ; dette de test
`upload-guard` strictement identique à la baseline locale.
