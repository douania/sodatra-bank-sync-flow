import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test, { after, before } from 'node:test';

import {
  collectBuildProvenance,
  isBuildProvenanceQualifiable,
  resolveBuildProvenance,
  type BuildProvenance,
} from './buildProvenance';

// PACK 0 — D-0-4, GO_FIX_PACK_0 (provenance réelle du build).
//
// Ce test n'est pas simulé : il construit réellement, avec Vite, un worktree
// git détaché et propre du commit HEAD du dépôt courant (en CI : le checkout
// effectivement construit, qui peut être le commit de merge de test de la PR ;
// jamais un SHA substitué), puis lit la provenance effectivement embarquée dans
// le bundle produit. Le worktree vit hors du checkout de travail (répertoire
// temporaire) ; les témoins (temporaire Vite, source non suivie, modification
// suivie) y sont créés puis retirés, jamais dans le checkout de travail.
//
// Les dépendances ne sont pas réinstallées : `node_modules` du dépôt est lié
// (jonction / lien symbolique) dans le worktree et le lien est retiré avant
// toute suppression.

const TIMESTAMP_FILE = 'vite.config.ts.timestamp-1757000000000-0123456789abc.mjs';
const BUILD_TIMEOUT_MS = 10 * 60 * 1000;

const PROVENANCE_PATTERN =
  /\{"status":"(?:known|modified|unverified|conflict|unknown)","commitSha":(?:null|"[0-9a-f]{40}"),"shortSha":(?:null|"[0-9a-f]{7}"),"source":"(?:git-checkout|platform-env|none)","corroborated":(?:true|false),"workingTreeModified":(?:true|false),"workingTreeState":"[a-z-]+","collectedAt":(?:null|"[^"]*"),"reason":"(?:[^"\\]|\\.)*"\}/;

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).trim();
}

function gitOrNull(cwd: string, args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 60_000,
    }).trim();
  } catch {
    return null;
  }
}

function isIgnored(cwd: string, relativePath: string): boolean {
  try {
    execFileSync('git', ['check-ignore', '-q', '--', relativePath], { cwd, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** Sortie porcelain brute : l'espace initial des lignes ` M …` est significatif. */
function porcelain(cwd: string): string {
  return execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 60_000,
  }).replace(/\s+$/, '');
}

function removeLink(linkPath: string): void {
  if (!existsSync(linkPath)) return;
  try {
    unlinkSync(linkPath);
  } catch {
    // Jonction Windows : seul rmdir retire le point de réanalyse sans toucher la cible.
    rmdirSync(linkPath);
  }
}

/** Extrait l'objet de provenance injecté par `define` dans le bundle. */
export function extractEmbeddedProvenance(bundleSource: string): Record<string, unknown> | null {
  const direct = PROVENANCE_PATTERN.exec(bundleSource);
  if (direct) return JSON.parse(direct[0]) as Record<string, unknown>;
  // Variante où le minifieur a conservé des guillemets doubles échappés.
  const unescaped = PROVENANCE_PATTERN.exec(bundleSource.replace(/\\"/g, '"'));
  return unescaped ? (JSON.parse(unescaped[0]) as Record<string, unknown>) : null;
}

function readEmbeddedProvenance(distDir: string): { raw: Record<string, unknown>; resolved: BuildProvenance; bundle: string } {
  const assetsDir = path.join(distDir, 'assets');
  assert.ok(existsSync(assetsDir), 'dist/assets must exist after a real Vite build');
  const bundles = readdirSync(assetsDir).filter((name) => name.endsWith('.js'));
  assert.ok(bundles.length > 0, 'at least one JavaScript bundle must be produced');
  for (const bundle of bundles) {
    const raw = extractEmbeddedProvenance(readFileSync(path.join(assetsDir, bundle), 'utf8'));
    if (raw) return { raw, resolved: resolveBuildProvenance(raw), bundle };
  }
  assert.fail('no embedded build provenance found in any produced bundle');
}

const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
const sourceHead = git(root, 'rev-parse', 'HEAD');

let sandbox: string | null = null;
let checkout: string | null = null;
let linkedNodeModules: string | null = null;

before(() => {
  assert.match(sourceHead, /^[0-9a-f]{40}$/, 'the repository HEAD must be readable');
  assert.ok(
    existsSync(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')),
    'dependencies must be installed (npm ci) before the real build test',
  );
  sandbox = mkdtempSync(path.join(tmpdir(), 'sbsf-build-provenance-'));
  checkout = path.join(sandbox, 'checkout');
  git(root, 'worktree', 'add', '--detach', '--quiet', checkout, 'HEAD');
  linkedNodeModules = path.join(checkout, 'node_modules');
  symlinkSync(
    path.join(root, 'node_modules'),
    linkedNodeModules,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
});

after(() => {
  if (linkedNodeModules) removeLink(linkedNodeModules);
  // Garde-fou : la cible du lien (dépendances du dépôt) doit être intacte.
  assert.ok(existsSync(path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')));
  if (checkout) {
    try {
      git(root, 'worktree', 'remove', '--force', checkout);
    } catch {
      // Le nettoyage du répertoire temporaire ci-dessous reste effectif.
    }
    gitOrNull(root, ['worktree', 'prune']);
  }
  if (sandbox) rmSync(sandbox, { recursive: true, force: true });
});

function requireCheckout(): string {
  assert.ok(checkout, 'the detached worktree must be prepared');
  return checkout;
}

test('worktree détaché propre : même HEAD que le dépôt, arbre vérifié propre avant le build', () => {
  const cwd = requireCheckout();
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), sourceHead);
  assert.equal(porcelain(cwd), '');
});

test('build Vite réel : la provenance embarquée est known / git-checkout / corroborée / arbre propre et porte le HEAD construit', () => {
  const cwd = requireCheckout();
  execFileSync(process.execPath, [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'build', '--logLevel', 'warn'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: BUILD_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });

  const { raw, resolved } = readEmbeddedProvenance(path.join(cwd, 'dist'));
  assert.equal(raw.status, 'known', `embedded status: ${JSON.stringify(raw)}`);
  assert.equal(raw.source, 'git-checkout');
  assert.equal(raw.corroborated, true);
  assert.equal(raw.workingTreeState, 'clean');
  assert.equal(raw.workingTreeModified, false);
  assert.equal(raw.commitSha, sourceHead, 'the embedded SHA must be the HEAD actually built, never a substituted one');
  assert.equal(raw.shortSha, sourceHead.slice(0, 7));

  assert.equal(resolved.status, 'known');
  assert.equal(resolved.commitSha, sourceHead);
  assert.equal(resolved.corroborated, true);
  assert.equal(isBuildProvenanceQualifiable(resolved), true);

  // Le build ne laisse aucune modification ni aucun fichier source non suivi.
  assert.equal(porcelain(cwd), '', 'a real build must leave the source tree untouched');
  assert.equal(git(cwd, 'rev-parse', 'HEAD'), sourceHead);
});

test('le temporaire de configuration Vite est ignoré, uniquement à la racine, sans ignorer d’autres .mjs', () => {
  const cwd = requireCheckout();
  const rootTemp = path.join(cwd, TIMESTAMP_FILE);
  const nestedTemp = path.join(cwd, 'src', TIMESTAMP_FILE);
  const siblingModule = path.join(cwd, 'tests', 'provenanceWitness.mjs');
  try {
    writeFileSync(rootTemp, 'export default {};\n');
    assert.equal(isIgnored(cwd, TIMESTAMP_FILE), true, 'the Vite config temp file must be ignored');
    assert.equal(porcelain(cwd), '', 'the Vite config temp file must not appear as an untracked source');
    const provenance = collectBuildProvenance({ runGit: (args) => gitOrNull(cwd, args), env: {} });
    assert.equal(provenance.status, 'known');
    assert.equal(provenance.workingTreeState, 'clean');
    assert.equal(provenance.commitSha, sourceHead);
    assert.equal(isBuildProvenanceQualifiable(provenance), true);

    // Même nom hors racine : détecté (règle ancrée).
    mkdirSync(path.dirname(nestedTemp), { recursive: true });
    writeFileSync(nestedTemp, 'export default {};\n');
    assert.equal(isIgnored(cwd, path.posix.join('src', TIMESTAMP_FILE)), false);
    assert.match(porcelain(cwd), /^\?\? src\//m);
    unlinkSync(nestedTemp);

    // Un autre module .mjs non suivi : détecté (aucune règle générique).
    mkdirSync(path.dirname(siblingModule), { recursive: true });
    writeFileSync(siblingModule, 'export default {};\n');
    assert.equal(isIgnored(cwd, 'tests/provenanceWitness.mjs'), false);
    assert.match(porcelain(cwd), /^\?\? tests\/provenanceWitness\.mjs$/m);
  } finally {
    for (const file of [rootTemp, nestedTemp, siblingModule]) {
      if (existsSync(file)) unlinkSync(file);
    }
  }
  assert.equal(porcelain(cwd), '');
});

test('les lockfiles et sources restent suivis : rien d’autre n’est ignoré par la règle', () => {
  const cwd = requireCheckout();
  for (const tracked of ['package-lock.json', 'package.json', 'vite.config.ts', 'src/config/buildProvenance.ts']) {
    assert.equal(isIgnored(cwd, tracked), false, `${tracked} must never be ignored`);
  }
  for (const untrackedCandidate of ['bun.lock', 'bun.lockb', 'src/newService.ts', 'vite.config.ts.timestamp.mjs', 'vite.config.mjs']) {
    assert.equal(isIgnored(cwd, untrackedCandidate), false, `${untrackedCandidate} must never be ignored`);
  }
});

test('une véritable source non suivie reste détectée : modified / fichiers non suivis, non qualifiable', () => {
  const cwd = requireCheckout();
  const witness = path.join(cwd, 'src', 'services', 'provenanceWitnessUntracked.ts');
  try {
    writeFileSync(witness, 'export const provenanceWitness = true;\n');
    const provenance = collectBuildProvenance({ runGit: (args) => gitOrNull(cwd, args), env: {} });
    assert.equal(provenance.status, 'modified');
    assert.equal(provenance.workingTreeState, 'untracked');
    assert.equal(provenance.workingTreeModified, true);
    assert.equal(provenance.corroborated, false);
    assert.equal(provenance.commitSha, sourceHead);
    assert.equal(isBuildProvenanceQualifiable(provenance), false);
    assert.match(provenance.reason, /non suivi/);
    assert.doesNotMatch(JSON.stringify(provenance), /provenanceWitnessUntracked/);
  } finally {
    if (existsSync(witness)) unlinkSync(witness);
  }
  assert.equal(porcelain(cwd), '');
});

test('une modification suivie reste détectée : modified / arbre modifié, non qualifiable', () => {
  const cwd = requireCheckout();
  const tracked = path.join(cwd, 'src', 'main.tsx');
  try {
    appendFileSync(tracked, '\n// provenance witness (never committed)\n');
    assert.match(porcelain(cwd), /^ M src\/main\.tsx$/m);
    const provenance = collectBuildProvenance({ runGit: (args) => gitOrNull(cwd, args), env: {} });
    assert.equal(provenance.status, 'modified');
    assert.equal(provenance.workingTreeState, 'modified');
    assert.equal(provenance.workingTreeModified, true);
    assert.equal(provenance.corroborated, false);
    assert.equal(isBuildProvenanceQualifiable(provenance), false);
    assert.match(provenance.reason, /suivi\(s\) modifié\(s\)/);
  } finally {
    git(cwd, 'checkout', '--', 'src/main.tsx');
  }
  assert.equal(porcelain(cwd), '');
});

test('échec de lecture de l’état git (HEAD réel lisible, status en échec) : unverified, non qualifiable', () => {
  const cwd = requireCheckout();
  const failingStatus = (args: readonly string[]) =>
    args[0] === 'status' ? null : gitOrNull(cwd, args);
  const provenance = collectBuildProvenance({ runGit: failingStatus, env: {} });
  assert.equal(provenance.status, 'unverified');
  assert.equal(provenance.workingTreeState, 'unverifiable');
  assert.equal(provenance.commitSha, sourceHead);
  assert.equal(provenance.corroborated, false);
  assert.equal(isBuildProvenanceQualifiable(provenance), false);
});
