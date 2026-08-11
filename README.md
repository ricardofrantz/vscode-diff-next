# vscode-diff Next

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE)
[![GitHub](https://img.shields.io/badge/github-vscode--diff--next-blue)](https://github.com/ricardofrantz/vscode-diff-next)

Compare Git branches in VS Code: changed-file tree, commit history, and one-click
built-in diffs — in a dedicated sidebar.

**vscode-diff Next** is Ricardo’s maintained product on top of the classic
[Diff Visualizer](https://github.com/lxliang912/diff-visualizer) lineage. The
upstream git history stays in this repo so the fork trail is honest. Packaging,
host structure, status accuracy, docs, and day-to-day tooling follow the same
bar as [vscode-pdf Next](https://github.com/ricardofrantz/vscode-pdf-next).

## Why this extension?

- **Branch compare without leaving the editor.** Pick base and target; see every
  changed path and the commits between them.
- **Honest file status.** Status comes from `git diff --name-status` (A/M/D/R/C),
  not from guessing via insert/delete counts.
- **Commit history.** Searchable list for the `base..target` range; subject and
  body as git wrote them.
- **Sidebar first.** Own activity-bar view; optional editor panel from the
  command palette.

## Features

| Feature | Status |
| ------- | ------ |
| Dual targets: any two workspace repos + branches | Yes |
| SCM-style list (M / U / D) with foldable groups | Yes |
| M → side-by-side diff; U/D → single side only | Yes |
| Open Target 2 worktree file (↗) | Yes |
| Discard: apply Target 1 → Target 2 worktree | Yes |
| Commit history + search (same-repo only) | Yes |
| Persist last pair + list font size | Yes |
| Windows / Linux / macOS | Yes (`git` on PATH) |

## Getting started

Requires **Git** on `PATH` and VS Code CLI (`code`) on `PATH`.

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

Cross-platform npm wrappers: `npm run update`, `npm run update:norestart`, `npm run update:dev`.

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

1. Click **vscode-diff Next** in the activity bar (`$(git-compare)`).
2. Pick **two unique endpoints** (each is `{folder} · {ref}`). HEAD of each
   workspace folder is listed first; other **local** branches of that folder
   follow. Remotes are hidden. The two sides cannot be the same endpoint.
3. Click a **Modified (M)** file for a side-by-side diff.
4. Click a **New (U)** or **Deleted (D)** file for a single view (one side is empty).
5. Click a group header (Modified / New / Deleted) to fold or expand that section.
6. Same-repo only: commit search for history between the tips.

Command Palette: **vscode-diff Next: Compare Branches**.

## Screenshot

![screenshot](./images/img_example.png)

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
src/host/DiffHost.ts       shared webview + git messages
src/services/gitService.ts git via simple-git
src/webview/               UI
update-extension.ps1       compile → install → restart
```

## Coming from `lixiaoliang.diff-visualizer`?

Uninstall the old extension, install this one. Same job: two branches, file
tree, commits. New work lands here only.

## Credits & license

Fork of [Diff Visualizer](https://github.com/lxliang912/diff-visualizer)
(lxliang912 / lkcoffee). See [NOTICE](./NOTICE) and [LICENSE](./LICENSE).
