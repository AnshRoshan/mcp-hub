import type { ToolDef } from "../registry.js";
import { jsonResult } from "../result.js";
import { apiClient, num, str, strArr, obj } from "../utils.js";
import type { EnvSource } from "../utils.js";
export function githubModule(env: EnvSource): { defs: ToolDef[]; enabled: boolean; reason?: string } {

  const token = env.get("GITHUB_TOKEN");
  // Overridable so enterprise / GitHub Enterprise Server instances work, and so the
  // module can be tested against a mock.
  const API = (env.get("GITHUB_API_URL") ?? "https://api.github.com").replace(/\/+$/, "");

  const headers: Record<string, string> = {
    Authorization: `Bearer ${token ?? ""}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "mcp-workstation",
  };

  const gh = apiClient(API, "GitHub", headers);

  function q(params: Record<string, string>): string {
    const sp = new URLSearchParams(params);
    return `?${sp}`;
  }

  const pagination = (args: Record<string, unknown>): Record<string, string> => ({
    per_page: String(num(args.per_page, 30)),
  });

  /** owner+repo (required) with an optional per_page knob — shared by paginated repo list tools. */
  const repoPageSchema = {
    type: "object",
    properties: {
      owner: { type: "string" },
      repo: { type: "string" },
      per_page: { type: "integer", minimum: 1, maximum: 100 },
    },
    required: ["owner", "repo"],
  };

  const githubDefs: ToolDef[] = [
    {
      name: "gh_get_user",
      description: "Get profile info for a GitHub user (defaults to the authenticated user).",
      inputSchema: {
        type: "object",
        properties: { username: { type: "string" } },
      },
      handler: (args) => gh(str(args.username) ? `/users/${str(args.username)}` : "/user").then(jsonResult),
    },
    {
      name: "gh_get_repo",
      description: "Get details for a repository (stars, default branch, topics, license, …).",
      inputSchema: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" } },
        required: ["owner", "repo"],
      },
      handler: (args) => gh(`/repos/${str(args.owner)}/${str(args.repo)}`).then(jsonResult),
    },
    {
      name: "gh_create_repo",
      description: "Create a new repository under the authenticated user.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          private: { type: "boolean", description: "Default false" },
          auto_init: { type: "boolean", description: "Initialize with a README (default false)" },
        },
        required: ["name"],
      },
      handler: (args) =>
        gh("/user/repos", {
          method: "POST",
          body: JSON.stringify({
            name: str(args.name),
            description: str(args.description) || undefined,
            private: args.private === true,
            auto_init: args.auto_init === true,
          }),
        }).then(jsonResult),
    },
    {
      name: "gh_list_repos",
      description: "List repositories for the authenticated user or a given username.",
      inputSchema: {
        type: "object",
        properties: {
          username: { type: "string" },
          per_page: { type: "integer", minimum: 1, maximum: 100 },
          sort: { type: "string", enum: ["created", "updated", "pushed", "full_name"] },
        },
      },
      handler: (args) => {
        const p = pagination(args);
        if (str(args.sort)) p.sort = str(args.sort);
        const pathname = str(args.username) ? `/users/${str(args.username)}/repos${q(p)}` : `/user/repos${q(p)}`;
        return gh(pathname).then(jsonResult);
      },
    },
    {
      name: "gh_search_repos",
      description: "Search GitHub repositories by query (e.g. \"mcp server language:typescript stars:>100\").",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, per_page: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["query"],
      },
      handler: (args) => gh(`/search/repositories${q({ q: str(args.query), ...pagination(args) })}`).then(jsonResult),
    },
    {
      name: "gh_list_issues",
      description: "List issues in a repository (optionally filtered by state/labels).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"] },
          labels: { type: "string", description: "Comma-separated label names" },
          per_page: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["owner", "repo"],
      },
      handler: (args) => {
        const p = pagination(args);
        p.state = str(args.state, "open");
        if (str(args.labels)) p.labels = str(args.labels);
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/issues${q(p)}`).then(jsonResult);
      },
    },
    {
      name: "gh_get_issue",
      description: "Get a single issue including its body, labels, assignees and timeline hints.",
      inputSchema: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, issue_number: { type: "integer" } },
        required: ["owner", "repo", "issue_number"],
      },
      handler: (args) => gh(`/repos/${str(args.owner)}/${str(args.repo)}/issues/${num(args.issue_number)}`).then(jsonResult),
    },
    {
      name: "gh_create_issue",
      description: "Create an issue with optional labels and assignees (usernames).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          body: { type: "string" },
          labels: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "string" } },
        },
        required: ["owner", "repo", "title"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/issues`, {
          method: "POST",
          body: JSON.stringify({
            title: str(args.title),
            body: str(args.body) || undefined,
            labels: strArr(args.labels),
            assignees: strArr(args.assignees),
          }),
        }).then(jsonResult),
    },
    {
      name: "gh_update_issue",
      description: "Update an issue: title, body, state (open/closed), labels, or assignees.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "integer" },
          title: { type: "string" },
          body: { type: "string" },
          state: { type: "string", enum: ["open", "closed"] },
          labels: { type: "array", items: { type: "string" } },
          assignees: { type: "array", items: { type: "string" } },
        },
        required: ["owner", "repo", "issue_number"],
      },
      handler: (args) => {
        const body: Record<string, unknown> = {};
        if (args.title !== undefined) body.title = str(args.title);
        if (args.body !== undefined) body.body = str(args.body);
        if (args.state !== undefined) body.state = str(args.state);
        if (args.labels !== undefined) body.labels = strArr(args.labels);
        if (args.assignees !== undefined) body.assignees = strArr(args.assignees);
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/issues/${num(args.issue_number)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        }).then(jsonResult);
      },
    },
    {
      name: "gh_add_issue_comment",
      description: "Add a comment to an issue or pull request.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "integer" },
          body: { type: "string" },
        },
        required: ["owner", "repo", "issue_number", "body"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/issues/${num(args.issue_number)}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: str(args.body) }),
        }).then(jsonResult),
    },
    {
      name: "gh_list_issue_comments",
      description: "List comments on an issue or pull request.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          issue_number: { type: "integer" },
          per_page: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["owner", "repo", "issue_number"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/issues/${num(args.issue_number)}/comments${q(pagination(args))}`).then(jsonResult),
    },
    {
      name: "gh_search_issues",
      description: "Search issues and pull requests across GitHub (query syntax: repo:, label:, is:pr, …).",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" }, per_page: { type: "integer", minimum: 1, maximum: 100 } },
        required: ["query"],
      },
      handler: (args) => gh(`/search/issues${q({ q: str(args.query), ...pagination(args) })}`).then(jsonResult),
    },
    {
      name: "gh_list_pull_requests",
      description: "List pull requests in a repository.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          state: { type: "string", enum: ["open", "closed", "all"] },
          per_page: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["owner", "repo"],
      },
      handler: (args) => {
        const p = pagination(args);
        p.state = str(args.state, "open");
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/pulls${q(p)}`).then(jsonResult);
      },
    },
    {
      name: "gh_get_pull_request",
      description: "Get a single pull request with its diff URL, mergeable state, and review status.",
      inputSchema: {
        type: "object",
        properties: { owner: { type: "string" }, repo: { type: "string" }, pull_number: { type: "integer" } },
        required: ["owner", "repo", "pull_number"],
      },
      handler: (args) => gh(`/repos/${str(args.owner)}/${str(args.repo)}/pulls/${num(args.pull_number)}`).then(jsonResult),
    },
    {
      name: "gh_create_pull_request",
      description: "Open a pull request from a head branch to a base branch.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          title: { type: "string" },
          head: { type: "string", description: "Source branch (or owner:branch for forks)" },
          base: { type: "string", description: "Target branch (default main)" },
          body: { type: "string" },
        },
        required: ["owner", "repo", "title", "head"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/pulls`, {
          method: "POST",
          body: JSON.stringify({
            title: str(args.title),
            head: str(args.head),
            base: str(args.base, "main"),
            body: str(args.body) || undefined,
          }),
        }).then(jsonResult),
    },
    {
      name: "gh_merge_pull_request",
      description: "Merge a pull request (squash/merge/rebase).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          pull_number: { type: "integer" },
          commit_title: { type: "string" },
          merge_method: { type: "string", enum: ["merge", "squash", "rebase"] },
        },
        required: ["owner", "repo", "pull_number"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/pulls/${num(args.pull_number)}/merge`, {
          method: "PUT",
          body: JSON.stringify({
            commit_title: str(args.commit_title) || undefined,
            merge_method: str(args.merge_method, "merge"),
          }),
        }).then(jsonResult),
    },
    {
      name: "gh_create_pull_request_review",
      description: "Submit a review on a pull request: APPROVE, REQUEST_CHANGES, or COMMENT.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          pull_number: { type: "integer" },
          body: { type: "string", description: "Review summary" },
          event: { type: "string", enum: ["APPROVE", "REQUEST_CHANGES", "COMMENT"], description: "Default COMMENT" },
        },
        required: ["owner", "repo", "pull_number"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/pulls/${num(args.pull_number)}/reviews`, {
          method: "POST",
          body: JSON.stringify({
            body: str(args.body) || undefined,
            event: str(args.event, "COMMENT"),
          }),
        }).then(jsonResult),
    },
    {
      name: "gh_get_file",
      description: "Get the contents of a file in a repository (base64-decoded).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          ref: { type: "string", description: "Branch, tag, or commit SHA" },
        },
        required: ["owner", "repo", "path"],
      },
      handler: async (args) => {
        const qs = str(args.ref) ? `?ref=${encodeURIComponent(str(args.ref))}` : "";
        const data = (await gh(`/repos/${str(args.owner)}/${str(args.repo)}/contents/${encodeURIComponent(str(args.path))}${qs}`)) as {
          content?: string;
          encoding?: string;
          size?: number;
          name?: string;
          sha?: string;
        };
        return jsonResult({
          name: data.name,
          size: data.size,
          sha: data.sha,
          content: data.content && data.encoding === "base64" ? Buffer.from(data.content, "base64").toString("utf-8") : null,
        });
      },
    },
    {
      name: "gh_write_file",
      description: "Create or update a file in a repository via the contents API.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string", description: "File path in the repo" },
          content: { type: "string", description: "New file content" },
          message: { type: "string", description: "Commit message" },
          branch: { type: "string", description: "Branch (default the default branch)" },
          sha: { type: "string", description: "Required when UPDATING an existing file (get it from gh_get_file)" },
        },
        required: ["owner", "repo", "path", "content", "message"],
      },
      handler: (args) => {
        const body: Record<string, unknown> = {
          content: Buffer.from(str(args.content), "utf-8").toString("base64"),
          message: str(args.message),
        };
        if (str(args.branch)) body.branch = str(args.branch);
        if (str(args.sha)) body.sha = str(args.sha);
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/contents/${encodeURIComponent(str(args.path))}`, {
          method: "PUT",
          body: JSON.stringify(body),
        }).then(jsonResult);
      },
    },
    {
      name: "gh_delete_file",
      description: "Delete a file in a repository (requires the current file SHA from gh_get_file).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          path: { type: "string" },
          message: { type: "string" },
          sha: { type: "string", description: "Current file SHA (from gh_get_file)" },
          branch: { type: "string" },
        },
        required: ["owner", "repo", "path", "message", "sha"],
      },
      handler: (args) => {
        const body: Record<string, unknown> = { message: str(args.message), sha: str(args.sha) };
        if (str(args.branch)) body.branch = str(args.branch);
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/contents/${encodeURIComponent(str(args.path))}`, {
          method: "DELETE",
          body: JSON.stringify(body),
        }).then(jsonResult);
      },
    },
    {
      name: "gh_list_commits",
      description: "List commits on a branch (or the default branch).",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string", description: "Branch or SHA (optional)" },
          per_page: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["owner", "repo"],
      },
      handler: (args) => {
        const p = pagination(args);
        if (str(args.branch)) p.sha = str(args.branch);
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/commits${q(p)}`).then(jsonResult);
      },
    },
    {
      name: "gh_list_branches",
      description: "List branches in a repository.",
      inputSchema: repoPageSchema,
      handler: (args) => gh(`/repos/${str(args.owner)}/${str(args.repo)}/branches${q(pagination(args))}`).then(jsonResult),
    },
    {
      name: "gh_list_releases",
      description: "List releases of a repository.",
      inputSchema: repoPageSchema,
      handler: (args) => gh(`/repos/${str(args.owner)}/${str(args.repo)}/releases${q(pagination(args))}`).then(jsonResult),
    },
    {
      name: "gh_create_release",
      description: "Create a release for a tag.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          tag_name: { type: "string" },
          name: { type: "string" },
          body: { type: "string", description: "Release notes (Markdown)" },
          draft: { type: "boolean" },
          prerelease: { type: "boolean" },
        },
        required: ["owner", "repo", "tag_name"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/releases`, {
          method: "POST",
          body: JSON.stringify({
            tag_name: str(args.tag_name),
            name: str(args.name) || undefined,
            body: str(args.body) || undefined,
            draft: args.draft === true,
            prerelease: args.prerelease === true,
          }),
        }).then(jsonResult),
    },
    {
      name: "gh_trigger_workflow",
      description: "Trigger a GitHub Actions workflow_dispatch for a workflow.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          workflow_id: { type: "string", description: "Workflow file name (e.g. ci.yml) or ID" },
          ref: { type: "string", description: "Branch to run on (default main)" },
          inputs: { type: "object", description: "workflow_dispatch inputs as an object" },
        },
        required: ["owner", "repo", "workflow_id"],
      },
      handler: (args) =>
        gh(`/repos/${str(args.owner)}/${str(args.repo)}/actions/workflows/${encodeURIComponent(str(args.workflow_id))}/dispatches`, {
          method: "POST",
          body: JSON.stringify({
            ref: str(args.ref, "main"),
            inputs: obj(args.inputs) as Record<string, string>,
          }),
        }).then(() => jsonResult({ ok: true, message: "Workflow dispatched" })),
    },
    {
      name: "gh_list_workflow_runs",
      description: "List recent GitHub Actions workflow runs.",
      inputSchema: {
        type: "object",
        properties: {
          owner: { type: "string" },
          repo: { type: "string" },
          branch: { type: "string" },
          per_page: { type: "integer", minimum: 1, maximum: 100 },
        },
        required: ["owner", "repo"],
      },
      handler: (args) => {
        const p = pagination(args);
        if (str(args.branch)) p.branch = str(args.branch);
        return gh(`/repos/${str(args.owner)}/${str(args.repo)}/actions/runs${q(p)}`).then(jsonResult);
      },
    },
    {
      name: "gh_rate_limit",
      description: "Show current GitHub API rate-limit usage for the token.",
      inputSchema: { type: "object", properties: {} },
      handler: () => gh("/rate_limit").then(jsonResult),
    },
  ];

  const githubEnabled = token
    ? { enabled: true as const }
    : { enabled: false as const, reason: "GITHUB_TOKEN not set" };


  return { defs: githubDefs, ...githubEnabled };
}
