// Standards are bundled from this repo's `devops/standards/` at build time via
// tsup's `.md` text loader (same pattern as engine.ts instructions). No network
// fetch or Bitbucket token is required — the tool ships the standards it was built with.
import readmeStandard          from "../../../../../devops/standards/README.md";
import apexStandard            from "../../../../../devops/standards/apex.md";
import lwcStandard             from "../../../../../devops/standards/lwc.md";
import configurationStandard   from "../../../../../devops/standards/configuration.md";
import dataModelStandard       from "../../../../../devops/standards/data-model.md";
import gitStandard             from "../../../../../devops/standards/git.md";
import omniscriptStandard      from "../../../../../devops/standards/omniscript.md";
import uxAccessibilityStandard from "../../../../../devops/standards/ux-accessibility.md";

const STANDARDS: Record<string, string> = {
  "README.md": readmeStandard,
  "apex.md": apexStandard,
  "lwc.md": lwcStandard,
  "configuration.md": configurationStandard,
  "data-model.md": dataModelStandard,
  "git.md": gitStandard,
  "omniscript.md": omniscriptStandard,
  "ux-accessibility.md": uxAccessibilityStandard,
};

/**
 * Returns the Slalom development standards bundled with the tool.
 * These are generated from `devops/standards/` at build time, so `/init` works
 * fully offline and needs no credentials.
 */
export function getStandards(): Record<string, string> {
  return { ...STANDARDS };
}
