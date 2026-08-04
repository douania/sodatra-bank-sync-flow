# 0Z1B Core — rapport d’intégration applicative locale

## Verdict

`PASS_LOCAL_APPLICATION_INTEGRATION_READY_FOR_INDEPENDENT_COUNTER_REVIEW`

La tranche verticale minimale Collections / Remises est intégrée localement sur le Core fusionné. Elle reste volontairement bornée à la préparation, au contrôle et à la justification des encaissements. Elle n’exécute aucun paiement et ne passe aucune écriture comptable.

## Référence et périmètre

- GO : `GO_0Z1B_CORE_LOCAL_APPLICATION_INTEGRATION_APPROVED`
- base exacte : `origin/main` à `3f514d86b0bc6757f7b6184d5d2af1961b2b3886`
- branche locale : `feat/0z1b-core-app-integration-local`
- aucune migration créée ou modifiée ;
- aucun accès Supabase distant ;
- aucun commit, push, PR ou déploiement.

## Tranche livrée

1. **Saisie manuelle d’une remise** : date, mode, client, banque du client, banque de dépôt SODATRA, montant, facture facultative, bordereau, chèque ou effet et échéance.
2. **Validation à deux acteurs** : la validation appelle le RPC Core et le serveur interdit à l’auteur de valider sa propre remise.
3. **Rapprochement contrôlé** : les crédits proposés sont filtrés sur le même compte de dépôt et la même devise ; le serveur réimpose cette contrainte. Les cas crédit exact et crédit net après agios sont couverts.
4. **Confirmation à deux acteurs** : le serveur interdit au proposant de confirmer sa propre proposition.
5. **Registre amélioré** : attendu, nominal réglé, agios observés, liquidité nette, preuve, dates déclarée et prouvée, reste et exception sont affichés séparément.

Les réacheminements, retraits, corrections, imports historiques, scans et habilitations restent disponibles dans le Core serveur mais ne sont pas exposés dans cette première tranche volontairement simple.

## Garde locale

La route `/collections-remittances`, sa navigation et tous les accès réseau du service sont refusés sauf si :

- `VITE_COLLECTIONS_CORE_LOCAL_ENABLED` vaut exactement `true` ;
- l’URL Supabase cible strictement `localhost`, `127.0.0.1` ou `::1`.

Les projets staging et production restent refusés même avec le drapeau local. Cette garde d’interface complète, sans remplacer, les capacités, ACL RPC et RLS serveur.

## Idempotence et erreurs partielles

Erratum après rejeu E2E : l'enchaînement initial de trois appels laissait un brouillon orphelin après un échec intermédiaire suivi d'un rechargement. Le candidat corrigé appelle désormais une RPC unique qui crée atomiquement le reçu, la remise, son premier élément et l'affectation éventuelle de facture. La clé opaque est conservée dans la session navigateur jusqu'au succès, sans y stocker les données métier. Les erreurs métier restent réduites à leur code `COLLECTION_*` sûr.

## Contrôles rejoués

- tests Collections Core après corrections E2E : `16/16 PASS` ;
- non-régression Daily v2 application : `99/99 PASS` ;
- ESLint ciblé sur tous les fichiers touchés : `PASS`, zéro constat ;
- build Vite : `PASS` ;
- TypeScript canonique `npx tsc -p tsconfig.app.json --noEmit` : `19 erreurs`, liste strictement identique à `origin/main`, donc `PASS_WITH_BASELINE` ;
- ESLint complet : `220 constats` (`209 erreurs`, `11 warnings`), liste strictement identique à `origin/main`, donc `PASS_WITH_BASELINE` ;
- `git diff --check` : `PASS`.

## Limites et prochaine porte

Un premier rejeu navigateur à deux acteurs a confirmé les parcours nominaux et découvert les défauts P1/P2 documentés dans `COLLECTIONS_REMITTANCES_0Z1B_CORE_LOCAL_APPLICATION_BROWSER_E2E_REPORT.md`. Les deux corrections sont `FIXED_LOCAL_PENDING_INDEPENDENT_COUNTER_REVIEW_AND_BROWSER_REPLAY`.

La prochaine porte recommandée est une contre-revue indépendante locale DB/sécurité et applicative du delta corrigé, suivie — si elle est positive — d’un GO distinct pour le rejeu navigateur ciblé. Aucun staging applicatif ni déploiement production n’est autorisé par le présent lot.
