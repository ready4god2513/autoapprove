// Service worker: talks to the GitHub REST API on behalf of the content script.

const API = "https://api.github.com";

const DEFAULTS = {
  enabled: true,
  allowlist: "", // newline-separated patterns, e.g. "Teamwork/*" or "Teamwork/deskapi"
  delaySeconds: 3,
  skipDrafts: true,
  body: "",
};

let cachedLogin = null;
// PRs approved during this browser session, so revisits don't re-hit the API.
const approvedThisSession = new Set();

async function getSettings() {
  const sync = await chrome.storage.sync.get(DEFAULTS);
  const { token = "" } = await chrome.storage.local.get("token");
  return { ...sync, token };
}

function globToRegExp(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`, "i");
}

function isAllowed(allowlist, owner, repo) {
  const full = `${owner}/${repo}`;
  return allowlist
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .some((pattern) => globToRegExp(pattern).test(full));
}

async function gh(token, path, init = {}) {
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
      const j = await res.json();
      detail = j.message || "";
    } catch {}
    throw new Error(`GitHub ${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.status === 204 ? null : res.json();
}

async function whoami(token) {
  if (!cachedLogin) {
    const me = await gh(token, "/user");
    cachedLogin = me.login;
  }
  return cachedLogin;
}

async function listReviews(token, owner, repo, number) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const batch = await gh(token, `/repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100&page=${page}`);
    all.push(...batch);
    if (batch.length < 100) break;
  }
  return all;
}

// Returns { eligible: boolean, reason: string }
async function checkEligibility({ owner, repo, number }) {
  const s = await getSettings();
  const key = `${owner}/${repo}#${number}`.toLowerCase();

  if (!s.enabled) return { eligible: false, reason: "disabled" };
  if (!s.token) return { eligible: false, reason: "no token set (open the extension options)" };
  if (!isAllowed(s.allowlist, owner, repo)) return { eligible: false, reason: "repo not in allowlist" };
  if (approvedThisSession.has(key)) return { eligible: false, reason: "already approved" };

  const login = await whoami(s.token);
  const pr = await gh(s.token, `/repos/${owner}/${repo}/pulls/${number}`);

  if (pr.state !== "open") return { eligible: false, reason: `PR is ${pr.merged ? "merged" : pr.state}` };
  if (pr.draft && s.skipDrafts) return { eligible: false, reason: "PR is a draft" };
  if (pr.user?.login?.toLowerCase() === login.toLowerCase())
    return { eligible: false, reason: "you can't approve your own PR" };

  const mine = (await listReviews(s.token, owner, repo, number)).filter(
    (r) => r.user?.login?.toLowerCase() === login.toLowerCase() && r.state !== "COMMENTED" && r.state !== "PENDING"
  );
  const latest = mine[mine.length - 1];
  if (latest?.state === "APPROVED") {
    approvedThisSession.add(key);
    return { eligible: false, reason: "already approved" };
  }

  return { eligible: true, reason: "", delaySeconds: Number(s.delaySeconds) || 0 };
}

async function approve({ owner, repo, number }) {
  const s = await getSettings();
  const payload = { event: "APPROVE" };
  if (s.body.trim()) payload.body = s.body.trim();
  await gh(s.token, `/repos/${owner}/${repo}/pulls/${number}/reviews`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
  approvedThisSession.add(`${owner}/${repo}#${number}`.toLowerCase());
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handlers = {
    check: () => checkEligibility(msg.pr),
    approve: () => approve(msg.pr),
    whoami: async () => {
      cachedLogin = null;
      const { token } = await chrome.storage.local.get("token");
      if (!token) throw new Error("no token set");
      return { login: await whoami(token) };
    },
  };
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler()
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: String(err.message || err) }));
  return true; // keep the channel open for the async response
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.token) cachedLogin = null;
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());
