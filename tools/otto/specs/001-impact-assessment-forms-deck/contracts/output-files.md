# Contract: files written by the impact-assessment skill

All under `{paths.artifacts}/releases/salesforce-{season-yy}/` (created if missing). Nothing is
written outside `{paths.artifacts}/` (FR-029). The skill never touches `{paths.forceApp}/`.

| File | New? | Purpose |
|---|---|---|
| `impact-assessment.md` | existing | Authoritative human-readable record (FR-028). |
| `impact-assessment.findings.json` | new | The register — see `findings-register.md`. |
| `impact-assessment.html` | new | Self-contained Slalom-branded slide deck; no network access, fonts or external files needed to open it. |
| `impact-assessment.pdf` | new | Print of the deck. May be absent if no PDF route was available (FR-026); the skill then says how to produce it. |

Source material stays where it is today: `{paths.artifacts}/06 - Reference/sf-release-notes/{season-yy}/`.

## Update runs

If `impact-assessment.md` exists the skill asks update / start again / stop (unchanged). On
update it re-reads the register, regenerates all four files together, and — if the markdown no
longer matches what the register would produce — asks in chat which to keep before overwriting
(FR-027).

## Deck structure (what the shell draws from the register)

1. Title: project, release, assessment date, Slalom branding.
2. Executive: recommendation + conditions, rating heatmap (tier × rating counts), decide-by timeline.
3. Top findings: featured findings, at most 8, one compact card each, with rating, exposure and
   caveat markers.
4. Questions for owners.
5. Blind spots and verification pack.
6. Appendix: every finding (compact table slides) and the sources table.
