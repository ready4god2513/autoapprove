/**
 * Content script, injected into every github.com page.
 *
 * Detects when the user is on a PR's changes page, asks the background
 * whether to approve it, and if so shows a cancelable countdown before
 * approving. All GitHub API calls happen in the background script.
 */

import { send, type PullRef } from "./shared";

/** Matches `/owner/repo/pull/123/changes` (new UI) and `/owner/repo/pull/123/files` (classic UI). */
const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(?:changes|files)(?:\/|$)/;

/** How often to re-check the URL, in milliseconds. */
const POLL_MS = 1000;

const COLORS = {
  success: "#1f883d",
  error: "#cf222e",
  neutral: "#57606a",
} as const;

/** Key of the PR the current URL points to, or null if we're not on one. */
let currentKey: string | null = null;
/** Countdown interval while an approval is pending. */
let pendingTimer: ReturnType<typeof setInterval> | null = null;
/** The toast currently on screen, if any. */
let toastEl: HTMLDivElement | null = null;

interface ToastOptions {
  color?: string;
  /** Auto-dismiss after this many ms. 0 = stay until replaced. */
  timeout?: number;
  /** If set, shows a Cancel button that calls this. */
  onCancel?: () => void;
}

/**
 * Shows a toast in the bottom-right corner, replacing any existing one.
 * Returns the text element so callers can update it in place (used by the
 * countdown).
 */
function toast(message: string, { color = COLORS.success, timeout = 0, onCancel }: ToastOptions = {}): HTMLSpanElement {
  removeToast();

  const el = document.createElement("div");
  Object.assign(el.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: "2147483647",
    background: color,
    color: "#fff",
    padding: "10px 14px",
    borderRadius: "6px",
    font: "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    boxShadow: "0 4px 12px rgba(0,0,0,.25)",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  } satisfies Partial<CSSStyleDeclaration>);

  // textContent (not innerHTML) because messages can include GitHub API
  // error text.
  const text = document.createElement("span");
  text.textContent = message;
  el.appendChild(text);

  if (onCancel) {
    const btn = document.createElement("button");
    btn.textContent = "Cancel";
    Object.assign(btn.style, {
      background: "rgba(255,255,255,.2)",
      color: "#fff",
      border: "1px solid rgba(255,255,255,.5)",
      borderRadius: "4px",
      padding: "2px 8px",
      cursor: "pointer",
    } satisfies Partial<CSSStyleDeclaration>);
    btn.addEventListener("click", onCancel);
    el.appendChild(btn);
  }

  document.body.appendChild(el);
  toastEl = el;

  if (timeout) {
    // Only remove the toast if it hasn't been replaced in the meantime.
    setTimeout(() => {
      if (toastEl === el) removeToast();
    }, timeout);
  }

  return text;
}

function removeToast(): void {
  toastEl?.remove();
  toastEl = null;
}

/** Stops a pending countdown (if any) and hides its toast. */
function cancelPending(): void {
  if (pendingTimer === null) return;
  clearInterval(pendingTimer);
  pendingTimer = null;
  removeToast();
}

/** Asks the background to approve the PR and reports the outcome. */
async function doApprove(pr: PullRef): Promise<void> {
  const res = await send({ type: "approve", pr });
  if (res.ok) {
    toast("✓ PR auto-approved", { timeout: 4000 });
  } else {
    toast(`Auto-approve failed: ${res.error}`, { color: COLORS.error, timeout: 8000 });
  }
}

/**
 * Runs the whole flow for one PR: check eligibility, then either approve
 * immediately or after a countdown. `key` guards against the user
 * navigating away mid-flow.
 */
async function handlePull(pr: PullRef, key: string): Promise<void> {
  const res = await send({ type: "check", pr });
  if (key !== currentKey) return; // Navigated away while the check was in flight.

  if (!res.ok) {
    toast(`Auto-approve check failed: ${res.error}`, { color: COLORS.error, timeout: 8000 });
    return;
  }
  if (!res.eligible) {
    // Skips are routine (wrong repo, already approved...), so log quietly
    // instead of showing a toast.
    console.debug(`[PR Auto Approve] skipped ${key}: ${res.reason}`);
    return;
  }

  let remaining = Math.max(0, Math.floor(res.delaySeconds));
  if (remaining === 0) {
    await doApprove(pr);
    return;
  }

  const label = toast(`Auto-approving in ${remaining}s…`, {
    onCancel: () => {
      cancelPending();
      toast("Auto-approve cancelled", { color: COLORS.neutral, timeout: 2500 });
    },
  });

  pendingTimer = setInterval(() => {
    if (key !== currentKey) {
      cancelPending();
      return;
    }
    remaining -= 1;
    if (remaining > 0) {
      label.textContent = `Auto-approving in ${remaining}s…`;
      return;
    }
    if (pendingTimer !== null) clearInterval(pendingTimer);
    pendingTimer = null;
    void doApprove(pr);
  }, 1000);
}

/**
 * Checks whether the URL now points to a different PR (or to no PR). Runs
 * on a timer because GitHub navigates client-side, so the content script
 * isn't re-injected when the user clicks between pages.
 */
function onLocationTick(): void {
  const m = PR_PATH.exec(location.pathname);
  const key = m ? `${m[1]}/${m[2]}#${m[3]}` : null;
  if (key === currentKey) return;

  cancelPending();
  currentKey = key;

  if (m && key) {
    const [, owner = "", repo = "", number = ""] = m;
    void handlePull({ owner, repo, number: Number(number) }, key);
  }
}

onLocationTick();
setInterval(onLocationTick, POLL_MS);
