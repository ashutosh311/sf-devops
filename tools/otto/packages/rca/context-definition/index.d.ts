export interface ContextDefResult {
  command: "discover" | "validate";
  exitCode: number;
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * Run a vendored context-definition-editor command in-process.
 * @param command "discover" (map structure) or "validate" (integrity checks)
 * @param args CLI-style args, e.g. ["path/to/contextDefinition.meta.xml", "--json"]
 */
export function runContextDefCommand(
  command: "discover" | "validate",
  args?: string[]
): ContextDefResult;
