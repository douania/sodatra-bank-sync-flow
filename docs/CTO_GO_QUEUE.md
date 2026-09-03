# File d'attente CTO — SODATRA Bank Sync Flow

Convention (mode autopilot) : quand Claude Code, en exécution automatique planifiée, atteint une
stop condition (§4 de CLAUDE.md) ou termine un pack déjà couvert par un GO jusqu'au stade
« branche locale prête », il consigne une entrée ici au lieu d'attendre une réponse synchrone, puis
passe au pack sûr suivant (ou s'arrête proprement s'il n'y en a pas). Codex (ou l'utilisateur)
traite les entrées `PENDING` en priorité à l'ouverture de session, puis met à jour le statut :
`GO` / `NO-GO` / `INFO_MANQUANTE` / `TRAITÉ`.

Rappel : même après un `GO`, aucun merge n'est automatique — l'ouverture de PR et le merge restent
un verdict CTO explicite, comme le prévoit CLAUDE.md §1.

Ne jamais committer ce fichier avec autre chose que lui-même (commit docs-only dédié).

---

<!-- Nouvelle entrée : copier le bloc ci-dessous, remplir, ajouter en haut de la liste. -->

## [AAAA-MM-JJ HH:MM UTC] PENDING — <titre court>
**Origine** : autopilot quotidien (planifié) | session interactive
**Type** : demande de GO avant travail | branche prête à pousser/PR | blocage / divergence Git
**Objectif** :
**Fichiers concernés** :
**Pourquoi une décision CTO est nécessaire** :
**Risques** :
**Recommandation de Claude Code** :
**Référence** (branche / commit local / lien) :

---

*(Aucune entrée pour l'instant — fichier créé le 2026-09-03 lors de la mise en place du mode
autopilot.)*
