// Content script: watches for PR "changes"/"files" pages (GitHub is an SPA, so we poll the URL).

const PR_PATH = /^\/([^/]+)\/([^/]+)\/pull\/(\d+)\/(changes|files)(\/|$)/;

let currentKey = null;
let pendingTimer = null;
let toastEl = null;

function send(type, pr) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type, pr }, (res) => {
      if (chrome.runtime.lastError) resolve({ ok: false, error: chrome.runtime.lastError.message });
      else resolve(res);
    });
  });
}

function toast(html, { color = "#1f883d", timeout = 0, onCancel } = {}) {
  removeToast();
  toastEl = document.createElement("div");
  Object.assign(toastEl.style, {
    position: "fixed",
    bottom: "20px",
    right: "20px",
    zIndex: 2147483647,
    background: color,
    color: "#fff",
    padding: "10px 14px",
    borderRadius: "6px",
    font: "14px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    boxShadow: "0 4px 12px rgba(0,0,0,.25)",
    display: "flex",
    gap: "10px",
    alignItems: "center",
  });
  const text = document.createElement("span");
  text.innerHTML = html;
  toastEl.appendChild(text);
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
    });
    btn.addEventListener("click", onCancel);
    toastEl.appendChild(btn);
  }
  document.body.appendChild(toastEl);
  if (timeout) {
    const el = toastEl;
    setTimeout(() => el === toastEl && removeToast(), timeout);
  }
  return text;
}

function removeToast() {
  toastEl?.remove();
  toastEl = null;
}

function cancelPending() {
  if (pendingTimer) {
    clearInterval(pendingTimer);
    pendingTimer = null;
    removeToast();
  }
}

async function doApprove(pr) {
  const res = await send("approve", pr);
  if (res?.ok) toast("✓ PR auto-approved", { timeout: 4000 });
  else toast(`Auto-approve failed: ${res?.error || "unknown error"}`, { color: "#cf222e", timeout: 8000 });
}

async function handle(pr, key) {
  const res = await send("check", pr);
  if (key !== currentKey) return; // navigated away while checking
  if (!res?.ok) {
    toast(`Auto-approve check failed: ${res?.error || "unknown error"}`, { color: "#cf222e", timeout: 8000 });
    return;
  }
  if (!res.eligible) {
    console.debug(`[PR Auto Approve] skipped ${key}: ${res.reason}`);
    return;
  }

  let remaining = Math.max(0, Math.floor(res.delaySeconds));
  if (remaining === 0) return doApprove(pr);

  const label = toast(`Auto-approving in ${remaining}s…`, {
    onCancel: () => {
      cancelPending();
      toast("Auto-approve cancelled", { color: "#57606a", timeout: 2500 });
    },
  });
  pendingTimer = setInterval(() => {
    remaining -= 1;
    if (key !== currentKey) return cancelPending();
    if (remaining > 0) {
      label.textContent = `Auto-approving in ${remaining}s…`;
    } else {
      clearInterval(pendingTimer);
      pendingTimer = null;
      doApprove(pr);
    }
  }, 1000);
}

function check() {
  const m = location.pathname.match(PR_PATH);
  const key = m ? `${m[1]}/${m[2]}#${m[3]}` : null;
  if (key === currentKey) return;
  cancelPending();
  currentKey = key;
  if (m) handle({ owner: m[1], repo: m[2], number: Number(m[3]) }, key);
}

check();
setInterval(check, 1000);
