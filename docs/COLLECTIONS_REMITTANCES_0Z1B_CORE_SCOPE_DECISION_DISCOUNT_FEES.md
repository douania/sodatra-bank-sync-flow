# 0Z1B Core — décision de périmètre sur les retenues d'escompte

## Décision

Bank Sync Flow prépare, contrôle et justifie les encaissements. Il n'exécute pas de paiement, ne passe pas d'écriture comptable et ne reconstitue pas la comptabilité détaillée des frais bancaires.

Le parcours Collections retient donc uniquement deux preuves de crédit :

1. `EXACT_CREDIT`, présenté comme **Crédit au nominal** : le crédit bancaire est égal au nominal de la remise ;
2. `NET_OF_DISCOUNT`, présenté comme **Crédit net après retenue bancaire** : le crédit bancaire est inférieur au nominal et la différence observée est conservée séparément.

## Frais débités séparément

Lorsqu'une banque crédite le nominal puis inscrit une ou plusieurs lignes de débit pour les intérêts, commissions, taxes ou frais associés :

- la remise est rapprochée uniquement avec la ligne de crédit au nominal ;
- les débits séparés restent visibles dans Daily v2 et affectent naturellement le solde bancaire ;
- Collections ne cherche pas à rattacher automatiquement ou manuellement ces débits à la remise ;
- Collections ne calcule ni ne qualifie leur traitement comptable ou fiscal ;
- aucune ligne bancaire réelle, aucun montant réel et aucune identité réelle ne sont reproduits dans le candidat.

La capacité serveur historique `FEES_SEPARATE` reste présente mais n'est pas exposée dans la tranche applicative Core. Elle ne constitue pas un parcours utilisateur autorisé par ce lot.

## Présentation

Le registre emploie **Retenue bancaire observée** plutôt que **Agios observés**. Cette valeur décrit uniquement la différence constatée lorsque la banque crédite directement un montant net. Elle ne prétend pas reconstituer tous les frais bancaires ni produire une écriture comptable.

## Conséquence sur le packaging

Cette décision ne nécessite ni nouvelle migration, ni modification SQL, ni rapprochement supplémentaire, ni extension du périmètre fonctionnel. Elle simplifie l'interface et ne bloque pas le packaging local du candidat après réussite des contrôles applicatifs.
