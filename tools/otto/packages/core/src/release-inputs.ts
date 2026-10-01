/**
 * Inputs for the Release agent's impact-assessment skill, collected by each front
 * end with its own widgets (VS Code pickers, MCP elicitation forms) and handed to
 * the agent as a pre-confirmed block so the template doesn't ask for them again.
 *
 * Lives in core so every surface proposes the same releases, validates the same
 * way and words the confirmed block identically — the template keys off that text.
 */

const SEASONS = ["Winter", "Spring", "Summer"] as const;
type Season = (typeof SEASONS)[number];

/** Anchor: Winter '27 = release 264 (API 68.0); each following season adds 2. */
const ANCHOR_YY = 27;
const ANCHOR_RELEASE = 264;

export interface SeasonalRelease {
  /** e.g. `Winter '27` */
  label: string;
  /** Salesforce release number, e.g. 264 */
  release: number;
}

function toRelease(season: Season, yy: number): SeasonalRelease {
  const n = 3 * (yy - ANCHOR_YY) + SEASONS.indexOf(season);
  return { label: `${season} '${yy}`, release: ANCHOR_RELEASE + 2 * n };
}

/**
 * Parses `Winter '27` / `spring 27` / `Summer’28`. The release number is derived
 * from the anchor, so it is only as reliable as Salesforce's +2-per-season cadence
 * — the template still checks the loaded page title against it.
 */
export function parseSeasonalRelease(text: string): SeasonalRelease | undefined {
  const m = /^\s*(winter|spring|summer)\s*['’]?\s*(\d{2})\s*$/i.exec(text);
  if (!m) return undefined;
  const season = SEASONS.find((s) => s.toLowerCase() === m[1].toLowerCase())!;
  return toRelease(season, Number(m[2]));
}

/**
 * The next four seasonal releases that haven't finished shipping. Winter ships in
 * October of the previous calendar year, Spring in February, Summer in June.
 */
export function upcomingSeasonalReleases(now: Date = new Date()): SeasonalRelease[] {
  const out: SeasonalRelease[] = [];
  for (let n = -3; out.length < 4; n++) {
    const season = SEASONS[((n % 3) + 3) % 3];
    const yy = ANCHOR_YY + Math.floor(n / 3);
    const shipYear = 2000 + (season === "Winter" ? yy - 1 : yy);
    const shipMonth = season === "Winter" ? 9 : season === "Spring" ? 1 : 5;
    // End of the shipping month, so the release stays listed while it is rolling out.
    if (new Date(shipYear, shipMonth + 1, 0) >= now) out.push(toRelease(season, yy));
  }
  return out;
}

/**
 * What to pre-select when the user typed a release with the command: the parsed release, and
 * whether it is one of the proposed upcoming releases (otherwise it belongs under "Other").
 * Shared so the VS Code picker and the MCP form pre-select identically.
 */
export function resolveTypedRelease(
  typed: string | undefined,
  now: Date = new Date()
): { release: SeasonalRelease; inList: boolean } | undefined {
  const release = typed ? parseSeasonalRelease(typed) : undefined;
  if (!release) return undefined;
  return { release, inList: upcomingSeasonalReleases(now).some((r) => r.label === release.label) };
}

export interface ImpactAssessmentInputs {
  release: SeasonalRelease;
  /** Free text: URLs / project file paths, comma separated. Blank = official notes only. */
  extraSources?: string;
  /** Path to the seasonal release notes as a PDF. Preferred over fetching the live pages. */
  releaseNotesPdf?: string;
  liveOrg: boolean;
  /** Sandbox alias, named in the block when a live check was chosen. */
  sandbox?: string;
}

/**
 * The request handed to the agent. The "Inputs already confirmed by the user"
 * phrase is matched by the release-impact-assessment template — change both together.
 */
export function formatImpactAssessmentInputs(i: ImpactAssessmentInputs): string {
  const releaseText = `${i.release.label} (release ${i.release.release})`;
  const extras = i.extraSources?.trim();
  const pdf = i.releaseNotesPdf?.trim();
  return [
    `Assess the Salesforce seasonal release **${releaseText}** against this org's customisations.`,
    "",
    "Inputs already confirmed by the user — do not ask for them again:",
    `- Release: ${releaseText}`,
    `- Release-notes PDF: ${pdf ? `${pdf} — use this as the primary source` : "none — fetch the official release notes"}`,
    `- Extra release-note sources: ${extras ? extras : "none — use the official release notes only"}`,
    `- Live-org check: ${i.liveOrg ? `yes${i.sandbox ? `, against the sandbox ${i.sandbox}` : ""}` : "no — repository only"}`,
  ].join("\n");
}
