/**
 * The extension API, under whichever global this browser provides.
 *
 * Firefox and Safari implement the promise-based `browser` namespace.
 * Chromium implements `chrome` (and, from Chrome 144, `browser` as well).
 * Messaging does not follow one rule, so callers also need `isChromium`:
 * Chromium answers an async message with `sendResponse` plus `return true`,
 * while Firefox and Safari answer with the promise the listener returns.
 */

/** Chromium (Chrome, Edge, Brave, and so on) ships `navigator.userAgentData`. Firefox and Safari do not. */
export function isChromium(): boolean {
  return "userAgentData" in navigator;
}

function resolveExtensionApi(): typeof chrome {
  const root = globalThis as typeof globalThis & {
    browser?: typeof chrome;
    chrome?: typeof chrome;
  };
  const api = isChromium() ? root.chrome : (root.browser ?? root.chrome);
  if (!api?.runtime) throw new Error("extension API is unavailable");
  return api;
}

export const ext = resolveExtensionApi();
