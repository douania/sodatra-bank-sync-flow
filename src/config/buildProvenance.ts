/**
 * PACK 0 — provenance du build (décision CTO D-0-4).
 *
 * Objectif : afficher, dans la zone de session existante de Daily v2, le
 * commit **réellement construit** — jamais le HEAD de `main` substitué au
 * checkout construit. Le module est pur : aucune dépendance Node, aucune
 * lecture d'environnement implicite. La collecte au moment du build est
 * pilotée par `vite.config.ts`, qui injecte le résultat sérialisé via
 * `define` sous l'identifiant global `__SODATRA_BUILD_PROVENANCE__`.
 *
 * États :
 *  - `known`     : SHA du checkout construit, arbre propre ;
 *  - `modified`  : SHA du checkout construit, mais des fichiers suivis étaient
 *                  modifiés (build local / développement) ;
 *  - `conflict`  : une variable de plateforme désigne un autre commit que le
 *                  checkout : aucune des deux valeurs n'est affichée comme
 *                  version ;
 *  - `unknown`   : aucune provenance disponible.
 *
 * Seuls `known` **et** corroborés par le checkout (`source = 'git-checkout'`)
 * sont acceptables pour une qualification staging/production. `modified` et
 * `unknown` restent acceptables pour le développement local uniquement.
 * Aucune valeur d'environnement n'est journalisée en console.
 */

export type BuildProvenanceStatus = 'known' | 'modified' | 'conflict' | 'unknown';
export type BuildProvenanceSource = 'git-checkout' | 'platform-env' | 'none';

export interface BuildProvenance {
  status: BuildProvenanceStatus;
  /** SHA complet (40 hex) du commit construit, sinon null. */
  commitSha: string | null;
  /** 7 premiers caractères du SHA, sinon null. */
  shortSha: string | null;
  source: BuildProvenanceSource;
  /** true uniquement quand le checkout git a pu fournir ou confirmer le SHA. */
  corroborated: boolean;
  workingTreeModified: boolean;
  /** Instant de collecte (ISO 8601 UTC) ; null si inconnu. */
  collectedAt: string | null;
  reason: string;
}

export const BUILD_PROVENANCE_GLOBAL = '__SODATRA_BUILD_PROVENANCE__';

/**
 * Variables de plateforme acceptées, dans l'ordre. `SODATRA_BUILD_COMMIT_SHA`
 * est la variable explicite du projet ; les autres sont des conventions
 * usuelles d'intégration continue. Une valeur n'est utilisée que si elle est
 * un SHA complet valide, et elle est toujours confrontée au checkout quand
 * celui-ci est lisible.
 */
export const PLATFORM_COMMIT_ENV_KEYS = Object.freeze([
  'SODATRA_BUILD_COMMIT_SHA',
  'GITHUB_SHA',
  'VERCEL_GIT_COMMIT_SHA',
  'CF_PAGES_COMMIT_SHA',
  'COMMIT_REF',
] as const);

const FULL_SHA_PATTERN = /^[0-9a-f]{40}$/;

export interface CollectBuildProvenanceInput {
  /**
   * Exécute `git <args>` dans le checkout construit et retourne la sortie
   * standard (trim), ou null si git est indisponible ou en échec.
   */
  runGit: (args: readonly string[]) => string | null;
  env: Readonly<Record<string, string | undefined>>;
  now?: () => Date;
}

export function unknownBuildProvenance(reason = 'Provenance indisponible.'): BuildProvenance {
  return {
    status: 'unknown',
    commitSha: null,
    shortSha: null,
    source: 'none',
    corroborated: false,
    workingTreeModified: false,
    collectedAt: null,
    reason,
  };
}

function normalizeSha(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  return FULL_SHA_PATTERN.test(trimmed) ? trimmed : null;
}

function firstPlatformSha(env: CollectBuildProvenanceInput['env']): { key: string; sha: string } | null {
  for (const key of PLATFORM_COMMIT_ENV_KEYS) {
    const sha = normalizeSha(env[key]);
    if (sha) return { key, sha };
  }
  return null;
}

/**
 * Collecte au moment du build. Pure : git et l'environnement sont injectés.
 */
export function collectBuildProvenance(input: CollectBuildProvenanceInput): BuildProvenance {
  const collectedAt = (input.now ?? (() => new Date()))().toISOString();
  const checkoutSha = normalizeSha(input.runGit(['rev-parse', 'HEAD']));
  const platform = firstPlatformSha(input.env);

  if (checkoutSha) {
    if (platform && platform.sha !== checkoutSha) {
      return {
        status: 'conflict',
        commitSha: null,
        shortSha: null,
        source: 'git-checkout',
        corroborated: false,
        workingTreeModified: false,
        collectedAt,
        reason: `La variable ${platform.key} désigne un autre commit que le checkout construit.`,
      };
    }

    const porcelain = input.runGit(['status', '--porcelain', '--untracked-files=no']);
    const modified = porcelain === null ? false : porcelain.trim().length > 0;
    return {
      status: modified ? 'modified' : 'known',
      commitSha: checkoutSha,
      shortSha: checkoutSha.slice(0, 7),
      source: 'git-checkout',
      corroborated: true,
      workingTreeModified: modified,
      collectedAt,
      reason: modified
        ? 'Checkout git lisible, fichiers suivis modifiés au moment du build.'
        : platform
          ? `Checkout git lisible et confirmé par ${platform.key}.`
          : 'Checkout git lisible, arbre propre.',
    };
  }

  if (platform) {
    return {
      status: 'known',
      commitSha: platform.sha,
      shortSha: platform.sha.slice(0, 7),
      source: 'platform-env',
      corroborated: false,
      workingTreeModified: false,
      collectedAt,
      reason: `Commit fourni par ${platform.key} sans checkout git pour le corroborer.`,
    };
  }

  return { ...unknownBuildProvenance('Aucun checkout git lisible ni variable de plateforme.'), collectedAt };
}

/**
 * Validation défensive de la valeur injectée par le build. Toute forme
 * inattendue retombe sur `unknown` plutôt que d'afficher une version fausse.
 */
export function resolveBuildProvenance(raw: unknown): BuildProvenance {
  let candidate: unknown = raw;
  if (typeof candidate === 'string') {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return unknownBuildProvenance('Provenance injectée illisible.');
    }
  }
  if (!candidate || typeof candidate !== 'object') {
    return unknownBuildProvenance('Provenance injectée absente.');
  }

  const value = candidate as Partial<BuildProvenance>;
  const status = value.status;
  if (status !== 'known' && status !== 'modified' && status !== 'conflict' && status !== 'unknown') {
    return unknownBuildProvenance('Provenance injectée invalide.');
  }
  const source: BuildProvenanceSource =
    value.source === 'git-checkout' || value.source === 'platform-env' ? value.source : 'none';
  const commitSha = normalizeSha(value.commitSha);
  const collectedAt = typeof value.collectedAt === 'string' && !Number.isNaN(Date.parse(value.collectedAt))
    ? value.collectedAt
    : null;

  if ((status === 'known' || status === 'modified') && !commitSha) {
    return unknownBuildProvenance('Provenance injectée sans SHA valide.');
  }

  return {
    status,
    commitSha: status === 'known' || status === 'modified' ? commitSha : null,
    shortSha: status === 'known' || status === 'modified' ? commitSha!.slice(0, 7) : null,
    source: status === 'unknown' ? 'none' : source,
    corroborated: source === 'git-checkout' && status !== 'conflict' && value.corroborated === true,
    workingTreeModified: status === 'modified',
    collectedAt,
    reason: typeof value.reason === 'string' && value.reason.trim() ? value.reason : 'Provenance injectée.',
  };
}

/** Provenance du bundle courant. Hors build Vite (tests Node), `unknown`. */
export function currentBuildProvenance(): BuildProvenance {
  try {
    const injected = typeof __SODATRA_BUILD_PROVENANCE__ === 'string' ? __SODATRA_BUILD_PROVENANCE__ : undefined;
    return resolveBuildProvenance(injected);
  } catch {
    return unknownBuildProvenance('Provenance injectée inaccessible.');
  }
}

/** Libellé court, sans donnée d'environnement ni chemin. */
export function buildProvenanceLabel(provenance: BuildProvenance): string {
  switch (provenance.status) {
    case 'known':
      return provenance.corroborated
        ? `Version : ${provenance.shortSha}`
        : `Version : ${provenance.shortSha} (non corroborée)`;
    case 'modified':
      return `Version : ${provenance.shortSha} (arbre modifié)`;
    case 'conflict':
      return 'Version : incohérente (plateforme ≠ checkout)';
    default:
      return 'Version : inconnue';
  }
}

/**
 * Une qualification staging/production exige un SHA connu **et** corroboré
 * par le checkout construit. `modified`, `conflict` et `unknown` sont
 * acceptables pour le développement seulement.
 */
export function isBuildProvenanceQualifiable(provenance: BuildProvenance): boolean {
  return provenance.status === 'known' && provenance.source === 'git-checkout' && provenance.corroborated;
}
