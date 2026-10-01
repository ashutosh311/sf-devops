# Release → impact-assessment: test observations and proposed fixes

First end-to-end test run: Winter '27 against a client repo, repo-only scope, live release-notes
fetch through a browser tool. Observations are about the skill's behaviour, not the client. Collect
more below as testing continues, then raise one issue and run the Spec Kit flow once.

## A. Input collection (already implemented, uncommitted)

- A1. Inputs were free-text in chat on every surface → native pickers (VS Code) and one MCP
  elicitation form (Claude Code, Copilot where supported). Optional release-notes PDF added.
- A2. To confirm: Copilot client support for MCP elicitation; VS Code file dialog; real PDF conversion.

## B. Quality of the produced assessment

| # | Observation | Evidence | Proposed fix |
|---|---|---|---|
| B1 | A Critical rating rested on a truncated source. | The saved Refresh Token TTL page is exactly 4,096 bytes and stops after the first row of the per-integration-type table — the part that says who is affected. The report notes the cut-off but still rates it Critical. Flows that don't use refresh tokens (JWT bearer, client credentials) are typically unaffected. Likely a cap in the save step; cause not confirmed. | (1) Completeness check after each saved section: flag a size of exactly 4096 (or another round cap), or text ending mid-sentence or mid-table, and re-extract in chunks or via snapshot. (2) Rating rule: a finding whose exposure-deciding part was only partly read cannot be Critical/High; mark it Provisional and name the unread part. (3) Critical items require a full read of their source. (4) The PDF route avoids browser extraction altogether. |
| B2 | "Confirmed exposure" claimed without a causal search. | 275 `with sharing` classes cited for the async sharing-recalculation change; 19 Aura bundles cited for "non-public fields". Neither shows exposure. A quick grep finds 80 Apex files mentioning Group/GroupMember/UserRole — never searched by the agent. | Exposure vocabulary: **Confirmed** requires a hit from a stated search tied to the change (command + count cited); **Possible** = plausible dependency, no hit; **Unknown** = area not visible. Each release item states the search that would show exposure, and the agent runs it. Generic counts are not evidence. |
| B3 | High rating based on an index entry only. | "Remove non-public fields from Aura action responses" and "Use Any API Auth for SOAP login()" were taken from the Release Updates index; the report admits the article wasn't fetched. | Read every Release Update article that is enforced this release or the next, in full — the list is short. Items read only from the index are capped at "Unverified". |
| B4 | Coverage claim was wrong. | Report said no unread section looked relevant, yet the repo has 92 Visualforce pages (one `renderAs="pdf"`) and the unread `rn_vf_accessible_pdf_ru` update applies. The inventory never mentions Visualforce. | Extend the inventory (Visualforce pages, PDF rendering, email templates, Sites). Replace the assertion about unread sections with a term-list check per section. |
| B5 | Repo-only scope cannot answer the top risks. | Connected apps, OAuth flows, named credentials, profiles and flows are outside `manifest/package.xml`. The top Critical items are unverifiable from the repo. | Add a retrieval-scope check at the start of Step 3: compare the manifest to the metadata types the term list needs and list the blind spots. If a blind spot affects a candidate Critical, re-offer the live-org check with that evidence, even if repo-only was chosen. Add a "Verification pack" section: read-only queries / Setup paths and who to ask. Validate any object and field names (e.g. connected apps, OAuth token last-used, login history) against a real org before putting them in the template. |
| B6 | Too long and repetitive; inconsistent. | 39 KB; each finding appears in the priority summary, traceability table and impact areas; ~10 of 25 traceability rows are Low / not applicable. Platform API retirement is Medium in one table and Medium-High in another. Refresh-token timing is "about a month" in one place and "~3 weeks" in another. | Keep one structured findings register (area, rating, exposure, evidence, date, action, confidence, source). Render every view from it. Fixed tiers: Act before a date / Test in preview / Opportunities / Not applicable (one collapsed line). Define a rating rubric (exposure × impact × deadline). Compute relative dates from the assessment date instead of writing prose. |
| B7 | No self-review before writing. | The above slipped through. | Add a pre-write check: every Critical has a fully read source; every Confirmed has a cited search; no date or priority conflicts; every enforced-soon Release Update was read. |

## C. New deliverable: presentable PDF and HTML slide deck

Requested: in addition to the markdown, a polished artifact with colour-coded risk that can be
presented to the client.

- Output: `impact-assessment.html` (slide deck, one self-contained file) and `impact-assessment.pdf`
  (print of the same). PDF via the browser tool when available; otherwise leave the HTML for
  Print → Save as PDF. `.pptx` is out of scope.
- Rendered from the findings register (B6), so it cannot drift from the markdown.
- Layout: executive slide (go/no-go + conditions, rating heatmap, decide-by timeline); top 5–8
  findings with red/amber/green and a distinct "Inferred — verify" marker; questions for the
  integration owners; appendix with the full detail.
- Markdown stays the source of truth.

## D. Cross-cutting

- Render tests for every new invariant above (rating rules, exposure vocabulary, deck generation step).
- Spec: Release Impact MINOR; Otto Surface Impact must cover VS Code, Claude plugin, Copilot pack,
  and the chat fallback when elicitation is unsupported.
