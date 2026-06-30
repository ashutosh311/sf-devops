export interface JiraStatus {
  id: string;
  name: string;
  statusCategory: { key: string; name: string };
}

export interface JiraIssueTypeStatuses {
  issueType: string;
  statuses: JiraStatus[];
}

export type JiraFetchResult =
  | { success: true; byType: Record<string, JiraStatus[]> }
  | { success: false; reason: string };

export async function fetchJiraStatuses(
  siteUrl: string,
  projectKey: string,
  credentials: { email: string; apiToken: string }
): Promise<JiraFetchResult> {
  const base64 = Buffer.from(
    `${credentials.email}:${credentials.apiToken}`
  ).toString("base64");

  const url = `${siteUrl.replace(/\/$/, "")}/rest/api/3/project/${projectKey}/statuses`;

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Basic ${base64}`,
        Accept: "application/json",
      },
    });
  } catch (err) {
    return {
      success: false,
      reason: `Network error: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  if (res.status === 401 || res.status === 403) {
    return { success: false, reason: "Authentication failed — check your email and API token" };
  }

  if (res.status === 404) {
    return { success: false, reason: `Project '${projectKey}' not found in ${siteUrl}` };
  }

  if (!res.ok) {
    return { success: false, reason: `JIRA returned HTTP ${res.status}` };
  }

  const data = (await res.json()) as JiraIssueTypeStatuses[];

  const byType: Record<string, JiraStatus[]> = {};
  for (const entry of data) {
    const key = normaliseIssueType(entry.issueType);
    if (key) byType[key] = entry.statuses;
  }

  return { success: true, byType };
}

// Normalise JIRA issue type names to the three keys we care about
function normaliseIssueType(
  raw: string
): "story" | "epic" | "subTask" | null {
  const lower = raw.toLowerCase().replace(/[\s-]/g, "");
  if (lower === "story") return "story";
  if (lower === "epic") return "epic";
  if (lower === "subtask" || lower === "sub-task") return "subTask";
  return null;
}
