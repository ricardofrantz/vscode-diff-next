# Security

## Reporting a Vulnerability

Please report security issues privately to the repository owner via GitHub
Security Advisories on
<https://github.com/ricardofrantz/vscode-diff-next/security/advisories/new>,
or by opening a minimal public issue asking for a private contact channel.

Do not include exploit details in public issues.

## Scope and trust model

This extension runs `git` against the repositories opened in the workspace and
shows file content from named refs through a custom document scheme. It does
not send data to a network service — no telemetry, no network calls.

- Git runs only inside workspace repository roots; all invocations go through
  `simple-git` with discrete arguments (no shell).
- Refs and paths arriving from the webview or from virtual-document URIs are
  untrusted: refs must not look like git flags (no leading `-`, no
  git-forbidden characters) and paths must be repo-relative with no `..`
  escapes. Worktree writes are additionally checked to resolve inside the
  target repository root.
- The webview allows only nonce-tagged scripts (no `unsafe-inline`); error
  output renders as text, never HTML.
- The extension declares `untrustedWorkspaces.supported: false` — it stays
  disabled in Restricted Mode.

## Audit History

| Date       | Auditor        | Scope                                        | Result                     |
| ---------- | -------------- | -------------------------------------------- | -------------------------- |
| 2026-08-11 | Claude Fable 5 | `src/`, webview, npm advisories, workflows   | 1 critical dep, 3 hardening |

### 2026-08-11 — Claude Fable 5

**Findings, all remediated in `0.4.0`:**

- `simple-git` ≤3.35.2 carried critical RCE advisories
  (GHSA-jcxm-m3jx-f287, GHSA-r275-fr43-pm7q, GHSA-hffm-xvc3-vprc); upgraded
  past the affected range.
- Webview error messages were rendered with `innerHTML` under a CSP that
  allowed `unsafe-inline` scripts — an HTML-injection path via crafted branch
  names. Now nonce-based CSP plus text-only rendering.
- Refs and paths from webview messages reached git unvalidated (git-flag
  injection, path traversal on the discard/write path). Now validated at every
  boundary; writes are contained to the repository root.
