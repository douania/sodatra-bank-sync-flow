# OPS-CORE-1 — Précontrôle opérationnel des imports

## Statut

`CLOSED — PRODUCTION_VALIDATED` — 2026-08-13. La PR #128 est fusionnée dans
`main` au commit `dadbbf650bb579911c8971f9bff63aa34ec807fe`. Le comportement
d'import a été validé sur staging, puis le même runtime a été publié en
production avec le verrou de mutation production conservé.

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
- un doublon probable partageant le même nom, la même taille et la même date
  de modification est signalé et bloque le lot ;
- plusieurs Fund Position ou plusieurs Client Reconciliation bloquent le lot :
  aucun choix silencieux du fichier le plus récent ;
- chaque fichier affiche son type, son statut et ses motifs de blocage ;
- le bouton de traitement reste désactivé tant que le lot n'est pas intégralement prêt ;
- le service aval réutilise la classification normalisée du précontrôle et
  applique aussi le refus fail-closed si l'interface est contournée ;
- les gardes staging/production existantes restent inchangées.

## Correction post contre-review indépendante

La contre-review indépendante du HEAD initial `dd71bdf` a rendu
`PASS_WITH_RESERVATIONS` avec un correctif obligatoire : la classification par
nom du service aval utilisait encore des sous-chaînes plus permissives que le
précontrôle UI. Le correctif aligne les deux surfaces sur
`detectImportDocument`, conserve le repli d'analyse de contenu pour les fichiers
Excel au nom non concluant et route explicitement `INTERNAL_BOOK`.

Les réserves mineures associées sont également traitées : le message de doublon
décrit désormais l'heuristique réellement utilisée, les erreurs de cardinalité
ne dupliquent plus le premier fichier à partir du troisième singleton et un test
comportemental du service couvre les cas de divergence signalés.

## Livraison Git et CI

- PR #128 fusionnée dans `main` :
  `dadbbf650bb579911c8971f9bff63aa34ec807fe` ;
- source fonctionnelle validée avant merge :
  `96afef954c0d8d1240d3b4dc1a8cbe741dea3326` ;
- CI post-merge GitHub Actions : **PASS** ;
- delta fonctionnel par rapport à la base `5d93e31` : dix fichiers, aucune
  migration, aucun SQL et aucun changement Auth/RLS.

## Validation staging

Le runtime a été synchronisé sur le projet Lovable staging exact
`8c508b94-d03f-4165-ab2b-7a3cd52d2d2b`, version
`a8443dc016a02945a1a48547f3ff03bd35dd3b17`, en conservant exclusivement la
cible Supabase staging `gbbsqcscryygqlmqncyv`. Le build a réussi, puis le
domaine staging `cash-sync-wiz.lovable.app` a été publié et validé.

Les E2E staging en session authentifiée ont confirmé :

- le refus des extensions non supportées et des documents non identifiés ;
- l'orientation explicite des relevés BRIDGE vers Daily v2 ;
- le blocage de Client Reconciliation tant que son moteur réel est absent ;
- le refus des formats documentaires incompatibles ;
- le blocage des conflits entre plusieurs Fund Position ;
- la détection d'un doublon probable ;
- l'état `Prêt` d'un Collection Report XLSX conforme ;
- le bouton de traitement désactivé dès qu'un fichier est bloqué.

Aucun bouton de traitement n'a été actionné. Aucune mutation métier, requête
SQL, migration ou donnée bancaire réelle n'a été utilisée. Les fichiers de test
étaient synthétiques et ont été supprimés après validation.

## Validation production

### Préflight et publication

Le projet Lovable production exact
`e52d9fce-f1b4-46f8-900c-c559a6eb2115` était `ready` et aligné sur le merge
Git `dadbbf650`. Sa configuration contenait uniquement les trois variables Vite
attendues et ciblait exclusivement le projet Supabase production
`leakcdbbawzysfqyqsnr`, sans nom de clé privilégiée.

La publication production a créé le déploiement
`ee3a7c51-32c4-419d-80cd-baf32339cb10` sur
`sodatra-bank-sync-flow.lovable.app`. Le nouveau bundle
`index-B95fw9H2.js` contient le précontrôle OPS-CORE-1, l'orientation BRIDGE et
le blocage Client Reconciliation.

### Smoke post-publication

- une session non authentifiée est redirigée vers `/auth`, sans lecture métier ;
- une session authentifiée charge `/upload` sans erreur ;
- le garde `Production en lecture seule` reste affiché ;
- aucun sélecteur de fichier ni bouton de traitement n'est exposé ;
- le trafic Supabase observé cible uniquement `leakcdbbawzysfqyqsnr` ;
- aucune mutation métier, erreur ou alerte console n'a été observée.

Le précontrôle ne peut volontairement pas être exercé par un traitement réel en
production, puisque le garde de cible interdit l'import avant même la sélection
d'un fichier. La preuve comportementale complète est donc portée par staging ;
la preuve production couvre la présence du code publié, l'authentification, la
cible réseau et le maintien du refus de mutation.

## Sécurité et retour arrière

OPS-CORE-1 ne nécessite aucune migration DB. Aucun SQL, changement Auth/RLS,
secret, fichier bancaire réel ou écriture Supabase n'a été introduit pendant sa
livraison. Le bundle production précédent `index-CPlDAUVr.js` et la base Git
`5d93e31ecf05d0e17dafa3515d775caaa0a02ca1` constituent les ancres consignées
avant publication. Tout retour arrière exigerait un GO production distinct pour
restaurer une version antérieure et la republier.

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
- les 12 suites applicatives de la matrice CI passent localement : 467 tests
  recensés, 465 exécutés avec succès sous Node 24 et deux contrôles
  comportementaux upload réservés au runtime CI ;
- build Vite production : vert, worker PDF émis ;
- contrat OPS-CORE-3 post-build : 4/4 tests verts, aucun appel direct
  `console.*` ni `debugger` dans le JavaScript de production.

## Limites explicites

Ce pack fiabilise l'entrée du parcours existant. Il ne rend pas atomiques les
écritures multi-tables de `saveBankReport`/`saveFundPosition`, ne crée pas le
moteur de rapprochement réel et n'ajoute aucun nouveau format bancaire. Ces
chantiers restent des packs fonctionnels séparés avec qualification DB/sécurité
adaptée.

## Clôture

OPS-CORE-1 est clos. Le précontrôle fail-closed est fusionné, couvert par la CI,
validé fonctionnellement sur staging et présent dans le runtime production. La
production reste en lecture seule et aucune activation d'import production
n'est incluse dans ce lot.
