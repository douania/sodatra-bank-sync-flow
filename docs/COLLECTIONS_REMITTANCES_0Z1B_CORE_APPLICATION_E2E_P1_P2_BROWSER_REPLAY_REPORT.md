# 0Z1B Core — rejeu navigateur local des corrections P1/P2

## Verdict

`PASS_BROWSER_REPLAY_AFTER_FIXES`

Les deux corrections issues du premier rejeu E2E sont confirmées sur une pile Supabase locale jetable :

- P1 `P1_RELOAD_LOSES_WORKFLOW_IDEMPOTENCY_AND_ORPHANS_DRAFT` : `FIXED_LOCAL_BROWSER_REPLAYED` ;
- P2 `P2_NET_LIQUIDITY_NOT_DISPLAYED_IN_REGISTER` : `FIXED_LOCAL_BROWSER_REPLAYED`.

Aucun accès distant, aucune donnée réelle, aucun staging et aucune production.

## Périmètre

- GO : `GO_0Z1B_CORE_APPLICATION_E2E_P1_P2_BROWSER_REPLAY_DOCKER_APPROVED` ;
- branche locale : `feat/0z1b-core-app-integration-local` ;
- HEAD de départ : `3f514d86b0bc6757f7b6184d5d2af1961b2b3886` ;
- PostgreSQL : `17.6` ;
- pile Supabase officielle locale exécutée avec Docker ;
- 39 migrations du dépôt rejouées dans l'ordre ;
- deux utilisateurs synthétiques distincts ;
- aucune clé, aucun mot de passe et aucune donnée de production dans ce rapport.

## P1 — atomicité, rechargement et absence d'orphelin

Un trigger local temporaire a provoqué volontairement une erreur lors de l'insertion finale de l'affectation de facture, après l'entrée dans la RPC atomique. L'interface a affiché :

> Enregistrement atomique de la remise refusé. Aucun brouillon incomplet n’a été conservé.

La base a ensuite été contrôlée avant toute nouvelle tentative :

| Objet | Compteur après l'échec |
|---|---:|
| reçu cible | 0 |
| remise cible | 0 |
| élément cible | 0 |
| affectation facture cible | 0 |
| commandes d'idempotence de la tentative | 0 |

Le défaut synthétique a été retiré, puis la page a été rechargée. La session de l'acteur A est restée active et le formulaire métier était vide. La même opération a été ressaisie depuis l'interface et a abouti avec le message `Remise enregistrée en brouillon.`

Contrôle final :

| Objet | Compteur après reprise |
|---|---:|
| reçu cible | 1 |
| remise cible reliée | 1 |
| élément cible | 1 |
| affectation facture cible | 1 |
| remise orpheline globale | 0 |

Le stockage navigateur n'a pas été lu directement. La persistance de la clé opaque est couverte par le test de contrat et la contre-revue indépendante ; le présent rejeu valide le comportement utilisateur après échec et rechargement, ainsi que l'absence d'objet partiel ou dupliqué.

## P2 — nominal, agios et liquidité nette

Scénario exécuté :

- effet nominal : `1 000,00 XOF` ;
- banque de dépôt : BDK / BANK A ;
- crédit bancaire observé : `950,00 XOF` ;
- preuve : `NET_OF_DISCOUNT` ;
- agios observés : `50,00 XOF`.

Après sélection de la remise, la ligne de crédit de BANK B, pourtant du même montant nominal, n'était plus proposée. Seules les lignes de BANK A restaient éligibles.

L'acteur A a saisi la remise et proposé le rapprochement. L'acteur B a validé la remise puis confirmé le rapprochement. La base confirme deux identités différentes pour `proposed_by` et `decided_by`.

Le registre affichait explicitement :

| Attendu | Nominal réglé | Agios observés | Liquidité nette | Preuve | Reste | État |
|---:|---:|---:|---:|---|---:|---|
| 1 000,00 XOF | 1 000,00 | 50,00 | 950,00 | `DISCOUNT_CREDITED` | 0,00 | `CREDITED` |

La preuve serveur correspondante est `settled_gross_amount = 1000.00`, `observed_fee_amount = 50.00`, `net_liquidity_amount = 950.00`, `evidence_basis = NET_OF_DISCOUNT` et `allocation_status = CONFIRMED`.

## Contrôles complémentaires

| Contrôle | Résultat |
|---|---|
| Tests Collections Core | `16/16 PASS` |
| Séparation saisie/proposition et validation/confirmation | `PASS`, deux acteurs synthétiques distincts |
| Contrainte de banque de dépôt | `PASS`, la ligne BANK B est exclue après sélection de la remise BANK A |
| Pile et données | locales et synthétiques uniquement |

## Conclusion et prochaine porte

Les deux réserves P1/P2 du premier rejeu navigateur sont levées. Le candidat est prêt pour une décision de packaging séparée. Ce verdict n'autorise ni commit, ni push, ni PR, ni staging, ni production.
