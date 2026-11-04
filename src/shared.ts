/**
 * Types, defaults and messaging helpers shared by the background service
 * worker, the content script and the options page.
 */

/** Identifies a single pull request. */
export interface PullRef {
  owner: string;
  repo: string;
  number: number;
}

/** User settings synced across browsers via `chrome.storage.sync`. */
export interface SyncSettings {
  /** Master on/off switch. */
  enabled: boolean;
  /** Newline-separated `owner/repo` glob patterns, e.g. `Teamwork/*`. */
  allowlist: string;
  /** Countdown before approving, giving the user a chance to cancel. 0 = immediate. */
  delaySeconds: number;
  /** Don't approve draft PRs. */
  skipDrafts: boolean;
  /** Optional comment attached to the approval review. */
  body: string;
}

/** Settings stored only on this device via `chrome.storage.local`. */
export interface LocalSettings {
  /** GitHub token. Kept local so it never syncs to other machines. */
  token: string;
}

export type Settings = SyncSettings & LocalSettings;

export const SYNC_DEFAULTS: SyncSettings = {
  enabled: true,
  allowlist: "",
  delaySeconds: 3,
  skipDrafts: true,
  body: "",
};

export const LOCAL_DEFAULTS: LocalSettings = {
  token: "",
};

/** Reads all settings, filling in defaults for anything unset. */
export async function getSettings(): Promise<Settings> {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get(SYNC_DEFAULTS) as Promise<SyncSettings>,
    chrome.storage.local.get(LOCAL_DEFAULTS) as Promise<LocalSettings>,
  ]);
  return { ...sync, ...local };
}

/** Result of asking the background whether a PR should be auto-approved. */
export type Eligibility =
  | { eligible: true; delaySeconds: number }
  | { eligible: false; reason: string };

/** Messages the content script and options page send to the background. */
export type Request =
  | { type: "check"; pr: PullRef }
  | { type: "approve"; pr: PullRef }
  | { type: "whoami" };

/** Payload returned on success for each request type. */
export interface ResponsePayloads {
  check: Eligibility;
  approve: { approved: true };
  whoami: { login: string };
}

/** Every response is either `ok: true` plus its payload, or an error string. */
export type Response<T extends Request["type"]> =
  | ({ ok: true } & ResponsePayloads[T])
  | { ok: false; error: string };

/**
 * Sends a typed message to the background service worker. Never throws:
 * failures (including a reloaded extension invalidating the page's
 * connection) come back as `{ ok: false, error }`.
 */
export async function send<T extends Request>(req: T): Promise<Response<T["type"]>> {
  try {
    const res = (await chrome.runtime.sendMessage(req)) as Response<T["type"]> | undefined;
    return res ?? { ok: false, error: "no response from background" };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

/** Turns an unknown thrown value into a readable message. */
export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
