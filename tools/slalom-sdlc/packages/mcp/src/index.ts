import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerPrompts } from "./prompts.js";
import { registerTools } from "./tools.js";
import { setServer } from "./config.js";

const server = new McpServer({
  name: "slalom-sdlc",
  version: "0.2.5",
});

// Give config.ts access to server.listRoots() for workspace root resolution
setServer(server.server);

registerPrompts(server);
registerTools(server);

const transport = new StdioServerTransport();

(async () => {
  await server.connect(transport);
})();
