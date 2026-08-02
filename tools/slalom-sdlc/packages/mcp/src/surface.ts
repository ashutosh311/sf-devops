/**
 * How the user reached this server, and therefore how they type its commands.
 *
 * The same bundle is invoked two ways: as a Claude Code plugin (`/slalom-sdlc:build`)
 * or as a bare MCP server registered by hand (`/mcp__slalom-sdlc__build`). Telling a
 * plugin user to run `/mcp__slalom-sdlc__init` sends them to a command that doesn't
 * exist for them, so every user-facing string routes through `cmd()` instead of
 * hardcoding one form.
 *
 * The plugin sets SLALOM_SDLC_SURFACE=plugin in its .mcp.json; anything else is
 * assumed to be a direct MCP registration.
 */
const IS_PLUGIN = process.env.SLALOM_SDLC_SURFACE === "plugin";

export function cmd(name: string, args?: string): string {
  const base = IS_PLUGIN ? `/slalom-sdlc:${name}` : `/mcp__slalom-sdlc__${name}`;
  return args ? `${base} ${args}` : base;
}
