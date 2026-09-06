import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { execFileSync } from "node:child_process";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";
import {
  getProductionLogHygiene,
  productionLogHygieneAssetPlugin,
} from "./src/config/productionLogHygiene";
import { collectBuildProvenance } from "./src/config/buildProvenance";

// PACK 0 (D-0-4) — provenance du build : SHA du checkout réellement construit,
// jamais le HEAD de `main` substitué. Une variable de plateforme est confrontée
// au checkout quand celui-ci est lisible ; sans git, l'état reste explicite
// (`unknown` / non corroboré). Aucune valeur n'est journalisée.
function runGitInCheckout(args: readonly string[]): string | null {
  try {
    return execFileSync('git', [...args], {
      cwd: __dirname,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5_000,
    }).trim();
  } catch {
    return null;
  }
}

const buildProvenance = collectBuildProvenance({ runGit: runGitInCheckout, env: process.env });

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __SODATRA_BUILD_PROVENANCE__: JSON.stringify(JSON.stringify(buildProvenance)),
  },
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    react(),
    mode === 'development' &&
    componentTagger(),
    // Le plugin Lovable MCP régénère supabase/functions/mcp/index.ts, mais produit
    // sous Windows un artefact Supabase cassé (import "npm:C:\..."). Désactivé sur
    // Windows local ; la sandbox Linux de Lovable reste la source de cet artefact.
    process.platform !== "win32" && mcpPlugin(),
    productionLogHygieneAssetPlugin(mode),
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  esbuild: getProductionLogHygiene(mode),
}));
