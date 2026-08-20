import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { migrateLegacyHomeDir } from "@otto/core";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";
import { setServer } from "./config.js";
import { version } from "../package.json";

export const MCP_VERSION = version;

// One-time migration of the machine-local home dir (~/.slalom-sdlc → ~/.otto)
// so a warm cache populated under the old name is picked up after the rename.
migrateLegacyHomeDir();

const server = new McpServer({
  name: "otto",
  version: MCP_VERSION,
});

// Give config.ts access to server.listRoots() for workspace root resolution
setServer(server.server);

registerPrompts(server, MCP_VERSION);
registerTools(server, MCP_VERSION);

const transport = new StdioServerTransport();

(async () => {
  await server.connect(transport);
})();
