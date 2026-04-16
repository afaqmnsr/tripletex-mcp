#!/usr/bin/env node
/**
 * Tripletex MCP Server — stdio entry. Tool definitions live in tripletex-tools.ts
 * (kept in sync with Regnskapsagent hosted MCP).
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { TripletexClient } from "./tripletex-client.js";
import { registerAllTools } from "./tripletex-tools.js";

const MCP_VERSION = "2.4.0";

const client = new TripletexClient();
const server = new McpServer({
  name: "tripletex",
  version: MCP_VERSION,
});

registerAllTools(server, client);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`Tripletex MCP server ${MCP_VERSION} running on stdio`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
