import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { httpJson, num, str, strArr } from "../utils.js";
import type { EnvSource } from "../utils.js";

export function jiraModule(env: EnvSource): { defs: ToolDef[]; enabled: boolean; reason?: string } {
  const base = (env.get("JIRA_BASE_URL") ?? "").replace(/\/+$/, "");
  const apiToken = env.get("JIRA_API_TOKEN");
  const email = env.get("JIRA_EMAIL");

  // Jira Cloud uses Basic auth (email + API token) or a personal access token (Bearer).
  const authHeader = email
    ? `Basic ${Buffer.from(`${email}:${apiToken ?? ""}`).toString("base64")}`
    : `Bearer ${apiToken ?? ""}`;

  const headers: Record<string, string> = {
    Authorization: authHeader,
    Accept: "application/json",
    "Content-Type": "application/json",
  };

  async function jira(pathname: string, init: RequestInit = {}): Promise<unknown> {
    const res = await httpJson(`${base}${pathname}`, {
      ...init,
      headers: { ...headers, ...(init.headers as Record<string, string> | undefined) },
    });
    if (res.status >= 400) {
      const body = res.body as
        | { errorMessages?: string[]; errors?: Record<string, unknown>; message?: string }
        | undefined;
      const detail =
        body?.errorMessages?.join("; ") ||
        body?.message ||
        (body?.errors && Object.keys(body.errors).length ? JSON.stringify(body.errors) : "");
      throw new Error(`Jira ${pathname} failed (HTTP ${res.status})${detail ? `: ${detail}` : ""}`);
    }
    return res.body;
  }

  const jiraDefs: ToolDef[] = [
    {
      name: "jira_search_issues",
      description:
        "Search Jira issues with JQL (e.g. \"project = DEMO AND status = 'In Progress'\"). Returns issue keys, summaries, statuses and more.",
      inputSchema: {
        type: "object",
        properties: {
          jql: { type: "string", description: "JQL query" },
          max_results: { type: "integer", minimum: 1, maximum: 100, description: "Default 50" },
          fields: { type: "array", items: { type: "string" }, description: "Fields to return (default: key, summary, status, assignee, priority)" },
        },
        required: ["jql"],
      },
      handler: (args) =>
        jira("/rest/api/3/search", {
          method: "POST",
          body: JSON.stringify({
            jql: str(args.jql),
            maxResults: num(args.max_results, 50),
            fields: strArr(args.fields).length
              ? strArr(args.fields)
              : ["summary", "status", "assignee", "priority", "issuetype", "created", "updated"],
          }),
        }).then(jsonResult),
    },
    {
      name: "jira_get_issue",
      description: "Get a single issue by key (e.g. DEMO-123) with all its fields.",
      inputSchema: {
        type: "object",
        properties: {
          issue_key: { type: "string" },
          fields: { type: "array", items: { type: "string" }, description: "Optional fields to limit to" },
        },
        required: ["issue_key"],
      },
      handler: (args) =>
        jira(
          `/rest/api/3/issue/${encodeURIComponent(str(args.issue_key))}${strArr(args.fields).length ? `?fields=${strArr(args.fields).join(",")}` : ""}`,
        ).then(jsonResult),
    },
    {
      name: "jira_create_issue",
      description: "Create a Jira issue (task/story/bug/…). Parent key creates a sub-task under it.",
      inputSchema: {
        type: "object",
        properties: {
          project_key: { type: "string", description: "Project key (e.g. DEMO)" },
          summary: { type: "string" },
          issuetype: { type: "string", description: "Issue type name, default Task" },
          description: { type: "string", description: "Description in plain text or Jira wiki markup" },
          priority: { type: "string", description: "e.g. High, Medium, Low" },
          labels: { type: "array", items: { type: "string" } },
          assignee: { type: "string", description: "Account ID or username" },
          parent_key: { type: "string", description: "Parent issue key to create a sub-task" },
        },
        required: ["project_key", "summary"],
      },
      handler: (args) => {
        const fields: Record<string, unknown> = {
          project: { key: str(args.project_key) },
          summary: str(args.summary),
          issuetype: { name: str(args.issuetype, "Task") },
        };
        if (str(args.description)) fields.description = str(args.description);
        if (str(args.priority)) fields.priority = { name: str(args.priority) };
        if (strArr(args.labels).length) fields.labels = strArr(args.labels);
        if (str(args.assignee)) fields.assignee = { accountId: str(args.assignee) };
        if (str(args.parent_key)) fields.parent = { key: str(args.parent_key) };
        return jira("/rest/api/3/issue", { method: "POST", body: JSON.stringify({ fields }) }).then(jsonResult);
      },
    },
    {
      name: "jira_update_issue",
      description: "Update issue fields: summary, description, priority, labels, or assignee (account ID).",
      inputSchema: {
        type: "object",
        properties: {
          issue_key: { type: "string" },
          summary: { type: "string" },
          description: { type: "string" },
          priority: { type: "string" },
          labels: { type: "array", items: { type: "string" }, description: "Full replacement list" },
          assignee: { type: "string", description: "Account ID (set to empty string to unassign)" },
        },
        required: ["issue_key"],
      },
      handler: (args) => {
        const fields: Record<string, unknown> = {};
        if (args.summary !== undefined) fields.summary = str(args.summary);
        if (args.description !== undefined) fields.description = str(args.description);
        if (args.priority !== undefined) fields.priority = { name: str(args.priority) };
        if (args.labels !== undefined) fields.labels = strArr(args.labels);
        if (args.assignee !== undefined) fields.assignee = str(args.assignee) ? { accountId: str(args.assignee) } : null;
        return jira(`/rest/api/3/issue/${encodeURIComponent(str(args.issue_key))}`, {
          method: "PUT",
          body: JSON.stringify({ fields }),
        }).then(() => jsonResult({ ok: true, message: `Updated ${str(args.issue_key)}` }));
      },
    },
    {
      name: "jira_list_transitions",
      description: "List the available workflow transitions (status moves) for an issue.",
      inputSchema: {
        type: "object",
        properties: { issue_key: { type: "string" } },
        required: ["issue_key"],
      },
      handler: (args) => jira(`/rest/api/3/issue/${encodeURIComponent(str(args.issue_key))}/transitions`).then(jsonResult),
    },
    {
      name: "jira_transition_issue",
      description: "Move an issue to a new status by transition name or ID (e.g. \"In Progress\", \"Done\", \"In Review\").",
      inputSchema: {
        type: "object",
        properties: {
          issue_key: { type: "string" },
          transition: { type: "string", description: "Transition name (case-insensitive) or numeric ID" },
          comment: { type: "string", description: "Optional comment added during the transition" },
        },
        required: ["issue_key", "transition"],
      },
      handler: async (args) => {
        const key = str(args.issue_key);
        const wanted = str(args.transition);
        const list = (await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`)) as {
          transitions?: { id: string; name: string }[];
        };
        const found = list.transitions?.find(
          (t) => t.id === wanted || t.name.toLowerCase() === wanted.toLowerCase(),
        );
        if (!found) {
          const names = (list.transitions ?? []).map((t) => t.name).join(", ");
          throw new Error(
            `No transition "${wanted}" on ${key}. Available: ${names || "(none)"}. ` +
              "Run jira_list_transitions for the full list.",
          );
        }
        const body: Record<string, unknown> = { transition: { id: found.id } };
        if (str(args.comment)) body.update = { comment: [{ add: { body: str(args.comment) } }] };
        await jira(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
          method: "POST",
          body: JSON.stringify(body),
        });
        return jsonResult({ ok: true, message: `Moved ${key} to "${found.name}"` });
      },
    },
    {
      name: "jira_add_comment",
      description: "Add a comment to an issue.",
      inputSchema: {
        type: "object",
        properties: { issue_key: { type: "string" }, body: { type: "string" } },
        required: ["issue_key", "body"],
      },
      handler: (args) =>
        jira(`/rest/api/3/issue/${encodeURIComponent(str(args.issue_key))}/comment`, {
          method: "POST",
          body: JSON.stringify({ body: str(args.body) }),
        }).then(jsonResult),
    },
    {
      name: "jira_get_comments",
      description: "Get the comment history of an issue.",
      inputSchema: {
        type: "object",
        properties: {
          issue_key: { type: "string" },
          max_results: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["issue_key"],
      },
      handler: (args) =>
        jira(`/rest/api/3/issue/${encodeURIComponent(str(args.issue_key))}/comment?maxResults=${num(args.max_results, 50)}`).then(jsonResult),
    },
    {
      name: "jira_add_worklog",
      description: "Log time against an issue (e.g. \"2h 30m\").",
      inputSchema: {
        type: "object",
        properties: {
          issue_key: { type: "string" },
          time_spent: { type: "string", description: "e.g. '1h 30m', '45m', '2d'" },
          comment: { type: "string" },
          started: { type: "string", description: "Optional start datetime (ISO 8601)" },
        },
        required: ["issue_key", "time_spent"],
      },
      handler: (args) => {
        const body: Record<string, unknown> = { timeSpent: str(args.time_spent) };
        if (str(args.comment)) body.comment = str(args.comment);
        if (str(args.started)) body.started = str(args.started);
        return jira(`/rest/api/3/issue/${encodeURIComponent(str(args.issue_key))}/worklog`, {
          method: "POST",
          body: JSON.stringify(body),
        }).then(jsonResult);
      },
    },
    {
      name: "jira_list_projects",
      description: "List all accessible Jira projects (key, name, project type).",
      inputSchema: { type: "object", properties: {} },
      handler: () => jira("/rest/api/3/project/search?maxResults=100").then(jsonResult),
    },
    {
      name: "jira_get_project",
      description: "Get project details by key.",
      inputSchema: {
        type: "object",
        properties: { project_key: { type: "string" } },
        required: ["project_key"],
      },
      handler: (args) => jira(`/rest/api/3/project/${encodeURIComponent(str(args.project_key))}`).then(jsonResult),
    },
    {
      name: "jira_list_boards",
      description: "List Scrum/Kanban boards.",
      inputSchema: {
        type: "object",
        properties: { max_results: { type: "integer", minimum: 1, maximum: 100 } },
      },
      handler: (args) => jira(`/rest/agile/1.0/board?maxResults=${num(args.max_results, 50)}`).then(jsonResult),
    },
    {
      name: "jira_list_sprints",
      description: "List sprints on a board (state: active/future/closed).",
      inputSchema: {
        type: "object",
        properties: {
          board_id: { type: "integer" },
          state: { type: "string", enum: ["active", "future", "closed"], description: "Default active" },
          max_results: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["board_id"],
      },
      handler: (args) =>
        jira(
          `/rest/agile/1.0/board/${num(args.board_id)}/sprint?state=${str(args.state, "active")}&maxResults=${num(args.max_results, 50)}`,
        ).then(jsonResult),
    },
    {
      name: "jira_list_issue_types",
      description: "List available issue types (Task, Story, Bug, Epic, Sub-task, …).",
      inputSchema: { type: "object", properties: {} },
      handler: () => jira("/rest/api/3/issuetype").then(jsonResult),
    },
    {
      name: "jira_list_assignable_users",
      description: "Search users who can be assigned issues in a project (by query).",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Partial name/email to search" },
          project_key: { type: "string", description: "Restrict to a project" },
          max_results: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["query"],
      },
      handler: (args) => {
        const sp = new URLSearchParams({
          query: str(args.query),
          maxResults: String(num(args.max_results, 50)),
        });
        if (str(args.project_key)) sp.set("project", str(args.project_key));
        return jira(`/rest/api/3/user/assignable/search?${sp}`).then(jsonResult);
      },
    },
  ];

  const jiraEnabled =
    base && apiToken
      ? { enabled: true as const }
      : { enabled: false as const, reason: "set JIRA_BASE_URL and JIRA_API_TOKEN (plus JIRA_EMAIL for API tokens)" };


  return { defs: jiraDefs, ...jiraEnabled };
}
