/**
 * How the user reached this server, and therefore how they invoke its commands
 * and what to call the host in prose.
 *
 * The same bundle is invoked three ways:
 *   - as a Claude Code plugin           → `/slalom-sdlc:build`
 *   - as a GitHub Copilot custom agent  → `/agent slalom-build`
 *   - as a bare MCP server (registered by hand) → `/mcp__slalom-sdlc__build`
 *
 * Telling a user to run a command form that doesn't exist for their host sends
 * them nowhere, so every user-facing invocation string routes through `cmd()`
 * and every host reference through `hostName()` instead of hardcoding one form.
 *
 * The surface is selected by either:
 *   - a `--surface=<name>` CLI argument (used by hosts that don't forward env to
 *     local MCP servers — notably GitHub Copilot CLI), or
 *   - the SLALOM_SDLC_SURFACE environment variable (used by the Claude plugin).
 * The CLI argument wins when both are present.
 *
 * Recognised values: "plugin" (Claude plugin), "copilot" (GitHub Copilot agents).
 * Anything else is assumed to be a direct MCP registration.
 */
type Surface = "plugin" | "copilot" | "mcp";

function detectSurface(): Surface {
  const argMatch = process.argv.find((a) => a.startsWith("--surface="));
  const fromArg = argMatch ? argMatch.slice("--surface=".length) : undefined;
  const raw = fromArg ?? process.env.SLALOM_SDLC_SURFACE;
  return raw === "plugin" ? "plugin" : raw === "copilot" ? "copilot" : "mcp";
}

const SURFACE: Surface = detectSurface();

export function cmd(name: string, args?: string): string {
  if (SURFACE === "copilot") {
    // Copilot invokes a custom agent via `/agent <name>`; any arguments are
    // supplied after the agent is selected, not appended to the invocation.
    const agent = `/agent slalom-${name}`;
    return args ? `${agent} (then provide ${args})` : agent;
  }
  const base =
    SURFACE === "plugin" ? `/slalom-sdlc:${name}` : `/mcp__slalom-sdlc__${name}`;
  return args ? `${base} ${args}` : base;
}

/** How to refer to the invocation mechanism generically (e.g. "run the X command"). */
export function invocationNoun(): string {
  return SURFACE === "copilot" ? "agent" : "command";
}

/** The AI host the server is running inside, for prose. */
export function hostName(): string {
  return SURFACE === "copilot" ? "GitHub Copilot" : "Claude Code";
}
