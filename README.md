# PR Auto Approve

A Chrome extension that approves a GitHub pull request when you open its **Files changed** page (`/pull/<n>/changes` or `/pull/<n>/files`).

## Install

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick this folder.
3. Click the extension's toolbar icon to open settings.
4. Paste a GitHub token, click **Test**, add your repos to the allowlist (for example `Teamwork/*`), then click **Save**.

## Token

- **Fine-grained token:** give it *Pull requests: Read and write* on the target repos. The org may need to approve it.
- **Classic token:** give it the `repo` scope, then go to *Configure SSO* and authorize it for the org.

The token is kept in `chrome.storage.local`, so it stays on this device and isn't synced.

## What it does

When you land on a PR's changes page, it approves the PR through the GitHub REST API if all of these are true:

- the extension is enabled
- the repo matches a line in the allowlist
- the PR is open, and isn't a draft (unless you turned off "Skip draft PRs")
- you aren't the PR's author
- your latest review on the PR isn't already an approval

Before it approves, a countdown toast with a **Cancel** button appears in the bottom-right corner (3 seconds by default; 0 turns it off). Skipped PRs are logged to the page console at debug level.
