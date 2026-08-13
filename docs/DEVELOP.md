# Development

## Layout

```text
src/
  extension.ts              activate; git document scheme
  host/DiffHost.ts          shared webview message handling
  panels/                   sidebar view + editor panel shells
  services/gitService.ts    git via simple-git; normalizeRoot / pathsEqual
  services/fileStatus.ts    the only definition of a changed file's status
  services/endpointPicker.ts  folder grouping, tab labels, session migrate
  services/diffView.ts        compare-window prefs (wrap, layout, next file)
  webview/                  HTML / CSS / JS (injected at runtime)
scripts/smoke-paths.js      path equality smoke (CI)
scripts/smoke-status.js     file-status vocabulary smoke (CI)
scripts/smoke-picker.js     folder grouping + session migrate smoke (CI)
scripts/smoke-diff-view.js  compare-window prefs + next/prev path smoke (CI)
tools/make_icon.py          marketplace icon
update-extension.ps1        Windows: compile → VSIX → install
update-extension.sh         Linux / macOS: same
```

## Day loop

Fastest path (no VSIX):

```bash
npm run update:dev
# other terminal
npm run watch
# Extension Host window: Reload Window after edits
```

Installed-extension path:

```bash
npm run update            # restart Code (platform script)
npm run update:norestart  # you reload the window
```

**Webview JS is plain script** (not TypeScript). Declare `const` helpers
**before** any call that uses them at load time (see 0.2.8 FONT_MAX TDZ).

## Platform paths

- Git always uses `/` inside trees; disk paths use `path.join`.
- `normalizeRoot` → forward slashes, no trailing slash.
- `pathsEqual`: case-insensitive **only** on Windows.
- Host sends `pathCaseInsensitive` on each `endpoints` payload.

## Endpoints (0.3.0+)

- Catalog: unique `(worktree, local ref)`. Label `{folder} · {ref}` or
  `{folder} · {ref} (HEAD)`.
- Picker is folder-then-branch (not a native `<select>`). Helpers live in
  `services/endpointPicker.ts` and are injected as `EndpointPicker`.
- D1 one git root per workspace folder · D2 one id per root+ref · D4 no remotes.
- Build: `GitService.buildEndpoints` after `listWorkspaceRepos`.
- Sessions persist as `diff-next.sessions`; `diff-next.lastTargets` migrates.

## Checks before a tag

```bash
npm run compile
npm run lint
npm run smoke          # paths + file-status vocabulary
npm run package        # @vscode/vsce, from devDependencies
```

Manual smoke: multi-root workspace, add a second tab, pick folder then
branch on each side, switch tabs, refuse closing the last tab, reload the
window, open M / U / D, fold a group, discard one path, refresh.

## Release notes

Bump `version` in `package.json`, add a short entry in `CHANGELOG.md` (simple
past, landed work only), then tag when you publish.
