# Development

## Layout

```text
src/
  extension.ts              activate; git document scheme
  host/DiffHost.ts          shared webview message handling
  panels/                   sidebar view + editor panel shells
  services/gitService.ts    git via simple-git; normalizeRoot / pathsEqual
  webview/                  HTML / CSS / JS (injected at runtime)
scripts/smoke-paths.js      path equality smoke (CI)
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

- One dropdown per side; option = unique `(worktree, local ref)`.
- Label: `{folder} · {ref}` or `{folder} · {ref} (HEAD)`.
- D1 one git root per workspace folder · D2 one id per root+ref · D4 no remotes.
- Build: `GitService.buildEndpoints` after `listWorkspaceRepos`.

## Checks before a tag

```bash
npm run compile
npm run smoke:paths
npx @vscode/vsce package
code --install-extension ./diff-next-<version>.vsix --force
```

Manual smoke: multi-root workspace, pick two sides, open M / U / D, fold a
group, discard one path, refresh.

## Release notes

Bump `version` in `package.json`, add a short entry in `CHANGELOG.md` (simple
past, landed work only), then tag when you publish.
