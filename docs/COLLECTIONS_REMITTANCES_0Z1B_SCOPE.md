# 0Z1B — Périmètre approuvé Collections et Remises

**Statut :** `IMPLEMENTATION_LOCAL_ONLY`

**Base :** `origin/main@c36c15e`

**GO :** `GO_0Z1B_LOCAL_DB_DRAFT_AND_PG17_REPLAY_APPROVED`
**Environnements autorisés :** dépôt local et PostgreSQL 17 Docker jetable uniquement.

## 1. Finalité

Bank Sync Flow reste un système de contrôle opérationnel et de rapprochement.
Il prépare, contrôle et justifie les informations bancaires. Il ne passe aucune
écriture comptable définitive et n'exécute aucun paiement.

Le lot 0Z1B fournit, pour les encaissements :

- la capture structurée des remises, titres et bordereaux ;
- le suivi séparé de l'acheminement, du règlement et du recours ;
- le rapprochement avec les lignes canoniques Daily v2 ;
- les événements append-only et la reprise des preuves supersédées ;
- le cas de prorogation Cassis et ses chèques de financement ;
- les agios attendus calculés et les agios bancaires observés ;
- les habilitations métier et la séparation des responsabilités.

## 2. Décisions métier approuvées

1. Une facture peut être réglée par plusieurs effets.
2. Un effet peut être partiellement réglé : montant payé, preuve, reliquat et
   recours éventuel restent suivis séparément.
3. Un chèque peut aussi connaître un paiement partiel documenté ; un chèque de
   financement Cassis partiellement débité ne rend pas le financement complet.
4. Les fonctions de saisie, validation et rapprochement sont distinctes. Deux
   personnes différentes constituent le minimum ; trois personnes sont la
   cible normale.
5. Les agios attendus sont calculés depuis un barème versionné. Le prélèvement
   bancaire observé reste une valeur distincte et n'est jamais écrasé.
6. Le registre de chèques est techniquement générique, mais seul le parcours
   de financement Cassis est activé dans ce lot.
7. Les comptes comptables sont des étiquettes configurables destinées à un
   futur export ; ils ne déclenchent aucune écriture.
8. Le montant de facture est contrôlé depuis un référentiel lorsqu'il est
   disponible ; sinon l'affectation reste explicitement à revoir.

## 3. Périmètre DB local

Le schéma est exclusivement additif. Il ne modifie pas :

- `collection_report` ;
- son idempotence `(excel_filename, excel_source_row)` ;
- `unique_excel_traceability` ;
- ses triggers, contraintes, policies ou grants ;
- les tables et fonctions Daily v2 ;
- les migrations historiques.

Les écritures du nouveau domaine passent uniquement par des commandes
`SECURITY DEFINER` bornées, avec session, rôle, capacité, idempotence, version
attendue, verrouillage et audit. Les tables métier ne reçoivent aucun DML direct
pour `anon`, `authenticated` ou `service_role`.

## 4. Hors périmètre

- écritures comptables, grand livre, fiscalité ou paiement ;
- administration complète des comptes Auth ;
- registre général de tous les chèques fournisseurs ;
- nouveaux parseurs NSIA/SGBS ;
- persistance Internal Book, Fund Position ou Client Reconciliation ;
- dashboard global de trésorerie ;
- accès Supabase, staging, production, déploiement, commit, push ou PR.

## 5. Condition avant staging

Un second utilisateur réel et une attribution nominative des capacités sont
obligatoires avant toute validation de séparation des tâches sur staging.
L'implémentation locale utilise uniquement des identités synthétiques.

La fenêtre staging doit également s'arrêter si `anon`, `authenticated` ou
`service_role` détient `CREATE` sur le schéma `public`. Les fonctions
privilégiées du lot supposent que les rôles applicatifs ne peuvent pas y créer
un objet concurrent.

Enfin, les preuves Daily v2 utilisées en staging doivent être produites par les
RPC légitimes de Daily v2, gardes actives. Le contournement
`session_replication_role = replica` appartient uniquement au harnais
superuser jetable et ne constitue pas une preuve staging.
