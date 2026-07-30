# Prepare Playbook

**Sub-Phase 1 of 4** | Weeks 0–1

## Purpose

Mobilize the team and set up for success. This phase extends into early system analysis so you arrive at workshops with **reaction materials** — draft diagrams, data insights, and questions to validate — rather than blank-slate questions.

## Week 0: Onboarding

### Checklist

- [ ] Delivery team onboarded to the project
- [ ] Handover documentation received from sales/pre-sales
- [ ] Kickoff meeting conducted
- [ ] Client Salesforce org access granted (production + sandbox/scratch)
- [ ] Knowledge hub established (`artifacts/` folders populated)
- [ ] `artifacts/00 - Project/Project Overview.md` and `Phase Context.md` filled in
- [ ] AI tooling configured and repo cloned

### Key Activities

**Documentation Handover**
- Receive all pre-sales and client documentation
- Drop into `artifacts/00 - Inbox/` for processing
- Run `#sdlc/discover setup` to organize the inbox and seed the registers

**Salesforce Org Access**
- Verify access levels are sufficient for metadata analysis
- Pull org metadata if relevant (object list, field inventory, automation summary)

## Week 1: Analysis & Preparation

### Checklist

- [ ] Salesforce org configuration/metadata analyzed (if org exists)
- [ ] Early process diagrams drafted based on existing documentation
- [ ] Major customizations / configurations identified and documented
- [ ] Targeted technical calls completed as needed
- [ ] Workshop agendas finalized
- [ ] Reaction materials ready for Learn phase

### Key Activities

**System Analysis**
- Explore org configuration: custom objects, fields, automation, integrations
- Identify complexity indicators and customization density
- Document findings in `artifacts/02 - Current State/System Landscape.md`

**Documentation Synthesis**
- Synthesize handover docs into a consolidated current-state view
- Extract commitments from sales, scope ambiguities, known pain points
- Use `#sdlc/discover synthesize` (when registers have initial content)

**Workshop Preparation**
- Design workshop agendas for Learn phase
- Identify key stakeholders per functional area
- Prepare reaction materials for each session
- Use `#sdlc/discover prep-workshop` for each upcoming session

## Outputs

By end of Prepare:
- Team aligned on project context and goals
- Org access established and verified
- Knowledge hub scaffold in place with initial project context
- Early draft process diagrams (if org/docs available)
- Running list of major customizations / configurations
- Workshop agendas with reaction materials prepared

## Skills Used in This Phase

| Prompt | Purpose |
|--------|---------|
| `#sdlc/discover setup` | Project onboarding and register initialization |
| `#sdlc/discover synthesize` | Process handover documentation |
| `#sdlc/discover prep-workshop` | Workshop preparation |
