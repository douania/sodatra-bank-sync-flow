import { defineMcp } from "@lovable.dev/mcp-js";
import appInfoTool from "./tools/app-info";

export default defineMcp({
  name: "sodatra-bank-sync-flow-mcp",
  title: "SODATRA Bank Sync Flow MCP",
  version: "0.1.0",
  instructions:
    "MCP server for the SODATRA Bank Sync Flow app. Use `app_info` to get a description of the application, its purpose and available modules. No user data is exposed through this server.",
  tools: [appInfoTool],
});