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
 *  - `known`      : SHA du checkout construit, arbre vérifié propre (aucun
 *                   fichier suivi modifié, aucun fichier source non suivi) ;
 *  - `modified`   : SHA du checkout construit, mais des fichiers suivis sont
 *                   modifiés ou des fichiers non suivis (non ignorés) sont
 *                   présents : le commit ne décrit pas tout le code construit ;
 *  - `unverified` : SHA du checkout lisible, mais l'état de l'arbre n'a pas pu
 *                   être lu : incertitude explicite, jamais « arbre propre » ;
 *  - `conflict`   : une variable de plateforme désigne un autre commit que le
 *                   checkout : aucune des deux valeurs n'est affichée comme
 *                   version ;
 *  - `unknown`    : aucune provenance disponible.
 *
 * L'état de l'arbre est lu avec les fichiers non suivis inclus ; les fichiers
 * ignorés par git (dépendances, sorties de build) restent exclus, ce qui
 * préserve la distinction entre fichiers source et artefacts.
 *
 * Seuls `known`, corroborés par le checkout (`source = 'git-checkout'`) et
 * avec un arbre vérifié propre, sont acceptables pour une qualification
 * staging/production. `modified`, `unverified` et `unknown` restent
 * acceptables pour le développement local uniquement. Aucune valeur
 * d'environnement ni chemin de fichier n'est embarqué ou journalisé.
 */

/**
 * Déclaration ambiante locale au module. `vite.config.ts` importe ce module
 * depuis le projet Node (`tsconfig.node.json`), qui n'inclut pas
 * `src/vite-env.d.ts` ; sans elle, `tsc -b` signale TS2304 sur la lecture du
 * global injecté par `define`. Aucun code émis, aucun changement de
 * comportement : la valeur reste `undefined` hors build Vite.
 */
declare const __SODATRA_BUILD_PROVENANCE__: string | undefined;

export type BuildProvenanceStatus = 'known' | 'modified' | 'unverified' | 'conflict' | 'unknown';
export type BuildProvenanceSource = 'git-checkout' | 'platform-env' | 'none';
export type BuildWorkingTreeState = 'clean' | 'modified' | 'untracked' | 'unverifiable' | 'not-applicable';

export interface BuildProvenance {
  status: BuildProvenanceStatus;
  /** SHA complet (40 hex) du commit construit, sinon null. */
  commitSha: string | null;
  /** 7 premiers caractères du SHA, sinon null. */
  shortSha: string | null;
  source: BuildProvenanceSource;
  /** true uniquement quand le checkout git a fourni le SHA ET vérifié l'arbre. */
  corroborated: boolean;
  /** true quand des fichiers suivis sont modifiés ou des fichiers non suivis existent. */
  workingTreeModified: boolean;
  workingTreeState: BuildWorkingTreeState;
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
    workingTreeState: 'not-applicable',
    collectedAt: null,
    reason,
  };
}

/**
 * Classe la sortie de `git status --porcelain --untracked-files=all` sans
 * conserver aucun chemin : seule la nature de l'écart est retenue.
 */
function classifyWorkingTree(porcelain: string): { state: 'clean' | 'modified' | 'untracked'; tracked: number; untracked: number } {
  const lines = porcelain.split(/\r?\n/).map(line => line.trimEnd()).filter(line => line.length > 0);
  const untracked = lines.filter(line => line.startsWith('??')).length;
  const tracked = lines.length - untracked;
  if (tracked > 0) return { state: 'modified', tracked, untracked };
  if (untracked > 0) return { state: 'untracked', tracked, untracked };
  return { state: 'clean', tracked: 0, untracked: 0 };
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
        workingTreeState: 'not-applicable',
        collectedAt,
        reason: `La variable ${platform.key} désigne un autre commit que le checkout construit.`,
      };
    }

    // Fichiers non suivis inclus (`all`) : un fichier source ajouté sans commit
    // entrerait dans le build ; les fichiers ignorés restent exclus par git.
    const porcelain = input.runGit(['status', '--porcelain', '--untracked-files=all']);
    if (porcelain === null) {
      return {
        status: 'unverified',
        commitSha: checkoutSha,
        shortSha: checkoutSha.slice(0, 7),
        source: 'git-checkout',
        corroborated: false,
        workingTreeModified: false,
        workingTreeState: 'unverifiable',
        collectedAt,
        reason: 'Checkout git lisible mais état de l’arbre non vérifiable : le commit ne peut pas être garanti comme description complète du code construit.',
      };
    }

    const tree = classifyWorkingTree(porcelain);
    if (tree.state !== 'clean') {
      return {
        status: 'modified',
        commitSha: checkoutSha,
        shortSha: checkoutSha.slice(0, 7),
        source: 'git-checkout',
        corroborated: false,
        workingTreeModified: true,
        workingTreeState: tree.state,
        collectedAt,
        reason: tree.state === 'modified'
          ? `Checkout git lisible, ${tree.tracked} fichier(s) suivi(s) modifié(s)${tree.untracked > 0 ? ` et ${tree.untracked} fichier(s) non suivi(s)` : ''} au moment du build.`
          : `Checkout git lisible, ${tree.untracked} fichier(s) source non suivi(s) au moment du build.`,
      };
    }

    return {
      status: 'known',
      commitSha: checkoutSha,
      shortSha: checkoutSha.slice(0, 7),
      source: 'git-checkout',
      corroborated: true,
      workingTreeModified: false,
      workingTreeState: 'clean',
      collectedAt,
      reason: platform
        ? `Checkout git lisible, arbre vérifié propre et confirmé par ${platform.key}.`
        : 'Checkout git lisible, arbre vérifié propre.',
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
      workingTreeState: 'not-applicable',
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
  if (
    status !== 'known' && status !== 'modified' && status !== 'unverified'
    && status !== 'conflict' && status !== 'unknown'
  ) {
    return unknownBuildProvenance('Provenance injectée invalide.');
  }
  const source: BuildProvenanceSource =
    value.source === 'git-checkout' || value.source === 'platform-env' ? value.source : 'none';
  const commitSha = normalizeSha(value.commitSha);
  const collectedAt = typeof value.collectedAt === 'string' && !Number.isNaN(Date.parse(value.collectedAt))
    ? value.collectedAt
    : null;
  const carriesSha = status === 'known' || status === 'modified' || status === 'unverified';

  if (carriesSha && !commitSha) {
    return unknownBuildProvenance('Provenance injectée sans SHA valide.');
  }

  const declaredTree = value.workingTreeState;
  const workingTreeState: BuildWorkingTreeState =
    status === 'unverified' ? 'unverifiable'
      : status === 'modified'
        ? (declaredTree === 'untracked' ? 'untracked' : 'modified')
        : status === 'known'
          ? (declaredTree === 'clean' || declaredTree === undefined
            ? (source === 'git-checkout' ? 'clean' : 'not-applicable')
            : declaredTree === 'modified' || declaredTree === 'untracked' || declaredTree === 'unverifiable'
              ? declaredTree
              : 'not-applicable')
          : 'not-applicable';

  // La corroboration n'est jamais déduite d'une simple étiquette : elle exige
  // un checkout git, un statut connu et un arbre vérifié propre.
  const corroborated =
    source === 'git-checkout'
    && status === 'known'
    && workingTreeState === 'clean'
    && value.corroborated === true;

  return {
    status,
    commitSha: carriesSha ? commitSha : null,
    shortSha: carriesSha ? commitSha!.slice(0, 7) : null,
    source: status === 'unknown' ? 'none' : source,
    corroborated,
    workingTreeModified: status === 'modified' || workingTreeState === 'modified' || workingTreeState === 'untracked',
    workingTreeState,
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
      return provenance.workingTreeState === 'untracked'
        ? `Version : ${provenance.shortSha} (fichiers non suivis)`
        : `Version : ${provenance.shortSha} (arbre modifié)`;
    case 'unverified':
      return `Version : ${provenance.shortSha} (arbre non vérifiable)`;
    case 'conflict':
      return 'Version : incohérente (plateforme ≠ checkout)';
    default:
      return 'Version : inconnue';
  }
}

/**
 * Une qualification staging/production exige un SHA connu, corroboré par le
 * checkout construit **et** un arbre vérifié propre. `modified`, `unverified`,
 * `conflict` et `unknown` sont acceptables pour le développement seulement.
 */
export function isBuildProvenanceQualifiable(provenance: BuildProvenance): boolean {
  return provenance.status === 'known'
    && provenance.source === 'git-checkout'
    && provenance.corroborated
    && provenance.workingTreeState === 'clean';
}
