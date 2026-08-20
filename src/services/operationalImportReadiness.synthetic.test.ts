import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

import { buildImportPreflight, type ImportFileDescriptor } from './importPreflightService';
import {
  OPERATIONAL_IMPORT_FORMAT_READINESS,
  qualifyOperationalImportDocument,
  resolveOperationalImportDeploymentTarget,
} from './operationalImportReadiness';
import {
  canOperateImports,
  evaluateOperationalImportAccess,
  type OperationalImportRole,
} from './operationalImportAccess';

const file = (name: string): ImportFileDescriptor => ({
  name,
  size: 2048,
  lastModified: 1,
});

test('la matrice produit couvre chaque famille sans identifiant dupliqué', () => {
  const ids = OPERATIONAL_IMPORT_FORMAT_READINESS.map(entry => entry.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(
    new Set(OPERATIONAL_IMPORT_FORMAT_READINESS.map(entry => entry.qualification)),
    new Set(['PRODUCTION_CANDIDATE', 'STAGING_PILOT', 'BLOCKED']),
  );
  assert.ok(OPERATIONAL_IMPORT_FORMAT_READINESS.some(entry => entry.route === '/daily-statements'));
});

test('le dépôt ne conserve qu’un pipeline global et un détecteur documentaire read-only', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const documentUnderstanding = readFileSync('src/pages/DocumentUnderstanding.tsx', 'utf8');
  const detector = readFileSync('src/services/documentDetectionService.ts', 'utf8');

  assert.match(app, /path="\/upload-bulk"[\s\S]*?<Navigate to="\/upload" replace/);
  assert.equal(existsSync('src/pages/FileUploadBulk.tsx'), false);
  assert.equal(existsSync('src/services/enhancedFileProcessingService.ts'), false);
  assert.match(documentUnderstanding, /documentDetectionService\.detectFileType\(selectedFile\)/);
  assert.doesNotMatch(detector, /databaseService|supabase|processFiles|save[A-Z]/);
});

test('la lecture de rôles frontend ne contient aucune capacité privilégiée', () => {
  const roleService = readFileSync('src/services/operationalImportRoleService.ts', 'utf8');
  assert.match(roleService, /from\('user_roles'\)/);
  assert.match(roleService, /\.eq\('user_id', user\.id\)/);
  assert.doesNotMatch(roleService, /service_role|sb_secret|rpc\(/i);
});

test('seuls les parcours disposant de preuves dédiées sont candidats production', () => {
  assert.equal(
    qualifyOperationalImportDocument('COLLECTION_REPORT', 'Collection Report.xlsx', 'Collection Report').productionEligible,
    true,
  );
  assert.equal(
    qualifyOperationalImportDocument('INTERNAL_BOOK', 'synthetic-BDK-internal-book.xlsx', 'Internal Book').productionEligible,
    true,
  );
  assert.equal(
    qualifyOperationalImportDocument('BANK_REPORT', 'Releve BDK.pdf', 'Rapport bancaire BDK').productionEligible,
    true,
  );

  for (const qualification of [
    qualifyOperationalImportDocument('BANK_REPORT', 'Releve BDK.xlsx', 'Rapport bancaire BDK'),
    qualifyOperationalImportDocument('BANK_REPORT', 'Releve ORA.pdf', 'Rapport bancaire ORA'),
    qualifyOperationalImportDocument('FUND_POSITION', 'Fund Position.xlsx', 'Fund Position'),
  ]) {
    assert.equal(qualification.qualification, 'STAGING_PILOT');
    assert.equal(qualification.productionEligible, false);
  }
  assert.equal(
    qualifyOperationalImportDocument('CLIENT_RECONCILIATION', 'Client Reconciliation.xlsx', 'Client Reconciliation').qualification,
    'BLOCKED',
  );
});

test('le précontrôle production accepte les candidats et bloque les pilotes', () => {
  const qualified = buildImportPreflight([
    file('Collection Report.xlsx'),
    file('synthetic-BDK-internal-book.xlsx'),
    file('Releve BDK.pdf'),
  ], { deploymentTarget: 'production' });
  assert.equal(qualified.canProcess, true);

  const pilot = buildImportPreflight([
    file('Fund Position.xlsx'),
    file('Releve ORA.pdf'),
  ], { deploymentTarget: 'production' });
  assert.equal(pilot.canProcess, false);
  assert.ok(pilot.entries.every(entry => (
    entry.issues.some(issue => issue.code === 'NOT_PRODUCTION_QUALIFIED')
  )));
});

test('le précontrôle staging conserve les pilotes et une cible inconnue refuse tout', () => {
  assert.equal(
    buildImportPreflight([file('Fund Position.xlsx')], { deploymentTarget: 'staging' }).canProcess,
    true,
  );
  const unknown = buildImportPreflight(
    [file('Collection Report.xlsx')],
    { deploymentTarget: 'unknown' },
  );
  assert.equal(unknown.canProcess, false);
  assert.equal(unknown.entries[0].issues[0].code, 'TARGET_NOT_AUTHORIZED');
});

test('la résolution de cible est exacte et refuse les contradictions', () => {
  assert.equal(resolveOperationalImportDeploymentTarget({
    supabaseUrl: 'https://gbbsqcscryygqlmqncyv.supabase.co',
  }), 'staging');
  assert.equal(resolveOperationalImportDeploymentTarget({
    supabaseUrl: 'https://leakcdbbawzysfqyqsnr.supabase.co',
    projectId: 'leakcdbbawzysfqyqsnr',
  }), 'production');
  assert.equal(resolveOperationalImportDeploymentTarget({
    supabaseUrl: 'https://gbbsqcscryygqlmqncyv.supabase.co',
    projectId: 'leakcdbbawzysfqyqsnr',
  }), 'unknown');
  assert.equal(resolveOperationalImportDeploymentTarget({
    supabaseUrl: 'https://example.com',
  }), 'unknown');
});

test('l’accès opérateur est admin/manager uniquement et fail-closed', () => {
  const allowedRoles: OperationalImportRole[][] = [['admin'], ['manager'], ['user', 'manager']];
  for (const roles of allowedRoles) assert.equal(canOperateImports(roles), true);
  for (const roles of [[], ['user'], ['auditor']] as OperationalImportRole[][]) {
    assert.equal(canOperateImports(roles), false);
  }

  assert.deepEqual(evaluateOperationalImportAccess({
    targetAllowsMutation: false,
    roles: ['admin'],
    rolesPending: false,
    rolesError: false,
  }), { allowed: false, reason: 'target_read_only' });
  assert.deepEqual(evaluateOperationalImportAccess({
    targetAllowsMutation: true,
    roles: ['admin'],
    rolesPending: true,
    rolesError: false,
  }), { allowed: false, reason: 'roles_pending' });
  assert.deepEqual(evaluateOperationalImportAccess({
    targetAllowsMutation: true,
    roles: ['admin'],
    rolesPending: false,
    rolesError: true,
  }), { allowed: false, reason: 'role_lookup_failed' });
  assert.deepEqual(evaluateOperationalImportAccess({
    targetAllowsMutation: true,
    roles: ['manager'],
    rolesPending: false,
    rolesError: false,
  }), { allowed: true });
});
