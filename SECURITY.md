# Security

## Report a problem

Use GitHub Security Advisories on this repository, or open a short public
issue that asks for a private channel. Do not post exploit detail in public
issues.

## Scope

This extension runs `git` on the open workspace folder and shows file content
from named refs through a custom document scheme. It does not send data to a
network service.

## Trust model

- Git runs only inside the workspace root the user opened.
- Webview scripts are injected from extension files; the CSP blocks remote
  sources.
- Branch names and paths from the UI are passed as discrete git arguments, not
  through a shell.

## Hardening still planned

- Confirm before any future write path that changes the worktree.
- Reject path strings that escape the repository root when writing files.
