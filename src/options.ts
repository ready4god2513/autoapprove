/**
 * Settings page. Loads current settings into the form, saves them back, and
 * tests the token by asking the background who it belongs to.
 */

import { ext } from "./ext";
import { getSettings, send, type LocalSettings, type SyncSettings } from "./shared";

/** Looks up a required element by id, typed by the caller. */
function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`missing #${id} in options.html`);
  return node as T;
}

const fields = {
  enabled: el<HTMLInputElement>("enabled"),
  token: el<HTMLInputElement>("token"),
  delaySeconds: el<HTMLInputElement>("delaySeconds"),
  skipDrafts: el<HTMLInputElement>("skipDrafts"),
  body: el<HTMLInputElement>("body"),
};
const statusEl = el<HTMLSpanElement>("status");

function setStatus(message: string): void {
  statusEl.textContent = message;
}

/** Fills the form from storage. */
async function load(): Promise<void> {
  const s = await getSettings();
  fields.enabled.checked = s.enabled;
  fields.token.value = s.token;
  fields.delaySeconds.value = String(s.delaySeconds);
  fields.skipDrafts.checked = s.skipDrafts;
  fields.body.value = s.body;
}

/** Writes the token to local storage only, so it never syncs off this device. */
async function saveToken(): Promise<void> {
  const local: LocalSettings = { token: fields.token.value.trim() };
  await ext.storage.local.set(local);
}

/** Saves the form. Everything except the token goes to synced storage. */
async function save(): Promise<void> {
  const sync: SyncSettings = {
    enabled: fields.enabled.checked,
    delaySeconds: Math.max(0, Number(fields.delaySeconds.value) || 0),
    skipDrafts: fields.skipDrafts.checked,
    body: fields.body.value,
  };
  await Promise.all([ext.storage.sync.set(sync), saveToken()]);
  setStatus("Saved.");
  setTimeout(() => setStatus(""), 2000);
}

/** Saves the token, then checks it against the GitHub API. */
async function test(): Promise<void> {
  await saveToken();
  setStatus("Testing…");
  const res = await send({ type: "whoami" });
  setStatus(res.ok ? `Token works — signed in as ${res.login}` : `Token failed: ${res.error}`);
}

el("save").addEventListener("click", () => void save());
el("test").addEventListener("click", () => void test());
void load();
