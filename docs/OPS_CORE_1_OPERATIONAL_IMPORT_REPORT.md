# OPS-CORE-1 — Précontrôle opérationnel des imports

## Statut

`LOCAL_VALIDATED — PR_CANDIDATE` — 2026-08-13. Le lot est rebasé sur
`origin/main` @ `5d93e31ecf05d0e17dafa3515d775caaa0a02ca1`. Aucun accès
Supabase live, SQL, migration, changement Auth/RLS ou déploiement n'a été
effectué.

## Objectif

Empêcher qu'un lot déposé dans `/upload` démarre un traitement ou une écriture
alors qu'il contient un fichier vide, dupliqué, non supporté, non identifié ou
un conflit entre plusieurs documents à cardinalité unique.

## Contrat livré

- formats d'entrée admis : XLSX, XLS, CSV et PDF ;
- familles reconnues : Collection Report, Fund Position, Client
  Reconciliation, Internal Book et rapports BDK/ATB/BICIS/ORA/SGBS/SGS/BIS ;
- les relevés BRIDGE structurés sont orientés explicitement vers Daily v2 au
  lieu d'être envoyés au pipeline legacy de `/upload` ;
- la compatibilité réelle format/document est vérifiée avant traitement :
  Collection Report et Internal Book en Excel, Fund Position et rapports
  bancaires en Excel/PDF, CSV structurés via Daily v2 ;
- Client Reconciliation est affiché comme non opérationnel et bloqué au lieu
  de simuler un import alors que le moteur réel n'est pas connecté ;
- tout document inconnu est bloqué avant traitement ;
- une copie exacte supplémentaire est signalée et bloque le lot ;
- plusieurs Fund Position ou plusieurs Client Reconciliation bloquent le lot :
  aucun choix silencieux du fichier le plus récent ;
- chaque fichier affiche son type, son statut et ses motifs de blocage ;
- le bouton de traitement reste désactivé tant que le lot n'est pas intégralement prêt ;
- le service aval applique aussi le refus fail-closed si l'interface est contournée ;
- les gardes staging/production existantes restent inchangées.

## Fichiers du lot

- `src/services/importPreflightService.ts`
- `src/services/importPreflightService.synthetic.test.ts`
- `src/services/uploadRuntimeGuard.synthetic.test.ts`
- `src/pages/FileUpload.tsx`
- `src/services/fileProcessingService.ts`
- `package.json`
- `.github/workflows/ci.yml`
- `docs/OPS_CORE_1_OPERATIONAL_IMPORT_REPORT.md`
- `docs/STATUS_REGISTRY.md`
- `docs/MASTER_CONTEXT.md`

## Validation locale

- précontrôle synthétique : 10/10 tests verts ;
- ESLint ciblé sur les cinq fichiers TypeScript du lot : zéro problème ;
- ratchet ESLint global : 209 erreurs et 11 warnings, sous les plafonds CI de
  212 erreurs et 223 problèmes totaux ;
- typecheck comparatif : 20 diagnostics sur `origin/main`, 20 sur le lot et
  zéro nouveau diagnostic après normalisation des numéros de ligne ;
- les 12 suites applicatives de la matrice CI passent : 466 tests recensés,
  465 exécutés avec succès sous Node 24 et un harness upload réservé à Node 20 ;
- build Vite production : vert, worker PDF émis ;
- contrat OPS-CORE-3 post-build : 4/4 tests verts, aucun appel direct
  `console.*` ni `debugger` dans le JavaScript de production.

## Limites explicites

Ce pack fiabilise l'entrée du parcours existant. Il ne rend pas atomiques les
écritures multi-tables de `saveBankReport`/`saveFundPosition`, ne crée pas le
moteur de rapprochement réel et n'ajoute aucun nouveau format bancaire. Ces
chantiers restent des packs fonctionnels séparés avec qualification DB/sécurité
adaptée.
