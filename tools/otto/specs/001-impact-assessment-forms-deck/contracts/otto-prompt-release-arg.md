# Contract: `otto_prompt` — optional `release` argument

**Tool**: `otto_prompt` (MCP server `otto`). **Change**: additive (MINOR).

| Argument | Type | Required | Meaning |
|---|---|---|---|
| `release` | string | no | Only for `command: "release"` with `skill: "impact-assessment"`: the Salesforce seasonal release the user named, e.g. `Winter '27`. Pre-selects the release in the input form. Ignored otherwise. |

## Behaviour

| Condition | Result |
|---|---|
| `release` + `impact-assessment`, client supports forms | Server shows one form (release, release-notes PDF, extra sources, scope), then returns the rendered instructions followed by an "Inputs already confirmed by the user" block. |
| Same, client has no form support | Server returns the rendered instructions unchanged; the agent asks the same questions in chat (FR-002). |
| Form cancelled or dismissed | Server returns a plain message that the assessment was cancelled; no instructions are returned, nothing is written (FR-004). |
| Malformed "Other" release | The form is shown again (up to three attempts), then the run is cancelled. |
| Any other command or skill | Unchanged. |

## Confirmed-inputs block

Plain text appended after the instructions, produced by one shared function so every surface emits
identical wording. The template matches the phrase `Inputs already confirmed by the user`:

```text
Assess the Salesforce seasonal release **Winter '27 (release 264)** against this org's customisations.

Inputs already confirmed by the user — do not ask for them again:
- Release: Winter '27 (release 264)
- Release-notes PDF: none — fetch the official release notes
- Extra release-note sources: none — use the official release notes only
- Live-org check: no — repository only
```

The plugin command and the Copilot agent wrapper document the same optional argument. VS Code
produces the same block from its pickers.
