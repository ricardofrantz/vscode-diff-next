# Releasing and maintainer notes

Same release flow as [vscode-pdf Next](https://github.com/ricardofrantz/vscode-pdf-next/blob/main/docs/RELEASING.md).

## Releasing (tag-driven)

Pushing a version tag releases automatically via GitHub Actions:

1. Bump `version` in `package.json` and update `CHANGELOG.md`.
2. Commit on `main`, then tag and push:

   ```bash
   git tag vX.Y.Z
   git push origin main vX.Y.Z
   ```

3. The **Release** workflow verifies (lint, compile, path and file-status
   smokes, production audit), packages the VSIX, creates/updates the GitHub Release with the VSIX
   attached, then publishes to:
   - VS Code Marketplace (`VSCE_PAT` secret — skipped with a note until the
     extension is registered and the secret is set)
   - Open VSX (`OVSX_PAT` secret — optional)

Manual dry-run (no publish): **Actions → Release → Run workflow** with
`dry_run=true`. Manual publish without a new tag: `dry_run=false` and
`confirm_publish=publish vX.Y.Z`.

## Secrets

| Secret     | Where                                     | Purpose                        |
| ---------- | ----------------------------------------- | ------------------------------ |
| `VSCE_PAT` | Repo or `marketplace-publish` environment | Marketplace Manage scope PAT   |
| `OVSX_PAT` | Repo or `marketplace-publish` environment | Open VSX personal access token |

Create the Azure DevOps PAT with **Marketplace → Manage**, organization
**All accessible organizations**, then:

```bash
gh secret set VSCE_PAT -R ricardofrantz/vscode-diff-next
# optional:
gh secret set OVSX_PAT -R ricardofrantz/vscode-diff-next
```

## Release workflow guardrails

Third-party actions are pinned by full commit SHA, jobs use concurrency
groups, and the workflow validates that the tag is a well-formed
`v<major>.<minor>.<patch>` tag whose commit matches `package.json`'s version.
Tag pushes publish automatically after verification; manual
`workflow_dispatch` runs additionally require `dry_run=false`, a matching
`confirm_publish` phrase, and (optionally) reviewer approval on the
`marketplace-publish` environment.

## Versioning

Releases are tagged `vX.Y.Z` on `main`. The old bare `0.0.x` tags from the
pre-rename era were removed on 2026-08-11.
