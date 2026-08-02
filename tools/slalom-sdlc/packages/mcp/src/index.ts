import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";
import { setServer } from "./config.js";
import { version } from "../package.json";

export const MCP_VERSION = version;

const server = new McpServer({
  name: "slalom-sdlc",
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
