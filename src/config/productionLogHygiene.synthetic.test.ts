import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  getProductionLogHygiene,
  productionLogHygieneAssetPlugin,
} from './productionLogHygiene';

const DIST_DIR = new URL('../../dist/', import.meta.url);

async function listJavaScriptFiles(directory: URL): Promise<URL[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = new URL(entry.name, directory);
      if (entry.isDirectory()) {
        return listJavaScriptFiles(new URL(`${entry.name}/`, directory));
      }
      return entry.isFile() && /\.m?js$/.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}

test('production build drops console calls and debugger statements', () => {
  const options = getProductionLogHygiene('production');

  assert.ok(options);
  assert.deepEqual(options.drop, ['console', 'debugger']);
});

test('development mode preserves diagnostics', () => {
  assert.equal(getProductionLogHygiene('development'), undefined);
  assert.equal(productionLogHygieneAssetPlugin('development'), undefined);
});

test('production build enables post-processing for emitted JavaScript assets', () => {
  const plugin = productionLogHygieneAssetPlugin('production');
  assert.equal(plugin?.name, 'sodatra-production-log-hygiene-assets');
  assert.equal(plugin?.apply, 'build');
  assert.equal(plugin?.enforce, 'post');
});

test('generated production JavaScript contains no direct console call or debugger statement', async () => {
  const files = await listJavaScriptFiles(DIST_DIR);
  assert.ok(files.length > 0, 'Run the production build before this contract test.');

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(
      source,
      /\bconsole\s*(?:\.\s*[A-Za-z_$][\w$]*|\[\s*['"][^'"]+['"]\s*\])\s*\(/,
      file.pathname,
    );
    assert.doesNotMatch(source, /\bdebugger\b/, file.pathname);
  }
});
