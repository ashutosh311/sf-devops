---
title: Sandbox Access and Deployment Standards
description: Standard procedure for connecting to a Salesforce sandbox and deploying metadata. Referenced by all SDLC agents that perform deployments — build, test, release.
scope: deployment, devops, sandbox
enforce: always
---

# Sandbox Access and Deployment Standards

Agents MUST follow this procedure whenever metadata is about to be deployed to a Salesforce org. Do not skip or abbreviate any step.

> **Tool preference:** Use the **Salesforce DX MCP tools** for every operation that has an MCP equivalent — `get_username`, `list_all_orgs`, `run_soql_query`, `retrieve_metadata`, `deploy_metadata`, `run_apex_test`, `assign_permission_set`, `open_org`. Their exact names depend on your host (e.g. `mcp__Salesforce_DX__get_username` in Claude Code, `Salesforce_DX-get_username` in the Copilot App) — match the Salesforce DX MCP server segment rather than a fixed prefix. Only fall back to a `sf …` CLI command via Bash for operations that have no MCP equivalent (notably the interactive web-login flow `sf org login web`). When you do fall back to a CLI command, call it out to the user.

---

## 1. Review Generated Files Before Deploying

Before any deployment is attempted, display a structured summary of every file that will be deployed:

```
Files to deploy:
  force-app/main/default/objects/...
  force-app/main/default/classes/...
  force-app/main/default/triggers/...
  ...
```

Then ask:

> "The above files have been generated locally. Please review them before we deploy.
> Are you happy with the changes? Type **yes** to proceed or let me know what needs to be adjusted."

Do not proceed with any deployment until the user explicitly confirms.

---

## 2. Identify the Target Sandbox

### 2a — Check current default org (via SF MCP)

Call the Salesforce DX MCP's `get_username` tool to retrieve the current default target-org username.

If a default org is returned, display it and ask:

> "The current default target org is **{username}**. Is this the sandbox you want to deploy to, or would you like to use a different one?"

If the user confirms → skip to Step 3.

### 2b — No default org, or user wants a different one

Call the Salesforce DX MCP's `list_all_orgs` tool to list all authenticated orgs. Present the list and ask:

> "Which sandbox would you like to deploy to? Pick from the orgs above, or tell me if the target sandbox is not yet authenticated and I'll guide you through the web-login flow."

Record the username/alias the user picks as `{TARGET}`.

---

## 3. Authenticate to the Sandbox (if needed)

If the target org is already in the `list_all_orgs` output, skip this step.

Web login (`sf org login web`) has no MCP equivalent — fall back to the CLI for this one operation, and call it out to the user:

```bash
sf org login web --alias {TARGET} --instance-url https://test.salesforce.com
```

> **Note:** Use `--instance-url https://login.salesforce.com` for production or developer orgs. Use `https://test.salesforce.com` for all sandboxes.

After authentication completes, re-call the Salesforce DX MCP's `list_all_orgs` tool to verify the org now appears, then confirm the username matches what the user expects before continuing.

---

## 4. Set as the Session Target Org

If the chosen `{TARGET}` is not already the default returned by `get_username`, set it via the CLI (no MCP equivalent for setting the default):

```bash
sf config set target-org {TARGET}
```

Confirm:

> "Target org set to **{TARGET}**. Proceeding with deployment."

---

## 5. Deploy Metadata (via SF MCP)

Deploy via the **Salesforce DX MCP**:

- Call the Salesforce DX MCP's `deploy_metadata` tool with `sourceDir` set to the component path you actually changed (a specific object or class folder), not the entire `force-app/` tree unless the whole tree is genuinely in scope.
- Inspect the structured deploy result — surface any failed components and error messages verbatim.

### On deployment failure

1. Read the full error output carefully.
2. Diagnose the root cause — do not guess or retry blindly.
3. Fix the issue in the local metadata files.
4. Re-run the review step (Step 1 above) so the user can see what changed.
5. Re-call the Salesforce DX MCP's `deploy_metadata` tool only when the user confirms again.

Do not move to the next SDLC step with a failed or partially-failed deployment. Do **not** fall back to a `sf project deploy start` Bash invocation unless the MCP call itself errors with a tool-level failure (not a deployment failure).

---

## 6. Confirm Successful Deployment

After a successful deploy, show the deployment summary from the MCP result and confirm:

> "Deployment to **{TARGET}** completed successfully.
> Components deployed: {count}
> Please validate the key scenarios in the org before we proceed."

List the validation scenarios from the solution design (acceptance criteria or test considerations). Wait for the user to confirm validation is complete before transitioning any JIRA tickets or raising a PR.
