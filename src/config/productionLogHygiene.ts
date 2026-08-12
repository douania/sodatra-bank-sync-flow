import { transformWithEsbuild, type Plugin } from 'vite';

export function getProductionLogHygiene(mode: string) {
  if (mode !== 'production') return undefined;

  return {
    // Production browser bundles must not expose business diagnostics or pause
    // on a stray debugger statement. Development diagnostics remain unchanged.
    drop: ['console', 'debugger'] as Array<'console' | 'debugger'>,
  };
}

export function productionLogHygieneAssetPlugin(mode: string): Plugin | undefined {
  if (mode !== 'production') return undefined;

  return {
    name: 'sodatra-production-log-hygiene-assets',
    apply: 'build',
    enforce: 'post',
    async generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (
          output.type !== 'asset' ||
          !output.fileName.endsWith('.mjs')
        ) {
          continue;
        }

        const source =
          typeof output.source === 'string'
            ? output.source
            : new TextDecoder().decode(output.source);
        const transformed = await transformWithEsbuild(source, output.fileName, {
          drop: ['console', 'debugger'],
          minify: true,
        });
        output.source = transformed.code;
      }
    },
  };
}
