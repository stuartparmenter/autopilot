import { Octokit } from "octokit";

let _client: Octokit | null = null;

/**
 * Get or create the Octokit client. Reads GITHUB_TOKEN from environment.
 */
export function getGitHubClient(): Octokit {
  if (_client) return _client;

  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      "GITHUB_TOKEN environment variable is not set.\n" +
        "Create one at: https://github.com/settings/tokens\n" +
        "Then: export GITHUB_TOKEN=ghp_...",
    );
  }

  _client = new Octokit({ auth: token });
  return _client;
}

/**
 * Detect owner/repo from git remote origin, with config override.
 * Supports both HTTPS and SSH remote URLs.
 */
export function detectRepo(
  projectPath: string,
  configOverride?: string,
): { owner: string; repo: string } {
  if (configOverride) {
    const [owner, repo] = configOverride.split("/");
    if (!owner || !repo) {
      throw new Error(
        `Invalid github.repo config: "${configOverride}" — expected "owner/repo"`,
      );
    }
    return { owner, repo };
  }

  const result = Bun.spawnSync(
    ["git", "-C", projectPath, "remote", "get-url", "origin"],
    { stdout: "pipe", stderr: "pipe" },
  );
  if (result.exitCode !== 0) {
    throw new Error(
      `Failed to detect git remote origin in ${projectPath}. ` +
        "Set github.repo in .claude-autopilot.yml instead.",
    );
  }

  const url = result.stdout.toString().trim();

  // HTTPS: https://github.com/owner/repo.git
  const httpsMatch = url.match(/github\.com\/([^/]+)\/([^/.]+)/);
  if (httpsMatch) {
    return { owner: httpsMatch[1], repo: httpsMatch[2] };
  }

  // SSH: git@github.com:owner/repo.git
  const sshMatch = url.match(/github\.com:([^/]+)\/([^/.]+)/);
  if (sshMatch) {
    return { owner: sshMatch[1], repo: sshMatch[2] };
  }

  throw new Error(
    `Could not parse owner/repo from remote URL: "${url}". ` +
      "Set github.repo in .claude-autopilot.yml instead.",
  );
}

export interface PRStatus {
  merged: boolean;
  mergeable: boolean | null;
  branch: string;
  ciStatus: "success" | "failure" | "pending";
  ciDetails: string;
}

/**
 * Get the merge and CI status of a PR.
 * Combines both legacy Status API and Checks API for full coverage.
 * Treats mergeable === null as pending (GitHub computes async).
 */
export async function getPRStatus(
  owner: string,
  repo: string,
  prNumber: number,
): Promise<PRStatus> {
  const octokit = getGitHubClient();

  const { data: pr } = await octokit.rest.pulls.get({
    owner,
    repo,
    pull_number: prNumber,
  });

  if (pr.merged) {
    return {
      merged: true,
      mergeable: null,
      branch: pr.head.ref,
      ciStatus: "success",
      ciDetails: "",
    };
  }

  const sha = pr.head.sha;

  // Fetch both Status API and Checks API in parallel
  const [statusResult, checksResult] = await Promise.all([
    octokit.rest.repos.getCombinedStatusForRef({ owner, repo, ref: sha }),
    octokit.rest.checks.listForRef({ owner, repo, ref: sha }),
  ]);

  // Aggregate CI status from both APIs.
  // Only report "failure" once everything has settled — otherwise a fast-failing
  // check would trigger a fixer while slower checks are still running.
  const statusState = statusResult.data.state; // "success" | "failure" | "pending"
  const checks = checksResult.data.check_runs;
  const failureDetails: string[] = [];

  const allStatusesFinal = statusResult.data.statuses.every(
    (s) => s.state !== "pending",
  );
  const allChecksComplete = checks.every((c) => c.status === "completed");
  const allSettled = allStatusesFinal && allChecksComplete;

  let ciStatus: PRStatus["ciStatus"] = "pending";

  if (!allSettled) {
    // Something is still running — wait for next poll
    ciStatus = "pending";
  } else {
    const hasStatusFailure =
      statusState === "failure" || statusState === "error";
    const hasCheckFailure = checks.some(
      (c) => c.conclusion === "failure" || c.conclusion === "timed_out",
    );

    if (hasStatusFailure || hasCheckFailure) {
      ciStatus = "failure";
      for (const status of statusResult.data.statuses) {
        if (status.state === "failure" || status.state === "error") {
          failureDetails.push(
            `${status.context}: ${status.description ?? "failed"}`,
          );
        }
      }
      for (const check of checks) {
        if (
          check.conclusion === "failure" ||
          check.conclusion === "timed_out"
        ) {
          failureDetails.push(`${check.name}: ${check.conclusion}`);
        }
      }
    } else {
      ciStatus = "success";
    }
  }

  if (ciStatus === "failure" && failureDetails.length === 0) {
    failureDetails.push("CI checks failed (see PR for details)");
  }

  return {
    merged: false,
    mergeable: pr.mergeable,
    branch: pr.head.ref,
    ciStatus,
    ciDetails: failureDetails.join("\n"),
  };
}
