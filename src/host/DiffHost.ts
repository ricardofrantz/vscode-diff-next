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

/** Custom scheme for `git show branch:path` virtual documents. */
export const GIT_SHOW_SCHEME = 'diff-next-show';

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

  private pickEndpoint(
    preferredRoot: string,
    preferredRef: string,
    list: CompareEndpoint[],
    fallbackIndex: number,
    excludeId?: string
  ): CompareEndpoint | undefined {
    const filtered = excludeId ? list.filter((e) => e.id !== excludeId) : list;
    if (!filtered.length) {
      return undefined;
    }
    const prefRoot = normalizeRoot(preferredRoot);
    const prefRef = preferredRef || '';
    if (prefRoot && prefRef) {
      const id = makeEndpointId(prefRoot, prefRef);
      const hit = filtered.find((e) => e.id === id);
      if (hit) {
        return hit;
      }
    }
    if (prefRoot) {
      const head = filtered.find((e) => this.sameRoot(e.root, prefRoot) && e.isHead);
      if (head) {
        return head;
      }
      const any = filtered.find((e) => this.sameRoot(e.root, prefRoot));
      if (any) {
        return any;
      }
    }
    const i = Math.min(Math.max(0, fallbackIndex), filtered.length - 1);
    return filtered[i];
  }

  private postEndpoints(
    post: WebviewPost,
    endpoints: CompareEndpoint[],
    ep1: CompareEndpoint | undefined,
    ep2: CompareEndpoint | undefined,
    partial: boolean
  ): void {
    post({
      command: 'endpoints',
      data: {
        endpoints,
        id1: ep1?.id || '',
        id2: ep2?.id || '',
        root1: ep1?.root || '',
        ref1: ep1?.ref || '',
        root2: ep2?.root || '',
        ref2: ep2?.ref || '',
        label1: ep1?.label || '',
        label2: ep2?.label || '',
        partial,
        pathCaseInsensitive: PATH_CASE_INSENSITIVE,
      },
    });
  }

  private async sendEndpoints(
    post: WebviewPost,
    preferred: { root1: string; ref1: string; root2: string; ref2: string },
    forceRefresh: boolean
  ): Promise<void> {
    const saved = this.readSavedTargets();
    const hint1 = normalizeRoot(preferred.root1 || saved?.root1 || '');
    const hint2 = normalizeRoot(preferred.root2 || saved?.root2 || '');
    const hintRef1 = preferred.ref1 || saved?.ref1 || '';
    const hintRef2 = preferred.ref2 || saved?.ref2 || '';

    const fast1 = this.looksLikeGitRoot(hint1) ? normalizeRoot(hint1) : '';
    const fast2 = this.looksLikeGitRoot(hint2) ? normalizeRoot(hint2) : '';

    // Starting point: last pair still on disk → endpoints for those roots first.
    if (!forceRefresh && fast1 && fast2) {
      try {
        const seed = [this.repoInfoForRoot(fast1), this.repoInfoForRoot(fast2)];
        this.repos = seed;
        const seedEps = await GitService.buildEndpoints(seed);
        this.endpoints = seedEps;
        const e1 = this.pickEndpoint(fast1, hintRef1, seedEps, 0);
        const e2 = this.pickEndpoint(fast2, hintRef2, seedEps, 1, e1?.id);
        this.postEndpoints(post, seedEps, e1, e2, true);
      } catch {
        // Fall through to full scan.
      }
    }

    try {
      const list = await this.scanAllRepos(forceRefresh || !(fast1 && fast2));
      if (list.length === 0) {
        post({
          command: 'error',
          message:
            'No Git repository found in this workspace. Open a multi-root workspace that contains git folders.',
        });
        this.postEndpoints(post, [], undefined, undefined, false);
        return;
      }

      const endpoints = await GitService.buildEndpoints(list);
      this.endpoints = endpoints;
      if (endpoints.length === 0) {
        post({
          command: 'error',
          message: 'No local branches found in workspace git folders.',
        });
        this.postEndpoints(post, [], undefined, undefined, false);
        return;
      }

      const e1 = this.pickEndpoint(hint1 || fast1, hintRef1, endpoints, 0);
      let e2 = this.pickEndpoint(hint2 || fast2, hintRef2, endpoints, 1, e1?.id);
      if (!e2 && endpoints.length > 1) {
        e2 = endpoints.find((e) => e.id !== e1?.id) || endpoints[0];
      }
      if (e1 && e2 && e1.id === e2.id && endpoints.length > 1) {
        e2 = endpoints.find((e) => e.id !== e1.id) || e2;
      }

      this.postEndpoints(post, endpoints, e1, e2, false);
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
      if (status === 'added') {
        const uri =
          (await this.worktreeUri(b, filePath)) ?? this.gitShowUri(b.ref, filePath, b.root);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
        return;
      }
      if (status === 'deleted') {
        const uri = this.gitShowUri(a.ref, filePath, a.root);
        const doc = await vscode.workspace.openTextDocument(uri);
        await vscode.window.showTextDocument(doc, { preview: true });
        return;
      }
      // Renamed/copied: the old name lives on Target 1's side.
      const leftPath = (status === 'renamed' || status === 'copied') && oldPath ? oldPath : filePath;
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
      const document = await vscode.workspace.openTextDocument(fileUri);
      await vscode.window.showTextDocument(document);
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

    const removing = status === 'added';
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
      if (status === 'added') {
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
    return vscode.Uri.from({
      scheme: GIT_SHOW_SCHEME,
      path: `/${encodeURIComponent(branch)}/${filePath}`,
      query: JSON.stringify({ branch, path: filePath, root: normalizeRoot(root) }),
    });
  }
}

export class GitShowContentProvider implements vscode.TextDocumentContentProvider {
  async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    try {
      const query = JSON.parse(uri.query) as { branch: string; path: string; root: string };
      // URIs can come from anywhere (recent editors, other extensions):
      // treat ref and path as untrusted.
      if (!isSafeRef(query.branch) || !isSafeRelPath(query.path)) {
        return '';
      }
      const git = new GitService(query.root);
      return await git.getFileContent(query.branch, query.path);
    } catch {
      return '';
    }
  }
}
