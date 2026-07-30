# Plan Playbook

**Sub-Phase 4 of 4** | Weeks 5–6 (typical)

## Purpose

Prepare the backlog and supporting materials for implementation. This is primarily documentation and alignment work — packaging everything from discovery into formats appropriate for different stakeholders, defining MVP scope tightly, and closing out discovery through risk gates.

## Checklist

- [ ] High-level backlog created in `Backlog Tracker.xlsx` (epics, features, stories)
- [ ] MVP scope defined with stakeholder alignment
- [ ] In-scope vs out-of-scope clearly documented
- [ ] Current state process diagrams finalized
- [ ] Current state architecture / system documentation finalized
- [ ] Ideate session notes and solution directions documented
- [ ] Executive readout / slide deck created
- [ ] Technical readout materials created
- [ ] Risk gate meeting conducted
- [ ] `#sdlc/discover push-backlog` run — PM tool items created and Excel archived
- [ ] Discovery phase formally closed out

## Key Activities

### Backlog Development

Transform solution directions into a structured backlog at the epic, feature, and story level.

- Use `#sdlc/discover manage-backlog` to seed `artifacts/04 - Backlog/Backlog Tracker.xlsx` from validated pain points and requirements in `00 - Registers/`
- Review and edit the Excel file — adjust story titles, sizes, and priorities
- Work through one epic at a time; ensure traceability: pain point → solution direction → story
- Use `#sdlc/discover analyze` in coverage mode to validate pain-point-to-story linkage

### MVP Scope Definition

Define what's in and what's out — keep it tight.

- Use prioritized pain points and focus areas to define MVP boundaries
- Document explicitly in `artifacts/04 - Backlog/MVP Scope.md`
- Reference decision register for borderline scope decisions
- Get stakeholder sign-off on scope boundaries

### Push to PM Tool

Once the backlog is reviewed and approved:

- Run `#sdlc/discover push-backlog` to:
  1. Read `Backlog Tracker.xlsx`
  2. Update `_index.md` and `epics/<id>.md` mirror (shows diff for confirmation)
  3. Create epics and stories in the PM tool via its MCP (Atlassian for JIRA, Azure DevOps for ADO)
  4. Archive `Backlog Tracker.xlsx` to `04 - Backlog/pushed/`

After push, the PM tool is the source of truth. Use `#sdlc/discover sync-pm` to pull status back to `pm-sync.md`.

### Stakeholder Communication

| Audience | Format | Content |
|----------|--------|---------|
| **Executive** | Slide deck | Findings summary, scope, roadmap, business case |
| **Technical** | Documentation | Architecture, complexity notes, integration considerations |
| **Business Users** | Process docs | What's changing, why, impact to their work |

Use `#sdlc/discover compose-deliverable` to generate executive and technical readouts.

### Risk Gate & Closeout

- Review all documented risks and unresolved conflicts
- Convert open conflicts to risks in `00 - Registers/`
- Use `#sdlc/discover conflict-check` for final audit
- Use `#sdlc/discover hub-audit` for final completeness and phase-gate checks
- Conduct risk gate meeting with key stakeholders
- Obtain sign-off to proceed to `#sdlc/refine`

## Outputs

By end of Plan:
- Backlog seeded, reviewed, and pushed to JIRA
- `04 - Backlog/pushed/Backlog Tracker - YYYY-MM-DD.xlsx` archived
- `04 - Backlog/push-record.md` with JIRA keys created
- MVP scope definition (tight, stakeholder-aligned)
- Finalized current state diagrams
- Solution direction documentation
- Executive readout and technical readout
- Risk documentation with mitigations
- Risk gate passed
- Complete knowledge base ready for `#sdlc/refine` / `#sdlc/design`

## Skills Used in This Phase

| Prompt | Purpose |
|--------|---------|
| `#sdlc/discover manage-backlog` | Backlog initialization from registers |
| `#sdlc/discover push-backlog` | Excel → PM tool push and Excel archive |
| `#sdlc/discover sync-pm` | Pull PM tool status back to repo |
| `#sdlc/discover analyze` | Coverage-mode traceability validation |
| `#sdlc/discover compose-deliverable` | Executive / technical deliverable assembly |
| `#sdlc/discover synthesize` | Final documentation synthesis |
| `#sdlc/discover conflict-check` | Final conflict / risk audit |
| `#sdlc/discover hub-audit` | Completeness, phase-gate, and deliverable QA |
