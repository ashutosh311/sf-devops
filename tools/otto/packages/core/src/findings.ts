import { z } from "zod";

/**
 * The findings register written by the Release agent's impact-assessment skill
 * (`impact-assessment.findings.json`). It is the single record from which the
 * markdown report, the HTML deck and the PDF are produced. See
 * specs/001-impact-assessment-forms-deck/data-model.md for the rules this encodes.
 *
 * No surface can run this on the agent's behalf; it defines the contract, guards the
 * example the template carries (render tests validate it) and is the foundation for a
 * validator tool if one is ever added.
 */

export const TIERS = ["act-before-date", "test-in-preview", "opportunity", "not-applicable"] as const;
export const RATINGS = ["critical", "high", "medium", "low", "na"] as const;
export const EXPOSURES = ["confirmed", "possible", "unknown", "none"] as const;
export const IMPACTS = ["breaks", "action", "improvement"] as const;
export const DEADLINES = ["now", "soon", "later"] as const;
export const CAVEATS = ["none", "provisional", "unverified"] as const;
export const CONFIDENCES = ["high", "medium", "low"] as const;
export const COMPLETENESS = ["full", "partial", "index-only", "unavailable"] as const;
export const OBTAINED = ["fetched", "converted", "supplied-markdown", "pdf"] as const;
export const RECOMMENDATIONS = ["go", "go-with-conditions", "not-ready"] as const;
export const SCOPES = ["repo", "repo+live"] as const;

/** Featured findings shown in the deck's top-findings section (SC-007). */
export const MAX_FEATURED = 8;

/**
 * The rubric (data-model.md "Rubric"): exposure x impact x deadline -> rating, before the
 * evidence caps. Exposure `none` is always `na`.
 */
export function expectedRating(basis: { exposure: (typeof EXPOSURES)[number]; impact: (typeof IMPACTS)[number]; deadline: (typeof DEADLINES)[number] }): (typeof RATINGS)[number] {
  if (basis.exposure === "none") return "na";
  if (basis.impact === "improvement") return "low";
  const confirmed = basis.exposure === "confirmed";
  const d = basis.deadline;
  if (basis.impact === "breaks") {
    return confirmed ? (d === "now" ? "critical" : d === "soon" ? "high" : "medium") : (d === "now" ? "high" : d === "soon" ? "medium" : "low");
  }
  return confirmed ? (d === "now" ? "high" : d === "soon" ? "medium" : "low") : (d === "now" ? "medium" : "low");
}

/** The tier rule (data-model.md): one tier per finding, from the rubric inputs. */
export function expectedTier(basis: { exposure: (typeof EXPOSURES)[number]; impact: (typeof IMPACTS)[number]; deadline: (typeof DEADLINES)[number] }): (typeof TIERS)[number] {
  if (basis.exposure === "none") return "not-applicable";
  if (basis.impact === "improvement") return "opportunity";
  return basis.deadline === "later" ? "test-in-preview" : "act-before-date";
}

const RATING_ORDER = ["na", "low", "medium", "high", "critical"] as const;

/** The action a capped finding starts with (FR-008, FR-009). */
export const CONFIRM_ACTION_PREFIX = "Read the full source to confirm";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "must be an ISO date (YYYY-MM-DD)");

export const SourceSchema = z.object({
  id: z.string().regex(/^S-\d{2,}$/, "source id must look like S-01"),
  title: z.string().min(1),
  location: z.string().min(1),
  obtained: z.enum(OBTAINED),
  completeness: z.enum(COMPLETENESS),
  /** Required when `completeness` is `partial`: what was not read. */
  unreadPart: z.string().optional(),
});

export const BlindSpotSchema = z.object({
  metadataType: z.string().min(1),
  reason: z.string().min(1),
  affects: z.array(z.string()),
  check: z.string().min(1),
  ask: z.string().min(1),
});

export const OwnerQuestionSchema = z.object({
  question: z.string().min(1),
  forWhom: z.string().min(1),
  findingIds: z.array(z.string()),
});

export const FindingSchema = z.object({
  id: z.string().regex(/^F-\d{2,}$/, "finding id must look like F-01"),
  area: z.string().min(1).max(60),
  tier: z.enum(TIERS),
  rating: z.enum(RATINGS),
  ratingBasis: z.object({
    exposure: z.enum(EXPOSURES),
    impact: z.enum(IMPACTS),
    deadline: z.enum(DEADLINES),
  }),
  exposure: z.enum(EXPOSURES),
  /** Required when `exposure` is `confirmed`: the search that matched. */
  search: z
    .object({ command: z.string(), matchCount: z.number().int().nonnegative() })
    .optional(),
  summary: z.string().min(1).max(240),
  evidence: z.string().min(1).max(320),
  action: z.string().min(1).max(200),
  date: isoDate.optional(),
  sourceIds: z.array(z.string()).min(1),
  /**
   * For a finding that cites a partly read source: which part was read and why it is the part that
   * decides who is affected. When present, the partial source no longer caps the finding
   * (FR-008 is about the deciding part, not the whole document). Never lifts an index-only source.
   */
  decidingPartRead: z.string().min(1).max(200).optional(),
  caveat: z.enum(CAVEATS),
  confidence: z.enum(CONFIDENCES),
  featured: z.boolean(),
});

export const FindingsRegisterSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    project: z.string().min(1),
    release: z.object({ label: z.string().regex(/^(Winter|Spring|Summer) '\d{2}$/), number: z.number().int() }),
    assessedOn: isoDate,
    scope: z.enum(SCOPES),
    /** Sandbox alias when `scope` is `repo+live`. */
    sandbox: z.string().optional(),
    recommendation: z.enum(RECOMMENDATIONS),
    conditions: z.array(z.string()),
    featuredOverflow: z.number().int().nonnegative(),
    sources: z.array(SourceSchema),
    blindSpots: z.array(BlindSpotSchema),
    findings: z.array(FindingSchema),
    ownerQuestions: z.array(OwnerQuestionSchema),
  })
  .superRefine((reg, ctx) => {
    const issue = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message, path });

    if (reg.recommendation !== "go" && reg.conditions.length === 0) {
      issue("recommendation other than `go` needs at least one condition", ["conditions"]);
    }
    if (reg.scope === "repo+live" && !reg.sandbox) {
      issue("scope `repo+live` needs the sandbox alias", ["sandbox"]);
    }

    // Unique ids (rule 7).
    const sourceById = new Map<string, z.infer<typeof SourceSchema>>();
    reg.sources.forEach((s, i) => {
      if (sourceById.has(s.id)) issue(`duplicate source id ${s.id}`, ["sources", i, "id"]);
      sourceById.set(s.id, s);
      if (s.completeness === "partial" && !s.unreadPart) {
        issue(`source ${s.id} is partial and needs unreadPart`, ["sources", i, "unreadPart"]);
      }
    });
    const findingIds = new Set<string>();

    reg.findings.forEach((f, i) => {
      const at = (field: string) => ["findings", i, field];
      if (findingIds.has(f.id)) issue(`duplicate finding id ${f.id}`, at("id"));
      findingIds.add(f.id);

      const cited = f.sourceIds.map((id) => sourceById.get(id));
      f.sourceIds.forEach((id, j) => {
        if (!sourceById.has(id)) issue(`${f.id} cites unknown source ${id}`, ["findings", i, "sourceIds", j]);
      });
      const known = cited.filter((s): s is z.infer<typeof SourceSchema> => Boolean(s));

      // Rules 1–2: evidence caps (FR-008, FR-009). A partly read source caps a finding unless the
      // finding records that the part deciding who is affected was read (`decidingPartRead`).
      const hasPartial = known.some((s) => s.completeness === "partial");
      const hasIndexOnly = known.some((s) => s.completeness === "index-only");
      const hasUnavailable = known.some((s) => s.completeness === "unavailable");
      const partialCovered = hasPartial && Boolean(f.decidingPartRead);
      const uncoveredPartial = hasPartial && !partialCovered;
      const everySourceUsable = known.length > 0 && !hasIndexOnly && !hasUnavailable && !uncoveredPartial;
      const needsCap = hasIndexOnly || hasUnavailable || uncoveredPartial;

      if (f.decidingPartRead && !hasPartial) {
        issue(`${f.id}: decidingPartRead only applies to a finding that cites a partial source`, at("decidingPartRead"));
      }
      if ((f.rating === "critical" || f.rating === "high") && (!everySourceUsable || f.caveat !== "none")) {
        issue(`${f.id}: Critical/High requires every cited source read in full (or its deciding part recorded) and no caveat`, at("rating"));
      }
      if (hasIndexOnly && f.caveat !== "unverified") {
        issue(`${f.id}: an index-only source requires caveat \`unverified\``, at("caveat"));
      } else if (uncoveredPartial && !hasIndexOnly && f.caveat !== "provisional") {
        issue(`${f.id}: a partial source requires caveat \`provisional\` (or record decidingPartRead)`, at("caveat"));
      }
      if (needsCap && !f.action.startsWith(CONFIRM_ACTION_PREFIX)) {
        issue(`${f.id}: a capped finding's action must begin "${CONFIRM_ACTION_PREFIX}"`, at("action"));
      }

      // Rule 3: Confirmed needs a search with a hit (FR-010, FR-011).
      if (f.exposure === "confirmed" && (!f.search || !f.search.command.trim() || f.search.matchCount < 1)) {
        issue(`${f.id}: confirmed exposure needs a search with a command and a match count above zero`, at("search"));
      }

      // Rule 4: not-applicable <=> na <=> exposure none.
      const na = [f.tier === "not-applicable", f.rating === "na", f.exposure === "none"];
      if (na.some(Boolean) && !na.every(Boolean)) {
        issue(`${f.id}: tier \`not-applicable\`, rating \`na\` and exposure \`none\` go together`, at("rating"));
      }
      if (f.ratingBasis.exposure !== f.exposure) {
        issue(`${f.id}: ratingBasis.exposure must equal exposure`, at("ratingBasis"));
      }

      // Rubric and tier rule (FR-020, FR-021): the rating is the rubric's, unless a caveat caps it
      // lower (never above Medium); the tier always follows the rubric inputs.
      const expected = expectedRating(f.ratingBasis);
      const rank = (r: (typeof RATINGS)[number]) => RATING_ORDER.indexOf(r);
      if (f.caveat === "none") {
        if (f.rating !== expected) {
          issue(`${f.id}: rating \`${f.rating}\` does not follow the rubric for ${f.ratingBasis.exposure}/${f.ratingBasis.impact}/${f.ratingBasis.deadline} (expected \`${expected}\`)`, at("rating"));
        }
      } else if (rank(f.rating) > Math.min(rank(expected), rank("medium"))) {
        issue(`${f.id}: a ${f.caveat} finding is capped at Medium and may not exceed the rubric rating (\`${expected}\`)`, at("rating"));
      }
      if (f.tier !== expectedTier(f.ratingBasis)) {
        issue(`${f.id}: tier \`${f.tier}\` does not follow the tier rule (expected \`${expectedTier(f.ratingBasis)}\`)`, at("tier"));
      }
    });

    // Blind spots and owner questions point at real findings.
    reg.blindSpots.forEach((b, i) =>
      b.affects.forEach((id, j) => {
        if (!findingIds.has(id)) issue(`blind spot cites unknown finding ${id}`, ["blindSpots", i, "affects", j]);
      })
    );
    reg.ownerQuestions.forEach((q, i) =>
      q.findingIds.forEach((id, j) => {
        if (!findingIds.has(id)) issue(`owner question cites unknown finding ${id}`, ["ownerQuestions", i, "findingIds", j]);
      })
    );

    // Rule 6: featured cap, Critical first by earliest date, overflow recorded (SC-007).
    const featured = reg.findings.filter((f) => f.featured);
    if (featured.length > MAX_FEATURED) {
      issue(`at most ${MAX_FEATURED} findings may be featured (found ${featured.length})`, ["findings"]);
    }
    const critical = reg.findings.filter((f) => f.rating === "critical");
    const criticalNotFeatured = critical.filter((f) => !f.featured).length;
    if (reg.featuredOverflow !== criticalNotFeatured) {
      issue(
        `featuredOverflow must equal the number of Critical findings not featured (${criticalNotFeatured})`,
        ["featuredOverflow"]
      );
    }
    if (criticalNotFeatured > 0) {
      // Critical findings are featured first, earliest date first: when any is left out the
      // featured set must be full of Critical findings, all dated no later than the ones left out.
      const featuredCritical = critical.filter((f) => f.featured);
      if (featuredCritical.length !== MAX_FEATURED) {
        issue("Critical findings must fill the featured slots before any other finding", ["findings"]);
      }
      const when = (f: Finding) => f.date ?? "9999-12-31";
      const latestFeatured = featuredCritical.map(when).sort().pop() ?? "";
      const earliestLeftOut = critical.filter((f) => !f.featured).map(when).sort()[0] ?? "";
      if (latestFeatured > earliestLeftOut) {
        issue("featured Critical findings must be the ones with the earliest dates", ["findings"]);
      }
    }
  });

export type Source = z.infer<typeof SourceSchema>;
export type Finding = z.infer<typeof FindingSchema>;
export type BlindSpot = z.infer<typeof BlindSpotSchema>;
export type OwnerQuestion = z.infer<typeof OwnerQuestionSchema>;
export type FindingsRegister = z.infer<typeof FindingsRegisterSchema>;

/** Convenience for tests and callers: returns the rule messages, empty when valid. */
export function validateFindingsRegister(value: unknown): string[] {
  const result = FindingsRegisterSchema.safeParse(value);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}
