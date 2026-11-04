# PR Auto Approve

A Chrome extension that approves a GitHub pull request when you open its **Files changed** page (`/pull/<n>/changes` or `/pull/<n>/files`).

## Install

1. Build it:
   ```sh
   npm install
   npm run build
   ```
2. Go to `chrome://extensions` and turn on **Developer mode**.
3. Click **Load unpacked** and pick the `dist/` folder.
4. Click the extension's toolbar icon to open settings.
5. Paste a GitHub token, click **Test**, then click **Save**.

## Development

The code is TypeScript in `src/`, bundled with esbuild into `dist/`. The manifest and options page live in `static/` and are copied to `dist/` as they are.

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run build`     | Builds into `dist/`                                  |
| `npm run watch`     | Rebuilds `src/` on every change (with source maps)   |
| `npm run typecheck` | Runs `tsc` with no output files                      |
| `npm run check`     | Type checks, then builds                             |

After a rebuild, click the reload icon on the extension in `chrome://extensions`. Files in `static/` aren't watched, so re-run the build after editing them.

- `src/background.ts`: service worker that makes every GitHub API call
- `src/content.ts`: detects PR pages and shows the countdown
- `src/options.ts`: settings page
- `src/shared.ts`: settings, message types and the typed `send()` helper

## Token

- **Fine-grained token:** give it *Pull requests: Read and write* on the target repos. The org may need to approve it.
- **Classic token:** give it the `repo` scope, then go to *Configure SSO* and authorize it for the org.

The token is kept in `chrome.storage.local`, so it stays on this device and isn't synced.

## What it does

When you land on a PR's changes page, it approves the PR through the GitHub REST API if all of these are true:

- the extension is enabled
- the PR is open, and isn't a draft (unless you turned off "Skip draft PRs")
- you aren't the PR's author
- your latest review on the PR isn't already an approval

Before it approves, a countdown toast with a **Cancel** button appears in the bottom-right corner (3 seconds by default; 0 turns it off). Skipped PRs are logged to the page console at debug level.
