"use strict";

/**
 * In-process runner for the vendored context-definition-editor scripts.
 *
 * The two scripts (`discover-context-def.js`, `validate-context-def.js`) are
 * zero-dependency, fully synchronous CommonJS CLIs: they read a file path from
 * `process.argv`, write human/JSON output via `console.log`, and terminate with
 * `process.exit`. To expose them as MCP tools WITHOUT shelling out, we invoke
 * their exported `main()` in-process while:
 *   - substituting `process.argv` with the requested command args,
 *   - capturing `console.log`/`console.error` into a buffer,
 *   - intercepting `process.exit(code)` via a thrown sentinel so the host
 *     process is never terminated.
 * Everything is synchronous, so globals are restored in a `finally` before the
 * function returns.
 */

const discover = require("./scripts/discover-context-def.js");
const validate = require("./scripts/validate-context-def.js");

const RUNNERS = {
  discover: discover.main,
  validate: validate.main,
};

class ExitSignal extends Error {
  constructor(code) {
    super("exit:" + String(code));
    this.code = typeof code === "number" ? code : code ? 1 : 0;
  }
}

/**
 * Run a context-definition command in-process.
 * @param {"discover"|"validate"} command
 * @param {string[]} [args] CLI-style args, e.g. ["path/to/file.xml", "--json"]
 * @returns {{ command: string, exitCode: number, ok: boolean, stdout: string, stderr: string }}
 */
function runContextDefCommand(command, args) {
  const runner = RUNNERS[command];
  if (!runner) {
    throw new Error(
      "Unknown context-definition command: " +
        String(command) +
        " (expected 'discover' or 'validate')"
    );
  }

  const cliArgs = Array.isArray(args) ? args : [];
  const outChunks = [];
  const errChunks = [];

  const originalArgv = process.argv;
  const originalExit = process.exit;
  const originalLog = console.log;
  const originalError = console.error;

  let exitCode = 0;

  process.argv = ["node", command, ...cliArgs];
  console.log = (...parts) => {
    outChunks.push(parts.join(" "));
  };
  console.error = (...parts) => {
    errChunks.push(parts.join(" "));
  };
  process.exit = (code) => {
    throw new ExitSignal(code);
  };

  try {
    runner();
  } catch (err) {
    if (err instanceof ExitSignal) {
      exitCode = err.code;
    } else {
      process.argv = originalArgv;
      process.exit = originalExit;
      console.log = originalLog;
      console.error = originalError;
      throw err;
    }
  } finally {
    process.argv = originalArgv;
    process.exit = originalExit;
    console.log = originalLog;
    console.error = originalError;
  }

  return {
    command,
    exitCode,
    ok: exitCode === 0,
    stdout: outChunks.join("\n"),
    stderr: errChunks.join("\n"),
  };
}

module.exports = { runContextDefCommand };
