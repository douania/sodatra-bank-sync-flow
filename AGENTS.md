# AGENTS.md — point d'entrée pour tout agent IA

Pointeur mince, volontairement sans règles propres. Tout agent (Claude Code,
Codex, reviewer indépendant, etc.) lit dans cet ordre :

1. **`CLAUDE.md`** — règles permanentes non négociables : préflight, stop
   conditions, sécurité, périmètres. Elles s'appliquent à tout agent, pas
   seulement à Claude Code.
2. **`docs/ops/OPS-WORKFLOW-V2-BANK-SYNC.md`** — workflow canonique des lots
   et taxonomie des GO (cycle et environnements).
3. **`docs/MASTER_CONTEXT.md`** — architecture, modules actifs, FROZEN.
4. **`docs/BASELINES.md`** — méthodologie de non-régression
   (lint/typecheck/tests) ; le seuil ESLint exécutable vit dans
   `.github/workflows/ci.yml`.
5. **`docs/ops/OPS-CLAUDE-CODE-AUTOMATION-1.md`** — templates de prompts,
   formats de rapport et de verdict.

Rappels d'orientation (détail dans les sources ci-dessus) :

- aucun agent ne décide seul du périmètre d'un lot ; le CTO (ChatGPT) arbitre ;
- tout ce qui n'est pas explicitement autorisé par le lot est interdit ;
- aucun merge sans verdict CTO ; aucun environnement sans le GO dédié.
