const DEFAULTS = { enabled: true, allowlist: "", delaySeconds: 3, skipDrafts: true, body: "" };
const $ = (id) => document.getElementById(id);
const status = (msg) => ($("status").textContent = msg);

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  const { token = "" } = await chrome.storage.local.get("token");
  $("enabled").checked = s.enabled;
  $("allowlist").value = s.allowlist;
  $("delaySeconds").value = s.delaySeconds;
  $("skipDrafts").checked = s.skipDrafts;
  $("body").value = s.body;
  $("token").value = token;
}

async function save() {
  await chrome.storage.sync.set({
    enabled: $("enabled").checked,
    allowlist: $("allowlist").value,
    delaySeconds: Math.max(0, Number($("delaySeconds").value) || 0),
    skipDrafts: $("skipDrafts").checked,
    body: $("body").value,
  });
  await chrome.storage.local.set({ token: $("token").value.trim() });
  status("Saved.");
  setTimeout(() => status(""), 2000);
}

async function test() {
  await chrome.storage.local.set({ token: $("token").value.trim() });
  status("Testing…");
  const res = await chrome.runtime.sendMessage({ type: "whoami" });
  status(res?.ok ? `Token works — signed in as ${res.login}` : `Token failed: ${res?.error}`);
}

$("save").addEventListener("click", save);
$("test").addEventListener("click", test);
load();
