import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { componentTagger } from "lovable-tagger";
import { mcpPlugin } from "@lovable.dev/mcp-js/stacks/supabase/vite";

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
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
  ].filter(Boolean),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
}));
