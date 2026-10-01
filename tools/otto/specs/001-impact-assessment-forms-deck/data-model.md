# Data Model: Findings register

The register is one JSON document saved as `impact-assessment.findings.json`. It is the single
source from which the markdown, the HTML deck and the PDF are produced (FR-019, FR-023). Field
names are for the contract (see `contracts/findings-register.md`); this file states the rules.

## Register (envelope)

| Field | Rule |
|---|---|
| `schemaVersion` | Integer, starts at 1. Bumped only on a breaking change to this document. |
| `project` | Project name from the Otto config. |
| `release` | `{ label, number }` — e.g. `Winter '27`, `264`. Label matches the form `Winter/Spring/Summer 'yy`. |
| `assessedOn` | ISO date (`YYYY-MM-DD`) of the run. All relative-date wording derives from this. |
| `scope` | `repo` or `repo+live`; plus the sandbox alias when live. |
| `sandbox` | Sandbox alias; required when `scope` is `repo+live`. |
| `recommendation` | `go`, `go-with-conditions` or `not-ready`, with `conditions` (list of short strings, may be empty only for `go`). |
| `sources` | List of Source. |
| `blindSpots` | List of BlindSpot. |
| `featuredOverflow` | Integer ≥ 0: Critical findings not featured because of the cap of 8. |
| `findings` | List of Finding. |
| `ownerQuestions` | List of OwnerQuestion. |

## Finding

| Field | Rule |
|---|---|
| `id` | `F-NN`, unique, stable across updates of the same release. |
| `area` | Short area name (≤ 60 chars). |
| `tier` | One of `act-before-date`, `test-in-preview`, `opportunity`, `not-applicable`. |
| `rating` | `critical`, `high`, `medium`, `low`, or `na`. `na` only with tier `not-applicable`. |
| `ratingBasis` | `{ exposure, impact, deadline }` — the three rubric inputs. `exposure` as above; `impact` ∈ `breaks`, `action`, `improvement`; `deadline` ∈ `now`, `soon`, `later` (see *Rubric*). |
| `exposure` | `confirmed`, `possible`, `unknown` or `none`. `none` (no plausible dependency in the inventory) is allowed only with `rating: na`. |
| `search` | Required when `exposure` is `confirmed`: `{ command, matchCount }`. Optional otherwise. |
| `summary` | What changes (≤ 240 chars). |
| `evidence` | What was found in the project (≤ 320 chars). |
| `action` | What to do (≤ 200 chars). |
| `date` | Optional absolute date (ISO) the change is enforced or retires. |
| `sourceIds` | One or more Source ids the finding rests on. |
| `decidingPartRead` | Optional, ≤ 200 chars. For a finding that cites a partial source: which part was read and why it is the part that decides who is affected. Present ⇒ that partial source no longer caps the finding. Only valid when a partial source is cited; never lifts an index-only source. |
| `caveat` | `none`, `provisional` or `unverified`. |
| `confidence` | `high`, `medium` or `low`. |
| `featured` | Boolean; true for at most 8 findings (the deck's top-findings slides). |

### Cross-field rules (checked by the pre-write self-check and by tests)

1. `rating` is `critical` or `high` only if every Source in `sourceIds` is `full` — or `partial` with
   `decidingPartRead` recorded on the finding (FR-008) — and `caveat` is `none`.
2. `caveat` is `provisional` when any cited Source is `partial` and the finding has no
   `decidingPartRead`, and `unverified` when any cited Source is `index-only`; either caps `rating` at `medium` (FR-008, FR-009). Such a finding's
   `action` begins "Read the full source to confirm".
3. `exposure: confirmed` requires `search` with a non-empty `command` and a non-negative integer
   `matchCount` greater than zero (FR-010, FR-011).
4. `tier: not-applicable` ⇔ `rating: na` ⇔ `exposure: none`.
5. `date`, when present, is an ISO date; the relative wording ("in N days") is computed from
   `assessedOn` and `date` only, and is the same everywhere it appears (FR-022).
6. At most 8 findings have `featured: true`. Critical findings are featured first, earliest `date` first; if more than 8 are Critical, the register records the surplus in `featuredOverflow` and the deck says so on the executive slide (SC-007, spec Edge Cases).
7. `id` values are unique; every `sourceIds` entry refers to an existing Source.

## Source

| Field | Rule |
|---|---|
| `id` | `S-NN`, unique. |
| `title` | Document or section title. |
| `location` | URL or project-relative file path. |
| `obtained` | `fetched`, `converted`, `supplied-markdown` or `pdf`. |
| `completeness` | `full`, `partial`, `index-only` or `unavailable`. |
| `unreadPart` | Required when `completeness` is `partial`: what was not read. |

State change: a Source moves `index-only` → `partial` → `full` as it is read; findings are
re-rated on the update run, never silently.

## BlindSpot

| Field | Rule |
|---|---|
| `metadataType` | The metadata type or area not visible (e.g. a connected-app type). |
| `reason` | Why it is not visible (e.g. not in the retrieval manifest). |
| `affects` | Finding ids (may be empty if only a would-be finding). |
| `check` | The read-only check to run: a Setup path or query. |
| `ask` | Who to ask. |

## OwnerQuestion

`{ question, forWhom, findingIds }` — a question for the owner of an integration or area; feeds
the deck's "questions for owners" slide and the markdown's open questions.

## Rubric (FR-021) and tier rule (FR-020)

Inputs, each assigned from evidence rather than opinion:

- **exposure** — `confirmed` (a stated search matched), `possible` (plausible dependency, no
  match), `unknown` (area not visible to the review), `none` (no plausible dependency).
- **impact** — `breaks` (existing behaviour stops working or security posture drops if nothing is
  done), `action` (an admin or developer step is needed but nothing breaks if it is late),
  `improvement` (new capability, no obligation).
- **deadline** — `now` (already enforced, or enforced within 30 days of `assessedOn`), `soon`
  (enforced in this or the next seasonal release), `later` (after that, or no date given).

Rating before caps (exposure `none` → `na`):

| impact | exposure | deadline `now` | deadline `soon` | deadline `later` |
|---|---|---|---|---|
| breaks | confirmed | critical | high | medium |
| breaks | possible or unknown | high | medium | low |
| action | confirmed | high | medium | low |
| action | possible or unknown | medium | low | low |
| improvement | any | low | low | low |

The caps then apply and always win: a finding with a `partial` or `index-only` source, or whose
sources disagree on a date or version, is limited to `medium` (rules 1–2 above).

Tier (one per finding):

1. `not-applicable` — rating `na`.
2. `opportunity` — impact `improvement`.
3. `act-before-date` — impact `breaks` or `action`, deadline `now` or `soon`.
4. `test-in-preview` — impact `breaks` or `action`, deadline `later`.
