import * as fs from "node:fs";
import * as path from "node:path";

// Per-project config directory committed to the (shared) client repo. Renamed
// from the pre-Otto `.sdlc` to `.otto`. Because this directory is committed and
// shared across a team, the rename must be handled with a permanent read-both:
// a repo initialised as `.sdlc` keeps using `.sdlc` so teammates still on the
// old tool version are never broken; only a brand-new `/init` creates `.otto`.
export const OTTO_CONFIG_DIR = ".otto";
export const LEGACY_CONFIG_DIR = ".sdlc";

/**
 * Resolve the config directory to use inside a project root.
 *
 * Prefers `.otto` when it already holds a config, then falls back to legacy
 * `.sdlc`. When neither exists (a fresh `/init`) it returns `.otto`, so new
 * projects adopt the new name while existing projects stay on whatever they
 * were initialised with.
 *
 * This one resolver serves reads, writes and fresh init:
 *  - reads   → the existing dir is returned
 *  - writes  → writes land in whichever dir already exists (never splits a repo)
 *  - init    → neither exists, so `.otto` is created
 */
export function resolveConfigDir(root: string): string {
  const otto = path.join(root, OTTO_CONFIG_DIR);
  if (fs.existsSync(path.join(otto, "config.json"))) return otto;

  const legacy = path.join(root, LEGACY_CONFIG_DIR);
  if (fs.existsSync(path.join(legacy, "config.json"))) return legacy;

  return otto;
}

/** Absolute path to the resolved `config.json` for a project root. */
export function resolveConfigPath(root: string): string {
  return path.join(resolveConfigDir(root), "config.json");
}
