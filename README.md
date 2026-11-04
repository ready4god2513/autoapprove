# PR Auto Approve

Approves a GitHub pull request when you open its **Files changed** page (`/pull/<n>/changes` or `/pull/<n>/files`). One build loads in Chrome, Firefox, and Safari.

You need Chrome 121 or newer, Firefox 142 or newer, or Safari 16.4 or newer.

## Install

Build it. With [mise](https://mise.jdx.dev), which installs the pinned Node version and the dependencies:

```sh
mise install
mise run build
```

Or with your own Node: `npm install && npm run build`.

The build writes `dist/`. Load that folder, then click the extension's toolbar icon, paste a GitHub token, click **Test**, and click **Save**.

### Chrome

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the `dist/` folder.

### Firefox

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…** and pick `dist/manifest.json`.
3. Accept the prompt. Firefox lists data collection because the token and the pull request you have open are sent to `api.github.com`, and nowhere else. Allow access to `api.github.com` when Firefox asks.

A temporary add-on is removed when Firefox quits. The id in the manifest keeps the saved token when you reload the add-on during the same session.

### Safari

1. If you don't see a Developer tab, open Safari > Settings > Advanced and turn on **Show features for web developers**.
2. Open Safari > Settings > Developer and check **Allow unsigned extensions**. Safari turns this off again when you quit it.
3. Click **Add Temporary Extension…** and select the `dist/` folder.
4. On the Extensions tab, turn on **PR Auto Approve** and allow it on `github.com`.

To wrap the extension in a Mac app (the form Safari uses for something you keep installed, or ship on the App Store):

```sh
xcrun safari-web-extension-converter dist \
  --project-location build/safari \
  --app-name "PR Auto Approve" \
  --bundle-identifier com.ready4god2513.autoapprove \
  --swift \
  --macos-only \
  --no-open \
  --no-prompt \
  --force
```

Open `build/safari` in Xcode and run it. The project references `dist/`, so rebuild the extension before running again. Run the converter again after the manifest gains or loses files.

## Development

The code is TypeScript in `src/`, bundled with esbuild into `dist/`. The manifest and options page live in `static/` and are copied to `dist/` as they are.

Node is pinned to 24 in `mise.toml`. Each npm script below also exists as a mise task (`mise run build`, `mise run watch` and so on), and the tasks run `npm ci` first when dependencies are out of date.

| Command             | What it does                                       |
| ------------------- | -------------------------------------------------- |
| `npm run build`     | Builds into `dist/`                                |
| `npm run watch`     | Rebuilds `src/` on every change (with source maps) |
| `npm run typecheck` | Runs `tsc` with no output files                    |
| `npm run check`     | Type checks, then builds                           |

After a rebuild, reload the extension: the reload icon on `chrome://extensions`, **Reload** on `about:debugging`, or the reload control for the temporary extension in Safari's Developer settings. Files in `static/` aren't watched, so re-run the build after editing them.

- `src/ext.ts`: the `browser` or `chrome` extension API
- `src/background.ts`: GitHub API calls. A service worker in Chrome, an event page in Firefox and Safari
- `src/content.ts`: detects PR pages and shows the countdown
- `src/options.ts`: settings page
- `src/shared.ts`: settings, message types and the typed `send()` helper

The manifest lists both `background.service_worker` (Chrome) and `background.scripts` (Firefox and Safari). Chrome 121 and newer ignores `scripts`. Firefox ignores `service_worker` and loads the event page. Safari loads the event page when both keys are present.

## Token

- **Fine-grained token:** give it *Pull requests: Read and write* on the target repos. The org may need to approve it.
- **Classic token:** give it the `repo` scope, then go to *Configure SSO* and authorize it for the org.

The token is kept in `storage.local`, so it stays on this device and isn't synced. The other settings use `storage.sync`.

## What it does

When you land on a PR's changes page, it approves the PR through the GitHub REST API if all of these are true:

- the extension is enabled
- the PR is open, and isn't a draft (unless you turned off "Skip draft PRs")
- you aren't the PR's author
- your latest review on the PR isn't already an approval

Before it approves, a countdown toast with a **Cancel** button appears in the bottom-right corner (3 seconds by default; 0 turns it off). Skipped PRs are logged to the page console at debug level.
