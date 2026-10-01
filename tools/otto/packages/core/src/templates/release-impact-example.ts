import type { FindingsRegister } from "../findings.js";

/**
 * The compact example register carried in the impact-assessment prompt. Typed against the
 * register schema so a shape change fails the build, and validated by a render test so the rules
 * the agent copies from it are the rules the schema enforces.
 */
export const exampleRegister: FindingsRegister = {
  schemaVersion: 1,
  project: "Example Project",
  release: { label: "Winter '27", number: 264 },
  assessedOn: "2026-10-01",
  scope: "repo",
  recommendation: "go-with-conditions",
  conditions: ["Confirm the connected-app inventory in the org before sign-off"],
  featuredOverflow: 0,
  sources: [
    { id: "S-01", title: "Release Updates", location: "artifacts/06 - Reference/sf-release-notes/winter-27/sections/rn_ru.md", obtained: "fetched", completeness: "full" },
    { id: "S-02", title: "Refresh Token Idle TTL", location: "artifacts/06 - Reference/sf-release-notes/winter-27/sections/rn_security_refresh_token_ttl.md", obtained: "fetched", completeness: "partial", unreadPart: "per-integration-type table" },
  ],
  blindSpots: [
    { metadataType: "Connected apps", reason: "not in the retrieval manifest", affects: ["F-02"], check: "Setup > App Manager: list connected apps and their OAuth flows", ask: "Integration owners" },
  ],
  findings: [
    {
      id: "F-01", area: "Profile filtering enforced", tier: "act-before-date", rating: "high",
      ratingBasis: { exposure: "confirmed", impact: "action", deadline: "now" }, exposure: "confirmed",
      search: { command: "grep -rl \"FROM Profile\" force-app --include=*.cls", matchCount: 12 },
      summary: "Users cannot see other profile names without View All Profiles.",
      evidence: "12 Apex classes query Profile; users running them may lose visibility.",
      action: "Assign View All Profiles to the users and integrations that need it.",
      date: "2026-10-15", sourceIds: ["S-01"], caveat: "none", confidence: "high", featured: true,
    },
    {
      id: "F-02", area: "Refresh token idle limit", tier: "act-before-date", rating: "medium",
      ratingBasis: { exposure: "possible", impact: "breaks", deadline: "soon" }, exposure: "possible",
      summary: "Refresh tokens idle for 30 days expire.",
      evidence: "Integration code exists; connected apps are not visible in the repo.",
      action: "Read the full source to confirm, then review integration call frequency.",
      date: "2026-11-04", sourceIds: ["S-02"], caveat: "provisional", confidence: "low", featured: true,
    },
    {
      id: "F-03", area: "Compiler warnings, API 9-19", tier: "not-applicable", rating: "na",
      ratingBasis: { exposure: "none", impact: "improvement", deadline: "later" }, exposure: "none",
      summary: "Apex at API 9.0-19.0 now warns at compile time.",
      evidence: "The oldest Apex API version in the repo is 40.0.",
      action: "None.", sourceIds: ["S-01"], caveat: "none", confidence: "high", featured: false,
    },
  ],
  ownerQuestions: [
    { question: "Which OAuth flow does each integration use, and how often does it call?", forWhom: "Integration owners", findingIds: ["F-02"] },
  ],
};
