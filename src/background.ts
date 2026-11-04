/**
 * Background service worker.
 *
 * Owns all GitHub API traffic so the token never touches github.com page
 * context. The content script asks it two things: "should this PR be
 * approved?" (`check`) and "approve it" (`approve`).
 */

import {
  errorMessage,
  getSettings,
  type Eligibility,
  type PullRef,
  type Request,
  type Response,
  type ResponsePayloads,
} from "./shared";

const API = "https://api.github.com";

/** Minimal slice of GitHub's pull request object that we read. */
interface GitHubPull {
  state: "open" | "closed";
  merged: boolean;
  draft?: boolean;
  user: { login: string } | null;
}

/** Minimal slice of GitHub's review object that we read. */
interface GitHubReview {
  state: "APPROVED" | "CHANGES_REQUESTED" | "COMMENTED" | "DISMISSED" | "PENDING";
  user: { login: string } | null;
}

/**
 * Login of the token's owner. Cached in memory to save a request per PR;
 * Chrome may kill the service worker at any time, which just means we
 * fetch it again.
 */
let cachedLogin: string | null = null;

/** PRs approved during this browser session, so revisits skip the API. */
const approvedThisSession = new Set<string>();

/** Case-insensitive key for a PR, e.g. `teamwork/deskapi#6432`. */
const prKey = ({ owner, repo, number }: PullRef): string => `${owner}/${repo}#${number}`.toLowerCase();

/** Case-insensitive login comparison (GitHub logins aren't case-sensitive). */
const sameUser = (a: string | undefined, b: string): boolean => a?.toLowerCase() === b.toLowerCase();

/**
 * Converts an allowlist glob into an anchored regex. `*` and `?` match
 * within a single path segment, so `Teamwork/*` matches every Teamwork repo
 * but `*` alone matches nothing (it has no slash).
 */
function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, "[^/]*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`, "i");
}

/** True if `owner/repo` matches any non-blank, non-`#` line of the allowlist. */
function isAllowed(allowlist: string, { owner, repo }: PullRef): boolean {
  const full = `${owner}/${repo}`;
  return allowlist
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .some((pattern) => globToRegExp(pattern).test(full));
}

/**
 * Calls the GitHub REST API and returns the parsed JSON body. Throws with
 * GitHub's error message (e.g. "Bad credentials") on a non-2xx response.
 */
async function gh<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!res.ok) {
    let detail = "";
    try {
      detail = ((await res.json()) as { message?: string }).message ?? "";
    } catch {
      // Body wasn't JSON; the status code alone will have to do.
    }
    throw new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ""}`);
  }

  return (res.status === 204 ? null : await res.json()) as T;
}

/** Returns the login of the token's owner. */
async function whoami(token: string): Promise<string> {
  cachedLogin ??= (await gh<{ login: string }>(token, "/user")).login;
  return cachedLogin;
}

/**
 * Fetches every review on a PR, oldest first. Capped at 10 pages (1,000
 * reviews) as a guard against runaway pagination.
 */
async function listReviews(token: string, { owner, repo, number }: PullRef): Promise<GitHubReview[]> {
  const all: GitHubReview[] = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh<GitHubReview[]>(
      token,
      `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`,
    );
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

/**
 * Decides whether a PR should be auto-approved. The cheap local checks run
 * first so repos outside the allowlist never trigger an API call.
 */
async function checkEligibility(pr: PullRef): Promise<Eligibility> {
  const s = await getSettings();

  if (!s.enabled) return { eligible: false, reason: "disabled" };
  if (!s.token) return { eligible: false, reason: "no token set (open the extension options)" };
  if (!isAllowed(s.allowlist, pr)) return { eligible: false, reason: "repo not in allowlist" };
  if (approvedThisSession.has(prKey(pr))) return { eligible: false, reason: "already approved" };

  const login = await whoami(s.token);
  const pull = await gh<GitHubPull>(s.token, `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}`);

  if (pull.state !== "open") return { eligible: false, reason: `PR is ${pull.merged ? "merged" : pull.state}` };
  if (pull.draft && s.skipDrafts) return { eligible: false, reason: "PR is a draft" };
  if (sameUser(pull.user?.login, login)) return { eligible: false, reason: "you can't approve your own PR" };

  // Only reviews that set a verdict matter. Comments and pending drafts
  // don't change whether we've approved, so ignore them when finding the
  // latest. A dismissed approval counts as "not approved", which means a
  // re-request after new commits gets approved again.
  const verdicts = (await listReviews(s.token, pr)).filter(
    (r) => sameUser(r.user?.login, login) && r.state !== "COMMENTED" && r.state !== "PENDING",
  );
  if (verdicts.at(-1)?.state === "APPROVED") {
    approvedThisSession.add(prKey(pr));
    return { eligible: false, reason: "already approved" };
  }

  return { eligible: true, delaySeconds: Number(s.delaySeconds) || 0 };
}

/** Submits an APPROVE review on the PR, with the configured comment if any. */
async function approve(pr: PullRef): Promise<ResponsePayloads["approve"]> {
  const s = await getSettings();
  const body = s.body.trim();
  await gh(s.token, `/repos/${pr.owner}/${pr.repo}/pulls/${pr.number}/reviews`, {
    method: "POST",
    body: JSON.stringify({ event: "APPROVE", ...(body ? { body } : {}) }),
  });
  approvedThisSession.add(prKey(pr));
  return { approved: true };
}

/** Dispatches a request to its handler. */
async function handle(req: Request): Promise<ResponsePayloads[Request["type"]]> {
  switch (req.type) {
    case "check":
      return checkEligibility(req.pr);
    case "approve":
      return approve(req.pr);
    case "whoami": {
      // Called from the options page's Test button, so always re-fetch:
      // the token may have just changed.
      cachedLogin = null;
      const { token } = await getSettings();
      if (!token) throw new Error("no token set");
      return { login: await whoami(token) };
    }
  }
}

chrome.runtime.onMessage.addListener((msg: Request, _sender, sendResponse: (res: Response<Request["type"]>) => void) => {
  handle(msg)
    .then((payload) => sendResponse({ ok: true, ...payload }))
    .catch((err: unknown) => sendResponse({ ok: false, error: errorMessage(err) }));
  // Returning true keeps the message channel open for the async response.
  return true;
});

// A new token may belong to a different user, so drop the cached login.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) cachedLogin = null;
});

// There's no popup: clicking the toolbar icon opens the settings page.
chrome.action.onClicked.addListener(() => {
  void chrome.runtime.openOptionsPage();
});
