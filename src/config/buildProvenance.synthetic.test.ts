import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  BUILD_PROVENANCE_GLOBAL,
  PLATFORM_COMMIT_ENV_KEYS,
  buildProvenanceLabel,
  collectBuildProvenance,
  currentBuildProvenance,
  isBuildProvenanceQualifiable,
  resolveBuildProvenance,
  unknownBuildProvenance,
} from './buildProvenance';

// PACK 0 — D-0-4. Aucune donnée réelle, aucun accès git réel : l'exécution de
// git est injectée, l'environnement est synthétique.

const CHECKOUT_SHA = 'a'.repeat(39) + '1';
const OTHER_SHA = 'b'.repeat(39) + '2';
const NOW = () => new Date('2026-09-06T10:00:00.000Z');

function gitStub(answers: Record<string, string | null>) {
  const calls: string[] = [];
  return {
    calls,
    runGit: (args: readonly string[]) => {
      const key = args.join(' ');
      calls.push(key);
      return key in answers ? answers[key] : null;
    },
  };
}

test('checkout propre : provenance connue, corroborée, SHA du checkout construit', () => {
  const git = gitStub({ 'rev-parse HEAD': CHECKOUT_SHA, 'status --porcelain --untracked-files=no': '' });
  const provenance = collectBuildProvenance({ runGit: git.runGit, env: {}, now: NOW });
  assert.equal(provenance.status, 'known');
  assert.equal(provenance.commitSha, CHECKOUT_SHA);
  assert.equal(provenance.shortSha, CHECKOUT_SHA.slice(0, 7));
  assert.equal(provenance.source, 'git-checkout');
  assert.equal(provenance.corroborated, true);
  assert.equal(provenance.workingTreeModified, false);
  assert.equal(provenance.collectedAt, '2026-09-06T10:00:00.000Z');
  assert.equal(isBuildProvenanceQualifiable(provenance), true);
  assert.equal(buildProvenanceLabel(provenance), `Version : ${CHECKOUT_SHA.slice(0, 7)}`);
});

test('arbre local modifié : distingué explicitement et non qualifiable', () => {
  const git = gitStub({
    'rev-parse HEAD': CHECKOUT_SHA,
    'status --porcelain --untracked-files=no': ' M src/pages/QualityControl.tsx',
  });
  const provenance = collectBuildProvenance({ runGit: git.runGit, env: {}, now: NOW });
  assert.equal(provenance.status, 'modified');
  assert.equal(provenance.commitSha, CHECKOUT_SHA);
  assert.equal(provenance.workingTreeModified, true);
  assert.equal(isBuildProvenanceQualifiable(provenance), false);
  assert.match(buildProvenanceLabel(provenance), /arbre modifié/);
});

test('variable de plateforme confrontée au checkout : accord confirmé, désaccord = conflit sans SHA', () => {
  const agreeing = collectBuildProvenance({
    runGit: gitStub({ 'rev-parse HEAD': CHECKOUT_SHA, 'status --porcelain --untracked-files=no': '' }).runGit,
    env: { GITHUB_SHA: CHECKOUT_SHA.toUpperCase() },
    now: NOW,
  });
  assert.equal(agreeing.status, 'known');
  assert.equal(agreeing.corroborated, true);
  assert.match(agreeing.reason, /GITHUB_SHA/);

  const conflicting = collectBuildProvenance({
    runGit: gitStub({ 'rev-parse HEAD': CHECKOUT_SHA, 'status --porcelain --untracked-files=no': '' }).runGit,
    env: { SODATRA_BUILD_COMMIT_SHA: OTHER_SHA },
    now: NOW,
  });
  assert.equal(conflicting.status, 'conflict');
  assert.equal(conflicting.commitSha, null);
  assert.equal(conflicting.shortSha, null);
  assert.equal(isBuildProvenanceQualifiable(conflicting), false);
  assert.match(buildProvenanceLabel(conflicting), /incohérente/);
  // Le HEAD de la plateforme n'est jamais substitué au checkout construit.
  assert.doesNotMatch(buildProvenanceLabel(conflicting), new RegExp(OTHER_SHA.slice(0, 7)));
});

test('sans checkout git : la variable de plateforme est acceptée mais marquée non corroborée', () => {
  const provenance = collectBuildProvenance({
    runGit: () => null,
    env: { GITHUB_SHA: OTHER_SHA },
    now: NOW,
  });
  assert.equal(provenance.status, 'known');
  assert.equal(provenance.source, 'platform-env');
  assert.equal(provenance.corroborated, false);
  assert.equal(isBuildProvenanceQualifiable(provenance), false);
  assert.match(buildProvenanceLabel(provenance), /non corroborée/);
});

test('ni git ni variable : provenance inconnue explicite', () => {
  const provenance = collectBuildProvenance({ runGit: () => null, env: { GITHUB_SHA: 'not-a-sha' }, now: NOW });
  assert.equal(provenance.status, 'unknown');
  assert.equal(provenance.commitSha, null);
  assert.equal(buildProvenanceLabel(provenance), 'Version : inconnue');
  assert.equal(isBuildProvenanceQualifiable(provenance), false);
});

test('la priorité des variables de plateforme est fixe et documentée', () => {
  assert.deepEqual([...PLATFORM_COMMIT_ENV_KEYS], [
    'SODATRA_BUILD_COMMIT_SHA', 'GITHUB_SHA', 'VERCEL_GIT_COMMIT_SHA', 'CF_PAGES_COMMIT_SHA', 'COMMIT_REF',
  ]);
  const provenance = collectBuildProvenance({
    runGit: () => null,
    env: { GITHUB_SHA: OTHER_SHA, SODATRA_BUILD_COMMIT_SHA: CHECKOUT_SHA },
    now: NOW,
  });
  assert.equal(provenance.commitSha, CHECKOUT_SHA);
});

test('la valeur injectée est validée défensivement : toute forme invalide retombe sur unknown', () => {
  assert.equal(resolveBuildProvenance(undefined).status, 'unknown');
  assert.equal(resolveBuildProvenance('{not json').status, 'unknown');
  assert.equal(resolveBuildProvenance(JSON.stringify({ status: 'known', commitSha: 'short' })).status, 'unknown');
  assert.equal(resolveBuildProvenance(JSON.stringify({ status: 'weird' })).status, 'unknown');

  const known = resolveBuildProvenance(JSON.stringify({
    status: 'known', commitSha: CHECKOUT_SHA, source: 'git-checkout', corroborated: true,
    collectedAt: '2026-09-06T10:00:00.000Z', reason: 'Checkout git lisible, arbre propre.',
  }));
  assert.equal(known.status, 'known');
  assert.equal(known.shortSha, CHECKOUT_SHA.slice(0, 7));
  assert.equal(known.corroborated, true);
  assert.equal(isBuildProvenanceQualifiable(known), true);

  // Une provenance "known" dont la corroboration n'est pas prouvée reste non qualifiable.
  const uncorroborated = resolveBuildProvenance(JSON.stringify({
    status: 'known', commitSha: CHECKOUT_SHA, source: 'platform-env', corroborated: true,
  }));
  assert.equal(uncorroborated.corroborated, false);
  assert.equal(isBuildProvenanceQualifiable(uncorroborated), false);

  const conflict = resolveBuildProvenance(JSON.stringify({ status: 'conflict', commitSha: CHECKOUT_SHA, source: 'git-checkout' }));
  assert.equal(conflict.commitSha, null);
  assert.equal(conflict.corroborated, false);
});

test('hors build Vite (runtime de test) : provenance inconnue, sans exception', () => {
  const provenance = currentBuildProvenance();
  assert.equal(provenance.status, 'unknown');
  assert.deepEqual({ ...provenance, reason: '' }, { ...unknownBuildProvenance(), reason: '' });
});

test('contrat build : vite.config injecte la collecte git du checkout construit sous le global déclaré', () => {
  const viteConfig = readFileSync('vite.config.ts', 'utf8');
  const envTypes = readFileSync('src/vite-env.d.ts', 'utf8');
  assert.match(viteConfig, /collectBuildProvenance\(/);
  assert.match(viteConfig, /execFileSync\('git'/);
  assert.match(viteConfig, new RegExp(`${BUILD_PROVENANCE_GLOBAL}: JSON\\.stringify\\(`));
  assert.match(envTypes, new RegExp(`declare const ${BUILD_PROVENANCE_GLOBAL}: string \\| undefined;`));
  // Aucune journalisation console de la provenance ou de l'environnement.
  assert.doesNotMatch(readFileSync('src/config/buildProvenance.ts', 'utf8'), /console\.(log|info|warn|error|debug|table)\(/);
  assert.doesNotMatch(viteConfig, /console\.(log|info|warn|error|debug|table)\(/);
});
