# vscode-diff Next — compare branches and repos side by side

[![CI](https://github.com/ricardofrantz/vscode-diff-next/actions/workflows/ci.yml/badge.svg)](https://github.com/ricardofrantz/vscode-diff-next/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub](https://img.shields.io/badge/github-vscode--diff--next-blue)](https://github.com/ricardofrantz/vscode-diff-next)

Compare any two Git endpoints — two branches of one repo, or branches of **two
different repos** in a multi-root workspace — with a changed-file tree, commit
history, and one-click built-in diffs, all in a dedicated sidebar.

**vscode-diff Next** is the actively maintained product on top of the classic
[Diff Visualizer](https://github.com/lxliang912/diff-visualizer) lineage. The
upstream git history stays in this repo so the fork trail is honest. Packaging,
security posture, docs, and day-to-day tooling follow the same bar as
[vscode-pdf Next](https://github.com/ricardofrantz/vscode-pdf-next).

![screenshot](./images/img_example.png)

## Why this extension?

- 🔀 **Branch compare without leaving the editor.** Pick two endpoints
  (`{folder} · {ref}`); see every changed path and the commits between them.
- 🗂️ **Cross-repo compare.** Each side can be a different repository in your
  workspace — ideal for comparing versioned checkouts (`app-2.5` vs `app-2.6`)
  that don't share a git history.
- ✅ **Honest file status.** Status comes from `git diff --name-status`
  (A/M/D/R/C, NUL-safe parsing, rename detection) — not guessed from
  insert/delete counts. Renamed files diff old name ↔ new name.
- 🕘 **Commit history.** Searchable list for the `base..target` range; subject
  and body exactly as git wrote them.
- 🔒 **Hardened.** Nonce-based webview CSP, untrusted-input validation on every
  ref and path crossing the webview boundary, no shell execution
  (refs and paths are passed to git as discrete arguments).

## Features

| Feature | Status |
| ------- | ------ |
| Dual targets: any two workspace repos + branches | ✅ |
| SCM-style list (M / U / D / R / C) with foldable groups | ✅ |
| M → side-by-side diff; U/D → single side; R → old ↔ new | ✅ |
| Open Target 2 worktree file (↗) | ✅ |
| Discard: apply Target 1 → Target 2 worktree (binary-safe) | ✅ |
| Commit history + search (same-repo only, capped at 1000) | ✅ |
| Persist last pair + list font size | ✅ |
| Unicode / unusual filenames | ✅ (`-z` parsing) |
| Windows / Linux / macOS | ✅ (`git` on `PATH`) |

## Getting started

Requires **VS Code 1.95+** and **Git** on `PATH`. For the install scripts, the
VS Code CLI (`code`) must be on `PATH` too. Prebuilt VSIX files are attached to
[GitHub Releases](https://github.com/ricardofrantz/vscode-diff-next/releases).

### From this repo

**Windows (PowerShell):**

```powershell
cd path\to\vscode-diff-next
npm install
.\update-extension.ps1
# or: .\update-extension.ps1 -NoRestart
```

**Linux / macOS:**

```bash
cd path/to/vscode-diff-next
npm install
chmod +x ./update-extension.sh
./update-extension.sh
# or: ./update-extension.sh --no-restart
```

Cross-platform npm wrappers: `npm run update`, `npm run update:norestart`,
`npm run update:dev`.

Dev loop (Extension Development Host, no VSIX):

```bash
npm run update:dev
# other terminal: npm run watch
# Extension Host: Reload Window after each change
```

### From a VSIX

```bash
npm run compile
npm run package   # bundles production deps (simple-git); do not use --no-dependencies
code --install-extension diff-next-<version>.vsix --force
```

Marketplace id once published: `RicardoFrantz.diff-next`.

## Usage

1. Click **vscode-diff Next** in the activity bar.
2. Pick **two unique endpoints** (each is `{folder} · {ref}`). HEAD of each
   workspace folder is listed first; other **local** branches of that folder
   follow. Remotes are hidden. The two sides can never be the same endpoint.
3. Click a **Modified (M)** file for a side-by-side diff; **Renamed (R)** diffs
   the old path against the new one.
4. Click a **New (U)** or **Deleted (D)** file for a single view.
5. Click a group header (Modified / New / Deleted / …) to fold that section.
6. Same-repo only: searchable commit history between the tips.
7. `↺` applies Target 1's version onto Target 2's worktree (with confirmation);
   `↗` opens the Target 2 worktree file.

Command Palette: **vscode-diff Next: Compare Branches** (editor-area panel).

## Security model

- **No shell.** All git invocations go through `simple-git` with discrete
  arguments — refs and paths are never interpolated into a command line.
- **Untrusted webview input.** Every ref and path received from the webview or
  from virtual-document URIs is validated: refs must not look like git flags
  (no leading `-`, no git-forbidden characters); paths must be repo-relative
  with no `..` escapes. Worktree writes are additionally checked to resolve
  inside the target repository root.
- **Strict CSP.** The webview allows only nonce-tagged scripts; error output is
  rendered as text, never HTML.
- **No telemetry, no network calls.** Everything runs against your local repos.

See [SECURITY.md](./SECURITY.md) for reporting.

## Identity (same family as vscode-pdf Next)

| | **vscode-pdf Next** | **vscode-diff Next** |
| -- | ------------------- | -------------------- |
| Repository | `ricardofrantz/vscode-pdf-next` | `ricardofrantz/vscode-diff-next` |
| Display name | `vscode-pdf Next` | `vscode-diff Next` |
| Package name | `pdf-preview-next` | `diff-next` |
| Install id | `RicardoFrantz.pdf-preview-next` | `RicardoFrantz.diff-next` |
| Command prefix | `vscode-pdf Next: …` | `vscode-diff Next: …` |

Publisher for both: **RicardoFrantz**.

## Development

See [docs/DEVELOP.md](docs/DEVELOP.md). Short map:

```text
src/host/DiffHost.ts       shared webview host + git message handling
src/services/gitService.ts git façade via simple-git (-z parsers, validation)
src/webview/               UI (vanilla JS, injected into one HTML file)
update-extension.ps1/.sh   compile → package → install → restart
```

Checks: `npm run lint`, `npm run compile`, `npm run smoke:paths`. CI runs all
three plus a VSIX package on Linux, macOS, and Windows. Releases are tag-driven
— see [docs/RELEASING.md](docs/RELEASING.md).

## Coming from `lixiaoliang.diff-visualizer`?

Uninstall the old extension, install this one. Same job: two branches, file
tree, commits. New work lands here only.

## Credits & license

Fork of [Diff Visualizer](https://github.com/lxliang912/diff-visualizer)
(lxliang912 / lkcoffee). See [NOTICE](./NOTICE) and [LICENSE](./LICENSE).
