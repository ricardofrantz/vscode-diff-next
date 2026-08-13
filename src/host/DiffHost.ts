import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';
import {
  GitService,
  RepoInfo,
  CompareEndpoint,
  normalizeRoot,
  pathsEqual,
  pathIsUnder,
  isSafeRef,
  isSafeRelPath,
  PATH_CASE_INSENSITIVE,
  makeEndpointId,
} from '../services/gitService';
import { statusInfo, statusTableScript } from '../services/fileStatus';
import {
  migrateSessions,
  pickerScript,
  type SavedPair,
  type SavedSessions,
} from '../services/endpointPicker';

/** Custom scheme for committed blobs served as virtual read-only files. */
export const GIT_SHOW_SCHEME = 'diff-next-show';

/**
 * Open a file the way VS Code would from the explorer, instead of forcing a
 * text editor onto it. `openTextDocument` refuses binary content ("File seems
 * to be binary and cannot be opened as text"), which is what stopped images and
 * PDFs from opening at all; `vscode.open` runs the normal editor resolution, so
 * a PNG lands in the image preview and a PDF in vscode-pdf Next.
 */
async function openInBestEditor(uri: vscode.Uri, preview = true): Promise<void> {
  await vscode.commands.executeCommand('vscode.open', uri, { preview });
}

export type WebviewPost = (message: unknown) => void;

type Side = {
  root: string;
  ref: string;
};

type SavedTargets = {
  root1: string;
  ref1: string;
  root2: string;
  ref2: string;
};

const STATE_KEY = 'diff-next.lastTargets';
const SESSIONS_KEY = 'diff-next.sessions';

/**
 * Shared host for sidebar and editor panel.
 * Endpoints: unique folder · local ref pairs (HEAD first per folder).
 */
export class DiffHost {
  private repos: RepoInfo[] = [];
  private endpoints: CompareEndpoint[] = [];
  private reposCachedAt = 0;
  private static readonly REPOS_CACHE_MS = 60_000;
  private fullScanInFlight: Promise<RepoInfo[]> | null = null;
  private watchers: vscode.Disposable[] = [];
  private watchedRoots = '';
  private refreshTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTargets: SavedTargets | undefined;
  private static readonly REFRESH_DEBOUNCE_MS = 400;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly context?: vscode.ExtensionContext
  ) {}

  /**
   * Re-query git when the repository or the working tree changes, so the panel
   * stops showing a comparison from whenever you last pressed refresh.
   *
   * Watches `.git/HEAD` (checkout), `refs/**` (commit, branch add or delete) and
   * `index` (staging), plus the working tree itself — which now matters, because
   * the right-hand side of the comparison can be the files on disk.
   */
  private watchRepositories(roots: string[], post: WebviewPost): void {
    const unique = [...new Set(roots.filter(Boolean).map(normalizeRoot))].sort();
    const key = unique.join('|');
    if (key === this.watchedRoots) {
      return;
    }
    this.disposeWatchers();
    this.watchedRoots = key;

    for (const root of unique) {
      for (const pattern of ['.git/HEAD', '.git/refs/**', '.git/index', '**/*']) {
        const watcher = vscode.workspace.createFileSystemWatcher(
          new vscode.RelativePattern(vscode.Uri.file(root), pattern)
        );
        const bump = (): void => this.scheduleRefresh(post);
        watcher.onDidChange(bump);
        watcher.onDidCreate(bump);
        watcher.onDidDelete(bump);
        this.watchers.push(watcher);
      }
    }
  }

  private scheduleRefresh(post: WebviewPost): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      const targets = this.lastTargets;
      if (!targets) {
        return;
      }
      // A repository change can also add or remove branches, so the cached repo
      // scan has to go with it or autorefresh would redraw stale endpoints.
      this.reposCachedAt = 0;
      void this.sendDiff(
        { root: targets.root1, ref: targets.ref1 },
        { root: targets.root2, ref: targets.ref2 },
        post
      );
    }, DiffHost.REFRESH_DEBOUNCE_MS);
  }

  private disposeWatchers(): void {
    for (const watcher of this.watchers) {
      watcher.dispose();
    }
    this.watchers = [];
    this.watchedRoots = '';
  }

  dispose(): void {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = undefined;
    }
    this.disposeWatchers();
  }

  configureWebview(webview: vscode.Webview): void {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'src', 'webview')],
    };
  }

  getHtml(): string {
    const webviewPath = path.join(this.extensionUri.fsPath, 'src', 'webview');
    let html = fs.readFileSync(path.join(webviewPath, 'index.html'), 'utf-8');
    const css = fs.readFileSync(path.join(webviewPath, 'styles.css'), 'utf-8');
    const js = fs.readFileSync(path.join(webviewPath, 'main.js'), 'utf-8');
    const nonce = crypto.randomBytes(16).toString('base64');
    // The panel reads the status vocabulary from here rather than keeping its
    // own copy; see services/fileStatus.ts.
    html = html.replace('/* INJECT_STATUS_TABLE */', statusTableScript());
    html = html.replace('/* INJECT_PICKER */', pickerScript());
    html = html.replace('/* INJECT_CSS */', css);
    html = html.replace('/* INJECT_JS */', js);
    html = html.split('INJECT_NONCE').join(nonce);
    return html;
  }

  async handleMessage(
    message: { command?: string; [key: string]: unknown },
    post: WebviewPost
  ): Promise<void> {
    try {
      switch (message.command) {
        case 'saveSessions':
          await this.writeSavedSessions({
            sessions: Array.isArray(message.sessions) ? (message.sessions as SavedPair[]) : [],
            activeId: String(message.activeId ?? ''),
          });
          break;
        case 'getRepos':
        case 'getEndpoints':
          await this.sendEndpoints(
            post,
            {
              root1: String(message.root1 ?? ''),
              ref1: String(message.ref1 ?? ''),
              root2: String(message.root2 ?? ''),
              ref2: String(message.ref2 ?? ''),
            },
            false
          );
          break;
        case 'refresh':
          await this.sendEndpoints(
            post,
            {
              root1: String(message.root1 ?? ''),
              ref1: String(message.ref1 ?? ''),
              root2: String(message.root2 ?? ''),
              ref2: String(message.ref2 ?? ''),
            },
            true
          );
          break;
        case 'getDiff':
          await this.sendDiff(
            { root: String(message.root1 ?? ''), ref: String(message.ref1 ?? '') },
            { root: String(message.root2 ?? ''), ref: String(message.ref2 ?? '') },
            post
          );
          break;
        case 'getCommitHistory':
          await this.sendCommits(
            { root: String(message.root1 ?? ''), ref: String(message.ref1 ?? '') },
            { root: String(message.root2 ?? ''), ref: String(message.ref2 ?? '') },
            post
          );
          break;
        case 'openDiff':
          await this.openDiff(
            { root: String(message.root1 ?? ''), ref: String(message.ref1 ?? '') },
            { root: String(message.root2 ?? ''), ref: String(message.ref2 ?? '') },
            String(message.filePath ?? ''),
            String(message.status ?? ''),
            String(message.oldPath ?? '')
          );
          break;
        case 'openFile':
          await this.openWorktreeFile(
            String(message.root ?? ''),
            String(message.filePath ?? '')
          );
          break;
        case 'discardFile':
          await this.discardFile(
            { root: String(message.root1 ?? ''), ref: String(message.ref1 ?? '') },
            { root: String(message.root2 ?? ''), ref: String(message.ref2 ?? '') },
            String(message.filePath ?? ''),
            String(message.status ?? ''),
            post
          );
          break;
        default:
          break;
      }
    } catch (error) {
      post({ command: 'error', message: `Extension error: ${error}` });
    }
  }

  private readSavedTargets(): SavedTargets | undefined {
    const raw = this.context?.workspaceState.get<SavedTargets>(STATE_KEY);
    if (!raw) {
      return undefined;
    }
    return {
      root1: normalizeRoot(raw.root1),
      ref1: raw.ref1 || '',
      root2: normalizeRoot(raw.root2),
      ref2: raw.ref2 || '',
    };
  }

  private readSavedSessions(): SavedSessions {
    const raw = this.context?.workspaceState.get<SavedSessions>(SESSIONS_KEY);
    return migrateSessions(raw, this.readSavedTargets());
  }

  private applyActivePair(saved: SavedSessions): void {
    const active = saved.sessions.find((s) => s.id === saved.activeId) || saved.sessions[0];
    if (active?.root1 && active.root2 && active.ref1 && active.ref2) {
      this.lastTargets = {
        root1: normalizeRoot(active.root1),
        ref1: active.ref1,
        root2: normalizeRoot(active.root2),
        ref2: active.ref2,
      };
      return;
    }
    this.lastTargets = undefined;
    this.disposeWatchers();
  }

  private async writeSavedSessions(input: SavedSessions): Promise<void> {
    if (!this.context) {
      return;
    }
    const saved = migrateSessions(input, undefined);
    await this.context.workspaceState.update(SESSIONS_KEY, saved);
    this.applyActivePair(saved);
    if (this.lastTargets) {
      await this.writeSavedTargets(this.lastTargets);
    }
  }

  private async writeSavedTargets(t: SavedTargets): Promise<void> {
    if (!this.context) {
      return;
    }
    await this.context.workspaceState.update(STATE_KEY, {
      root1: normalizeRoot(t.root1),
      ref1: t.ref1,
      root2: normalizeRoot(t.root2),
      ref2: t.ref2,
    });
  }

  private looksLikeGitRoot(root: string): boolean {
    const r = normalizeRoot(root);
    if (!r || !fs.existsSync(r)) {
      return false;
    }
    return fs.existsSync(path.join(r, '.git'));
  }

  private repoInfoForRoot(root: string): RepoInfo {
    const r = normalizeRoot(root);
    const folders = vscode.workspace.workspaceFolders ?? [];
    const match = folders.find((f) => {
      const fp = normalizeRoot(f.uri.fsPath);
      return pathsEqual(fp, r) || pathIsUnder(r, fp);
    });
    return {
      name: match?.name ?? path.basename(r),
      root: r,
      folderPath: match ? normalizeRoot(match.uri.fsPath) : r,
    };
  }

  private async scanAllRepos(force: boolean): Promise<RepoInfo[]> {
    const now = Date.now();
    if (
      !force &&
      this.repos.length > 0 &&
      now - this.reposCachedAt < DiffHost.REPOS_CACHE_MS
    ) {
      return this.repos;
    }
    if (this.fullScanInFlight && !force) {
      return this.fullScanInFlight;
    }
    this.fullScanInFlight = (async () => {
      const folders = vscode.workspace.workspaceFolders ?? [];
      const list = await GitService.listWorkspaceRepos(
        folders.map((f) => ({ name: f.name, path: f.uri.fsPath }))
      );
      this.repos = list;
      this.reposCachedAt = Date.now();
      return list;
    })().finally(() => {
      this.fullScanInFlight = null;
    });
    return this.fullScanInFlight;
  }

  private sameRoot(a: string, b: string): boolean {
    return pathsEqual(a, b);
  }

  /** Webview messages are untrusted input: refs must not look like git flags. */
  private validRefs(...refs: string[]): boolean {
    return refs.every((r) => isSafeRef(r));
  }

  private postEndpoints(
    post: WebviewPost,
    endpoints: CompareEndpoint[],
    partial: boolean
  ): void {
    const saved = this.readSavedSessions();
    post({
      command: 'endpoints',
      data: {
        endpoints,
        partial,
        pathCaseInsensitive: PATH_CASE_INSENSITIVE,
        sessions: saved.sessions,
        activeId: saved.activeId,
      },
    });
  }

  private async sendEndpoints(
    post: WebviewPost,
    preferred: { root1: string; ref1: string; root2: string; ref2: string },
    forceRefresh: boolean
  ): Promise<void> {
    const sessions = this.readSavedSessions();
    const active = sessions.sessions.find((s) => s.id === sessions.activeId) || sessions.sessions[0];
    const hint1 = normalizeRoot(preferred.root1 || active?.root1 || '');
    const hint2 = normalizeRoot(preferred.root2 || active?.root2 || '');
    const fast1 = this.looksLikeGitRoot(hint1) ? normalizeRoot(hint1) : '';
    const fast2 = this.looksLikeGitRoot(hint2) ? normalizeRoot(hint2) : '';

    if (!forceRefresh && (fast1 || fast2)) {
      try {
        const seed = [fast1, fast2]
          .filter(Boolean)
          .map((root) => this.repoInfoForRoot(root));
        this.repos = seed;
        const seedEps = await GitService.buildEndpoints(seed);
        this.endpoints = seedEps;
        this.postEndpoints(post, seedEps, true);
      } catch {
        // Fall through to full scan.
      }
    }

    try {
      const list = await this.scanAllRepos(forceRefresh || !(fast1 || fast2));
      if (list.length === 0) {
        post({
          command: 'error',
          message:
            'No Git repository found in this workspace. Open a multi-root workspace that contains git folders.',
        });
        this.postEndpoints(post, [], false);
        return;
      }

      const endpoints = await GitService.buildEndpoints(list);
      this.endpoints = endpoints;
      if (endpoints.length === 0) {
        post({
          command: 'error',
          message: 'No local branches found in workspace git folders.',
        });
        this.postEndpoints(post, [], false);
        return;
      }

      this.postEndpoints(post, endpoints, false);
    } catch (error) {
      post({ command: 'error', message: `Could not list compare endpoints: ${error}` });
    }
  }

  private endpointLabel(root: string, ref: string): string {
    const id = makeEndpointId(root, ref);
    const hit = this.endpoints.find((e) => e.id === id);
    if (hit) {
      return hit.label;
    }
    const folder =
      this.repos.find((r) => this.sameRoot(r.root, root))?.name ?? path.basename(root);
    return `${folder} · ${ref}`;
  }

  private async sendDiff(t1: Side, t2: Side, post: WebviewPost): Promise<void> {
    const a = { root: normalizeRoot(t1.root), ref: t1.ref };
    const b = { root: normalizeRoot(t2.root), ref: t2.ref };
    if (!a.root || !b.root || !this.validRefs(a.ref, b.ref)) {
      post({
        command: 'error',
        message: 'Could not load diff: unusable repository path or branch name.',
      });
      return;
    }
    try {
      // When Target 2 is the branch you have checked out, compare against the
      // working tree: the list then means "what I am about to commit", so
      // editing a file on disk changes it and the ↺ action has visible effect.
      const live = await this.isLiveWorktree(a, b);
      const data = await GitService.compareTrees(a.root, a.ref, b.root, b.ref, live);
      post({
        command: 'diff',
        data: {
          ...data,
          crossRepo: !this.sameRoot(a.root, b.root),
          workingTree: live,
          label1: this.endpointLabel(a.root, a.ref),
          label2: live
            ? `${this.endpointLabel(b.root, b.ref)} (working tree)`
            : this.endpointLabel(b.root, b.ref),
        },
      });
      this.lastTargets = { root1: a.root, ref1: a.ref, root2: b.root, ref2: b.ref };
      this.watchRepositories([a.root, b.root], post);
      void this.writeSavedTargets(this.lastTargets);
    } catch (error) {
      post({ command: 'error', message: `Could not load diff: ${error}` });
    }
  }

  private async sendCommits(t1: Side, t2: Side, post: WebviewPost): Promise<void> {
    const a = { root: normalizeRoot(t1.root), ref: t1.ref };
    const b = { root: normalizeRoot(t2.root), ref: t2.ref };
    if (!a.root || !b.root || !this.validRefs(a.ref, b.ref)) {
      return;
    }
    if (!this.sameRoot(a.root, b.root)) {
      post({
        command: 'commits',
        data: [],
        note: 'Commit history is only for two branches in the same repository.',
      });
      return;
    }
    try {
      const git = new GitService(a.root);
      const data = await git.getCommitHistory(a.ref, b.ref);
      post({ command: 'commits', data });
    } catch (error) {
      post({ command: 'error', message: `Could not load commits: ${error}` });
    }
  }

  /**
   * Real-file URI for Target 2's worktree copy, or undefined when ineligible.
   * Eligible only when Target 2's ref is the checked-out branch (or a detached
   * 'HEAD' endpoint) and the file exists on disk. An editable right side makes
   * VS Code render its native per-change revert arrow in the diff gutter.
   */
  /**
   * Is Target 2 the branch actually checked out in its own repository?
   *
   * Only then does the working tree belong to the endpoint the user picked, and
   * only then can editing files on disk change what the comparison shows.
   */
  private async isLiveWorktree(a: Side, b: Side): Promise<boolean> {
    if (!this.sameRoot(a.root, b.root)) {
      return false;
    }
    if (
      !vscode.workspace
        .getConfiguration('diff-next')
        .get<boolean>('diffAgainstWorktree', true)
    ) {
      return false;
    }
    if (b.ref === 'HEAD') {
      return true;
    }
    const current = await new GitService(b.root).getCurrentBranch().catch(() => '');
    return Boolean(current) && current === b.ref;
  }

  private async worktreeUri(b: Side, filePath: string): Promise<vscode.Uri | undefined> {
    const enabled = vscode.workspace
      .getConfiguration('diff-next')
      .get<boolean>('diffAgainstWorktree', true);
    if (!enabled) {
      return undefined;
    }
    if (b.ref !== 'HEAD') {
      const current = await new GitService(b.root).getCurrentBranch().catch(() => '');
      if (!current || b.ref !== current) {
        return undefined;
      }
    }
    const abs = path.resolve(b.root, filePath);
    if (!pathIsUnder(abs, b.root) || !fs.existsSync(abs)) {
      return undefined;
    }
    return vscode.Uri.file(abs);
  }

  /**
   * Open file content. Modified → side-by-side diff.
   * Added (U) → Target 2 only. Deleted (D) → Target 1 only.
   * The right side is the on-disk file when Target 2 is the checked-out branch,
   * so the diff is editable and shows per-change revert arrows.
   */
  private async openDiff(
    t1: Side,
    t2: Side,
    filePath: string,
    status: string,
    oldPath = ''
  ): Promise<void> {
    const a = { root: normalizeRoot(t1.root), ref: t1.ref };
    const b = { root: normalizeRoot(t2.root), ref: t2.ref };
    if (!filePath || !a.root || !b.root || !this.validRefs(a.ref, b.ref)) {
      return;
    }
    if (!isSafeRelPath(filePath) || (oldPath && !isSafeRelPath(oldPath))) {
      return;
    }
    try {
      const info = statusInfo(status);
      if (info.addedInTarget2) {
        const uri =
          (await this.worktreeUri(b, filePath)) ?? this.gitShowUri(b.ref, filePath, b.root);
        await openInBestEditor(uri);
        return;
      }
      if (!info.presentInTarget2) {
        const uri = this.gitShowUri(a.ref, filePath, a.root);
        await openInBestEditor(uri);
        return;
      }
      // Renamed/copied: the old name lives on Target 1's side.
      const leftPath = info.carriesOldPath && oldPath ? oldPath : filePath;
      const leftUri = this.gitShowUri(a.ref, leftPath, a.root);
      const wt = await this.worktreeUri(b, filePath);
      const rightUri = wt ?? this.gitShowUri(b.ref, filePath, b.root);
      const rightLabel = wt
        ? `${this.endpointLabel(b.root, b.ref)} · Working Tree`
        : this.endpointLabel(b.root, b.ref);
      const title = `${path.basename(filePath)} (${this.endpointLabel(a.root, a.ref)} ↔ ${rightLabel})`;
      await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not open file: ${error}`);
    }
  }

  private async openWorktreeFile(root: string, filePath: string): Promise<void> {
    const r = normalizeRoot(root);
    if (!r || !isSafeRelPath(filePath)) {
      return;
    }
    const fileUri = vscode.Uri.file(path.join(r, filePath));
    try {
      await openInBestEditor(fileUri, false);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not open file: ${error}`);
    }
  }

  private async discardFile(
    t1: Side,
    t2: Side,
    filePath: string,
    status: string,
    post: WebviewPost
  ): Promise<void> {
    const a = { root: normalizeRoot(t1.root), ref: t1.ref };
    const b = { root: normalizeRoot(t2.root), ref: t2.ref };
    if (!a.root || !b.root || !this.validRefs(a.ref, b.ref) || !isSafeRelPath(filePath)) {
      post({ command: 'error', message: 'Cannot apply: unusable path or branch name.' });
      return;
    }

    // Writing to disk only makes sense when that disk belongs to Target 2. With
    // another branch checked out, the file at this path is someone else's.
    if (!(await this.isLiveWorktree(a, b))) {
      const message =
        `Cannot change ${filePath}: Target 2 (${this.endpointLabel(b.root, b.ref)}) ` +
        `is not checked out, so this comparison is read-only.`;
      void vscode.window.showWarningMessage(message);
      post({ command: 'error', message });
      return;
    }

    const removing = statusInfo(status).addedInTarget2;
    const question = removing
      ? `Delete ${filePath} from the working tree?`
      : `Restore ${filePath} from ${this.endpointLabel(a.root, a.ref)} into the working tree?`;
    const confirm = removing ? 'Delete' : 'Restore';
    const pick = await vscode.window.showWarningMessage(
      `${question}\n\nThis changes files on disk. Commit the result yourself afterwards.`,
      { modal: true },
      confirm
    );
    if (pick !== confirm) {
      return;
    }

    try {
      const destAbs = path.resolve(b.root, filePath);
      if (!pathIsUnder(destAbs, b.root)) {
        throw new Error(`Path escapes Target 2 root: ${filePath}`);
      }
      const same = this.sameRoot(a.root, b.root);

      let outcome: string;
      if (removing) {
        if (fs.existsSync(destAbs)) {
          fs.unlinkSync(destAbs);
          outcome = `Deleted ${filePath} from the working tree`;
        } else {
          // Nothing to delete. Saying "done" here is what made this look broken.
          outcome = `${filePath} was already absent from the working tree`;
        }
      } else if (same) {
        await new GitService(b.root).restoreWorktreeFrom(a.ref, filePath);
        outcome = `Restored ${filePath} from ${this.endpointLabel(a.root, a.ref)}`;
      } else {
        await new GitService(a.root).writeBlobToAbsolutePath(a.ref, filePath, destAbs);
        outcome = `Wrote ${filePath} from ${this.endpointLabel(a.root, a.ref)}`;
      }

      post({ command: 'discardDone', filePath });
      void vscode.window.showInformationMessage(`${outcome}. Commit when you are ready.`);
      await this.sendDiff(a, b, post);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not discard: ${error}`);
      post({ command: 'error', message: `Could not discard: ${error}` });
    }
  }

  private gitShowUri(branch: string, filePath: string, root: string): vscode.Uri {
    return makeBlobUri(root, branch, filePath);
  }
}

/**
 * Which repository and ref a blob URI points at, encoded into the *path*.
 *
 * The endpoint used to live in the query string, which cost nothing while
 * everything was text — but viewers do not all keep it. vscode-pdf Next, for
 * one, reads `resource.with({ query: '', fragment: '' })`, so a ref parked in
 * the query would be dropped and both sides of a PDF diff would ask for the
 * same bytes. Encoded in the path it survives every viewer, and the real file
 * name still ends the URI so `*.png` / `*.pdf` editor globs keep matching.
 */
function encodeEndpoint(root: string, ref: string): string {
  const json = JSON.stringify({ root: normalizeRoot(root), ref });
  return Buffer.from(json, 'utf8').toString('base64url');
}

function decodeEndpoint(token: string): { root: string; ref: string } | null {
  try {
    const parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8')) as {
      root?: unknown;
      ref?: unknown;
    };
    const root = typeof parsed.root === 'string' ? parsed.root : '';
    const ref = typeof parsed.ref === 'string' ? parsed.ref : '';
    return root && ref ? { root, ref } : null;
  } catch {
    return null;
  }
}

/** `diff-next-show:/<endpoint>/<repo relative path>` for one blob. */
export function makeBlobUri(root: string, ref: string, filePath: string): vscode.Uri {
  return vscode.Uri.from({
    scheme: GIT_SHOW_SCHEME,
    path: `/${encodeEndpoint(root, ref)}/${filePath.replace(/\\/g, '/')}`,
  });
}

type BlobTarget = { root: string; ref: string; filePath: string };

function parseBlobUri(uri: vscode.Uri): BlobTarget | null {
  const raw = uri.path.replace(/^\/+/, '');
  const slash = raw.indexOf('/');
  if (slash <= 0) {
    return null;
  }
  const endpoint = decodeEndpoint(raw.slice(0, slash));
  const filePath = raw.slice(slash + 1);
  if (!endpoint || !filePath) {
    return null;
  }
  // URIs can come from anywhere (restored editors, other extensions):
  // treat ref and path as untrusted.
  if (!isSafeRef(endpoint.ref) || !isSafeRelPath(filePath)) {
    return null;
  }
  return { root: endpoint.root, ref: endpoint.ref, filePath };
}

/**
 * Serves committed blobs as bytes.
 *
 * A TextDocumentContentProvider can only return a string, which is why images
 * and PDFs used to arrive mangled or refused to open at all: the bytes were
 * UTF-8 decoded on the way out. A FileSystemProvider hands VS Code the real
 * bytes, so its own binary detection kicks in and the file reaches whichever
 * editor claims it — the built-in image preview, or vscode-pdf Next for PDFs,
 * both of which read through `vscode.workspace.fs`.
 */
export class GitBlobFileSystemProvider implements vscode.FileSystemProvider {
  private readonly changeEmitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changeEmitter.event;

  /**
   * VS Code asks for stat and content back to back, and each call is a git
   * process. One short-lived entry per URI answers both from a single read
   * while still picking up new content the next time the file is opened.
   */
  private readonly cache = new Map<string, { bytes: Uint8Array; at: number }>();
  private static readonly CACHE_MS = 5_000;

  watch(): vscode.Disposable {
    // Committed blobs never change under us; a moved branch reopens the editor.
    return new vscode.Disposable(() => undefined);
  }

  private async read(uri: vscode.Uri): Promise<Uint8Array> {
    const key = uri.toString();
    const hit = this.cache.get(key);
    const now = Date.now();
    if (hit && now - hit.at < GitBlobFileSystemProvider.CACHE_MS) {
      return hit.bytes;
    }
    const target = parseBlobUri(uri);
    if (!target) {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    let bytes: Uint8Array;
    try {
      const buffer = await new GitService(target.root).getBlobBytes(
        target.ref,
        target.filePath
      );
      bytes = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength).slice();
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri);
    }
    if (this.cache.size > 64) {
      this.cache.clear();
    }
    this.cache.set(key, { bytes, at: now });
    return bytes;
  }

  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const bytes = await this.read(uri);
    return {
      type: vscode.FileType.File,
      ctime: 0,
      mtime: 0,
      size: bytes.byteLength,
      permissions: vscode.FilePermission.Readonly,
    };
  }

  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    return this.read(uri);
  }

  readDirectory(): [string, vscode.FileType][] {
    return [];
  }

  createDirectory(): void {
    throw vscode.FileSystemError.NoPermissions('Committed content is read-only.');
  }

  writeFile(): void {
    throw vscode.FileSystemError.NoPermissions('Committed content is read-only.');
  }

  delete(): void {
    throw vscode.FileSystemError.NoPermissions('Committed content is read-only.');
  }

  rename(): void {
    throw vscode.FileSystemError.NoPermissions('Committed content is read-only.');
  }
}
