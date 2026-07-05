import { defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";

export default defineTool({
  name: "app_info",
  title: "App info",
  description:
    "Return a short description of the SODATRA Bank Sync Flow application, its purpose and available modules.",
  inputSchema: {},
  annotations: {
    readOnlyHint: true,
    idempotentHint: true,
    openWorldHint: false,
  },
  handler: () => ({
    content: [
      {
        type: "text",
        text: [
          "SODATRA Bank Sync Flow — internal banking data centralization app.",
          "",
          "Purpose: import, control and exploit banking data from manual Excel/PDF uploads",
          "(collection reports, fund positions, client reconciliation, BDK/BIS/SGS/BICIS/ORA/ATB",
          "bank statements, unpaid items, drafts, cheques).",
          "",
          "Active modules:",
          "- /dashboard — main dashboard",
          "- /upload — file import pipeline",
          "- /document-understanding — BDK PDF analysis",
          "- /quality-control — data quality checks",
          "- /reconciliation — sync & collections reconciliation",
          "",
          "Access: invite-only, mono-tenant. No direct bank API connection.",
        ].join("\n"),
      },
    ],
  }),
});