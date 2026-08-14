# Changelog

## 0.10.0

Tabs behave like editor tabs, and the picker remembers the folder you are in.

- **Drag a tab** to reorder the strip; the order survives a reload. `Ctrl+Shift+←`
  and `Ctrl+Shift+→` do the same from the keyboard.
- **Double-click a tab** (or `F2`) to rename it. Clearing the name brings back the
  `folder · folder` label.
- **Right-click a tab** for Rename, Duplicate, Close, Close others, and Close to
  the right. The last tab can still never be closed.
- **The second box starts on the folder the first box is using**, so comparing two
  branches of one repo is two clicks. An explicit folder on that side is never
  overridden, and the `←` crumb still gets you back to the folder list.
- A new tab from `+` opens on the folder you were last working in.

## 0.9.2

A thicker strip, real icons, and amber on everything you have already noted.

- The row reads `💾 Save · ◉ fix ◯ improve ◯ explain ◯ re-check ◯ discuss ·
  🗑 Delete`. Delete sits last because deleting is the rare move.
- Every tag is a radio you click. `fix` is armed on every new note.
- The armed tag rides inside the note box as `{fix}`, so it is never a lookup
  away. The box itself has real padding and a 20-character minimum width.
- **Saved notes turn the text amber** — a wash that stays warm on top of the
  diff's green, an amber rail, a mark in the scrollbar, and a `{fix}` chip at
  the end of the range.
- Hovering an amber range shows the tag, the lines, the note, and Delete.

## 0.9.1

The strip now looks like part of the editor and stops holding the keyboard.

- Note, rail, and tag chip take their colours from the theme instead of a fixed
  cream and gold, so they read the same in dark and light.
- The note sits after the first selected line instead of in front of it, so the
  code no longer shifts sideways while you type.
- Typing is captured only while the caret is still on the selection. Click
  anywhere else and the keys go back to the file.
- Clicking a tag no longer re-opens the document, so a compare stays a compare.
- Toolbar reads `✓ Save  ✕  fix improve explain re-check discuss`, with a small
  dot on the active tag.
- A long note scrolls with the caret instead of freezing at the first 120
  characters.

## 0.9.0

Notes sit on the selected lines as a small strip, not the native comment box.

- Save, Delete, and the tags (`fix` `improve` `explain` `re-check` `discuss`) are one row on top of the note.
- Type the note on the selection. Enter saves, Esc discards, and the strip collapses so the next range is free.
- Click a tag to mark it. It does not save until you press Enter or Save.

## 0.8.1

The comment box is smaller and gets out of the way after a save.

- **Save** and **Delete** sit on the top left of the selected text, then the tags.
- Saving collapses the box so the next range is free to mark.
- Delete discards a draft, or removes a saved note from the `-rev.json` file.

## 0.8.0

The first saved comment creates a revision file next to the source.

- `myfile.md` → `myfile-rev.json` (same folder). Later notes append to that file.
- Each note has `selected_text`, `range` (`14-21`, inclusive), `tag`, and `comment`.
- Works in a compare and in ordinary files on disk.

## 0.7.9

Each comment is tagged for Claude / Codex.

- The inline box has **fix**, **improve**, **explain**, **re-check**, **discuss**.
- `{name}.comment.json` next to the file holds `selected_text`, `line`, `tag`, and `comment`.

## 0.7.8

Comments sit on the selected line and write a tiny sibling file.

- Selecting text in a compare shows **Add comment** above that selection.
- The note is typed in the inline box on that line, not a top input.
- The file is `{name}.comment.json` next to the reviewed file, with only `selectedText` and `comment`.

## 0.7.7

Commenting a selection is easier to find and no longer depends on focus staying in the compare.

- Command Palette always lists **Comment selection for agent**.
- Shortcut: Ctrl+Alt+M (Cmd+Alt+M on Mac).
- Compare view has a **Comment** button. The last compare selection is kept if the sidebar takes focus.

## 0.7.6

Select text in a compare and leave a comment for an agent.

- Editor context menu: **Comment selection for agent**.
- Each note is a JSON file under `.diff-next/comments/` plus one `review.json` to hand over.
- The JSON has the file, side, line range, the exact selected text, and your comment.

## 0.7.5

Prev/next file walks the list you see, one file at a time.

- Order matches the grouped file list, not git's raw order.
- Opening a file no longer also jumps to the next hunk.
- An unknown selection no longer snaps to the first or last file.

## 0.7.4

The folder picker gets out of the way, and compare options are labeled toggles.

- Picking a branch closes the list so the file tree is visible again.
- **Compare view** sits under the two targets: Wrap, Ignore spaces, Two columns, Fold same, Pin tab, Moved code, Prev/Next file.
- Each option is on or off by itself. Defaults: wrap and two columns on; the rest off.

## 0.7.3

Session tabs, folder-then-branch pickers, and compare-window controls.

- Several compares stay open as sidebar tabs.
- Each side is picked by folder, then that folder's branches.
- The compare toolbar sets wrap, whitespace, layout, collapse, pin, moved code, and next/prev file.
- Opening a compare no longer fails if a workspace setting write is refused.

## 0.7.2

The file-status vocabulary has one definition.

- **One table instead of four.** The status names and git's letter codes
  lived in `gitService`, while the panel kept its own letters, its own group
  order and its own group labels, and the stylesheet its own classes.
  Nothing tied them together, so a status added on one side never appeared
  on the other. `services/fileStatus.ts` now holds all of it, and DiffHost
  injects it into the panel, which no longer keeps a copy.
- **Behaviour follows the status, once.** "Added means the discard button
  deletes from disk", "deleted means there is nothing on disk to open" and
  "renamed takes its left side from the old path" were spelled out at every
  call site in both the extension and the panel. They are flags on the table
  now.
- **A test that can fail.** `npm run smoke:status` runs the table rather than
  matching the source that declares it: git’s codes map, letters stay
  unique, the order covers every status, unrecognised input still renders,
  the rendered page parses with the table in scope, and every status has a
  CSS rule. It also fails if the panel grows a second copy of the
  vocabulary. Wired into CI.

## 0.7.1

Images and PDFs open.

- **Binary files are served as bytes, not text.** Committed content went through
  a text provider that UTF-8 decoded it on the way out, which rewrote every byte
  a PNG header or a PDF trailer depends on. A read-only filesystem provider now
  hands VS Code the bytes git actually stored.
- **Clicking a figure or a PDF opens a viewer.** Added and deleted files were
  opened with `openTextDocument`, which refuses binary content outright ("File
  seems to be binary and cannot be opened as text"). They now go through normal
  editor resolution: PNG, JPG and friends land in VS Code's image preview, PDFs
  in vscode-pdf Next, and a modified image or PDF opens as a side-by-side
  comparison of the two versions.
- **The repository and ref moved out of the URI query and into its path.**
  Viewers are free to strip the query — vscode-pdf Next does — which would have
  pointed both sides of a PDF comparison at the same bytes.
- **Binary files are marked `bin` in the list** instead of showing a blank
  column where `+0 −0` would read as "nothing changed".
## 0.7.0

The file list now means "what I am about to commit".

- **Compare against the working tree.** When Target 2 is the branch you have
  checked out, the list is `git diff <target 1>` against the files on disk
  rather than against the branch tip. Uncommitted work shows up, and anything
  you change on disk changes the list immediately.
- **The ↺ action is visible and honest.** It always edited files on disk, but
  the list compared two commits, so deleting a file left the row exactly where
  it was and the extension still reported success — even when it had done
  nothing at all. It now reports what actually happened (deleted, restored, or
  already absent), and the row disappears once the working tree matches.
- **It refuses when it cannot apply.** With another branch checked out, the file
  at that path belongs to that branch; the button is disabled and says so
  instead of silently deleting the wrong file.
- **The confirmation names the operation** — "Delete <file> from the working
  tree?" rather than "Apply Target 1 to Target 2 worktree" for a delete — and
  the icon differs for delete versus restore.
- **Autorefresh.** The panel watches `.git/HEAD`, `refs/`, the index and the
  working tree, and re-queries git within about a second of a commit, checkout,
  branch change, staging or file edit made anywhere, including a terminal.
- Failed validation reports an error instead of leaving a permanent
  "Loading changes…" spinner.

## 0.6.0

Per-change revert arrows, like VS Code's own diff editor:

- When Target 2 is the checked-out branch of its repo (and the file exists on
  disk), diffs open against the working-tree file instead of a read-only
  snapshot. The right side becomes editable and VS Code renders its native
  per-change gutter arrow (`→`) to revert a single change to Target 1's
  version; the title marks the side as `· Working Tree`.
- Checkout state is read live (`git rev-parse --abbrev-ref HEAD`) at diff-open
  time, so switching branches in a terminal is picked up immediately; detached
  `HEAD` endpoints count as checked out.
- New setting `diff-next.diffAgainstWorktree` (default `true`) to restore the
  old always-read-only behavior.
- Falls back to read-only snapshots whenever the file is missing on disk or
  Target 2 is not checked out. Deleted files keep the single-side view.

## 0.5.0

Harmonized with vscode-pdf Next — same settings, same release process:

- Tag-driven **Release workflow**: pushing `vX.Y.Z` verifies, packages, attaches
  the VSIX to a GitHub Release, and publishes to Marketplace/Open VSX once the
  PATs are configured (same guardrails as vscode-pdf-next: SHA-pinned actions,
  tag/version validation, protected environment).
- CI reshaped to the family standard: least-privilege permissions, concurrency
  groups, Node 22, production-dependency audit, `workflow_dispatch`.
- Stricter TypeScript (`ES2022`, `noUncheckedIndexedAccess`,
  `exactOptionalPropertyTypes`) matching the sibling repo.
- Engines floor raised to VS Code 1.95; declared
  `untrustedWorkspaces.supported: false` (the extension runs git, so it stays
  disabled in Restricted Mode).
- SECURITY.md rewritten in the family format with an audit-history table;
  added docs/RELEASING.md; shared `.vscode` workspace settings.

## 0.4.0

Security:

- Upgrade `simple-git` past known RCE advisories (GHSA-jcxm-m3jx-f287 and friends).
- Validate every ref and path arriving from the webview or virtual-document URIs:
  refs must not look like git flags; paths must be repo-relative with no `..` escapes.
- Contain discard/restore writes inside the target repository root.
- Nonce-based webview CSP (no more `unsafe-inline` scripts); error messages render
  as text, closing an HTML-injection path via crafted branch names.

Fixes:

- Rename parsing: `--numstat` renames (`old => new`) no longer create phantom
  "modified" entries; renamed files now carry correct +/− counts.
- NUL-separated (`-z`) git output everywhere: unicode and unusual filenames work.
- Renamed/copied files diff old path ↔ new path instead of an empty left side.
- Cross-repo discard copies blob bytes (`cat-file`) — binary files survive unchanged.

Maintenance:

- Default branch renamed `master` → `main`; old `0.0.x` tags removed, releases
  now tagged `vX.Y.Z`.
- Commit history capped at 1000 entries for huge ranges.
- ESLint 9 flat config (`npm run lint` works again) and a lint step in CI;
  dev-dependency audit clean.
- Drop redundant `activationEvents` (auto-generated since VS Code 1.75).

## 0.3.0

- Two endpoint fields only: `{folder} · {ref}` with HEAD first per folder.
- Unique local endpoints (one git root, one id per root+ref); remotes hidden.
- Version-like folder names sort first in the endpoint list.

## 0.2.9

- Open U (new) and D (deleted) as a single side; keep M as side-by-side diff.
- Fold file groups (Modified / New / Deleted); save fold state in the webview.
- Compare roots with case fold only on Windows; keep case on Linux and macOS.
- Add Unix install script and multi-OS CI (compile, path smoke, package).

## 0.2.8

- Fix empty webview: declare font size limits before restore of saved state.

## 0.2.7

- Fix empty dropdowns: normalize Windows git paths (C:/ vs C:\\) for select matching.
- Init always finishes full repo scan and reloads branches for the chosen pair.

## 0.2.6

- Starting point: restore last repo/branch pair and load diff before full workspace scan.
- Save last targets in workspace state after each successful compare.

## 0.2.5

- Faster open: parallel workspace git probe, 60 s repo-list cache, debounce double diff.
- Skip commit-history fetch for cross-repo compares (no shared graph).

## 0.2.4

- List font size +/− (10–18 px), saved in webview state.
- Group files: Modified (M yellow), New (U green), Deleted (D).
- New files show letter U instead of A.

## 0.2.3

- Compact list: no per-row repo badge; one compare line under Changes.
- Selected file row highlight; ↑/↓ and Enter in the file list.
- Hide +0/−0 stats; denser header and rows.

## 0.2.2

- File list styled like Source Control (name, path, badge, M/A/D colours).
- Discard action: apply Target 1 onto Target 2 worktree (confirm first).

## 0.2.1

- Compact bar: `[repo:branch] ⇄ [repo:branch] ↻` — any pair of repos and branches.

## 0.2.0

- Dual targets: each side has its own repository and branch (cross-repo compare).
- Swap and refresh apply to both targets.
- Commit history only when both targets use the same repository.

## 0.1.3

- Commit history starts collapsed.
- Swap base and target with a ⇄ control between the branch lists.
- Refresh control on the branch row (reload icon).

## 0.1.2

- Multi-root workspaces: pick any workspace folder that is a Git repo (not only the first).
- List all local and remote-tracking branches with `git for-each-ref`.

## 0.1.1

- Package production dependencies into the VSIX again (`simple-git`). Builds that used
  `--no-dependencies` failed to activate.

## 0.1.0

- Published as **vscode-diff Next** (`RicardoFrantz.diff-next`), same naming family as **vscode-pdf Next**.
- Activity bar, view, and commands use the full product name `vscode-diff Next`.
- Renamed product, package, repository, and marketplace icon.
- Shared one host for the sidebar and the editor panel.
- Read file status from `git diff --name-status` instead of insert/delete counts.
- Simplified commit history parsing; kept subject and body as git writes them.
- Removed debug logs and unused language map code.
- Added local update script, LICENSE/NOTICE, and development notes.
