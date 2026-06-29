// Raw content URL for the standards files in sf-uki-devops on Slalom's Bitbucket.
// Format: /raw/{branch}/{path}
const BB_BASE =
  "https://bitbucket.org/slalom-consulting/sf-uki-devops/raw/main/devops/standards";

const STANDARD_FILES = [
  "README.md",
  "apex.md",
  "lwc.md",
  "configuration.md",
  "data-model.md",
  "git.md",
  "omniscript.md",
  "ux-accessibility.md",
] as const;

// Thin stubs — written only when the network fetch fails (offline / token missing).
// Intentionally minimal so the user knows to fix the problem rather than accidentally
// shipping placeholder content in a client project.
const FALLBACK: Record<string, string> = {
  "README.md":
    "# Standards\n\n_Could not fetch from sf-uki-devops — check your Bitbucket token and run `/init` again._\n",
  "apex.md":
    "# Apex Development Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/apex.md`._\n",
  "lwc.md":
    "# LWC Development Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/lwc.md`._\n",
  "configuration.md":
    "# Configuration Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/configuration.md`._\n",
  "data-model.md":
    "# Data Model Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/data-model.md`._\n",
  "git.md":
    "# Git Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/git.md`._\n",
  "omniscript.md":
    "# OmniStudio Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/omniscript.md`._\n",
  "ux-accessibility.md":
    "# UX & Accessibility Standards\n\n_Fetch failed — see `bitbucket.org/slalom-consulting/sf-uki-devops/src/main/devops/standards/ux-accessibility.md`._\n",
};

/**
 * Fetch the latest standards from sf-uki-devops on Slalom's Bitbucket.
 * Requires a Bitbucket HTTP access token (repository read scope).
 * Falls back to thin stubs per file on fetch failure so the caller always gets a
 * complete map — the stubs tell the user to fix connectivity and re-run /init.
 */
export async function fetchStandards(token: string): Promise<Record<string, string>> {
  const headers = { Authorization: `Bearer ${token}` };
  const results: Record<string, string> = {};

  await Promise.all(
    STANDARD_FILES.map(async (file) => {
      try {
        const res = await fetch(`${BB_BASE}/${file}`, { headers });
        results[file] = res.ok ? await res.text() : FALLBACK[file];
      } catch {
        results[file] = FALLBACK[file];
      }
    })
  );

  return results;
}
