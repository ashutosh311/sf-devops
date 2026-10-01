# Contract: findings register file

**File**: `{paths.artifacts}/releases/salesforce-{season-yy}/impact-assessment.findings.json`
**Written by**: the impact-assessment skill. **Read by**: the deck shell (embedded copy), the next
update run, and tests. Field rules and cross-field invariants: see `../data-model.md`.

## Shape (abridged example — the template carries the full example, validated by tests)

```json
{
  "schemaVersion": 1,
  "project": "Example Project",
  "release": { "label": "Winter '27", "number": 264 },
  "assessedOn": "2026-10-01",
  "scope": "repo",
  "recommendation": "go-with-conditions",
  "conditions": ["Confirm the connected-app inventory in the org before sign-off"],
  "sources": [
    { "id": "S-01", "title": "Refresh Token Idle TTL", "location": "artifacts/06 - Reference/sf-release-notes/winter-27/sections/rn_security_refresh_token_ttl.md",
      "obtained": "fetched", "completeness": "partial", "unreadPart": "per-integration-type table" }
  ],
  "blindSpots": [
    { "metadataType": "Connected apps", "reason": "not in the retrieval manifest", "affects": ["F-01"],
      "check": "Setup → App Manager", "ask": "Integration owners" }
  ],
  "findings": [
    { "id": "F-01", "area": "Refresh token idle limit", "tier": "act-before-date", "rating": "medium",
      "ratingBasis": { "exposure": "possible", "impact": "needs-action", "deadline": "this-or-next-release" },
      "exposure": "possible", "summary": "Idle refresh tokens expire after 30 days.",
      "evidence": "Integration activity present; connected apps not visible in the repo.",
      "action": "Read the full source to confirm, then review integration call frequency.",
      "date": "2026-11-04", "sourceIds": ["S-01"], "caveat": "provisional", "confidence": "low", "featured": true }
  ],
  "ownerQuestions": [
    { "question": "Which OAuth flow does each integration use?", "forWhom": "Integration owners", "findingIds": ["F-01"] }
  ]
}
```

## Guarantees

- Valid JSON, UTF-8, two-space indent, no comments.
- Contains no value that the markdown report omits (FR-028).
- Contains no client secrets, tokens or personal data; evidence strings quote metadata names and
  counts, not data.
- `schemaVersion` changes only on a breaking change; adding optional fields does not bump it.
