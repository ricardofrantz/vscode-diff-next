import simpleGit, { SimpleGit } from 'simple-git';
import * as path from 'path';
import * as fs from 'fs';

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unknown';

export interface DiffFile {
  path: string;
  oldPath?: string;
  additions: number;
  deletions: number;
  status: FileStatus;
}

export interface CommitInfo {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
}

export interface DiffResult {
  files: DiffFile[];
  totalAdditions: number;
  totalDeletions: number;
}

/** One git checkout that appears as a workspace folder. */
export interface RepoInfo {
  /** Workspace folder display name (e.g. ss-2.6.0). */
  name: string;
  /** Absolute git toplevel. */
  root: string;
  /** Workspace folder path (may equal root). */
  folderPath: string;
}

/**
 * One compare endpoint: unique (worktree, ref).
 * D1 one root per list · D2 one id per (root, ref) · D4 local heads only.
 */
export interface CompareEndpoint {
  /** Stable key: normalizeRoot(root) + tab + ref */
  id: string;
  root: string;
  ref: string;
  /** UI: `{folder} · {ref}` or `{folder} · {ref} (HEAD)` */
  label: string;
  folder: string;
  isHead: boolean;
}

/** Safe for <option value> (no raw path separators). */
export function makeEndpointId(root: string, ref: string): string {
  return `${encodeURIComponent(normalizeRoot(root))}@${encodeURIComponent(ref)}`;
}

export function parseEndpointId(id: string): { root: string; ref: string } | null {
  if (!id) {
    return null;
  }
  const i = id.indexOf('@');
  if (i < 0) {
    return null;
  }
  try {
    return {
      root: decodeURIComponent(id.slice(0, i)),
      ref: decodeURIComponent(id.slice(i + 1)),
    };
  } catch {
    return null;
  }
}

export interface BranchList {
  local: string[];
  remote: string[];
  current: string;
}

const STATUS_MAP: Record<string, FileStatus> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  C: 'copied',
  T: 'typechange',
};

/** Canonical root path so Windows C:/ and C:\\ match in UI selects. */
export function normalizeRoot(p: string): string {
  if (!p) {
    return '';
  }
  try {
    return path.normalize(p).replace(/\\/g, '/').replace(/\/+$/, '');
  } catch {
    return p;
  }
}

/** True on Windows: drive letter and path case do not distinguish roots. */
export const PATH_CASE_INSENSITIVE = process.platform === 'win32';

/** Compare absolute roots; case folds only on Windows. */
export function pathsEqual(a: string, b: string): boolean {
  const na = normalizeRoot(a);
  const nb = normalizeRoot(b);
  if (!na || !nb) {
    return false;
  }
  if (PATH_CASE_INSENSITIVE) {
    return na.toLowerCase() === nb.toLowerCase();
  }
  return na === nb;
}

/** True if `child` is `parent` or a path under it. */
export function pathIsUnder(child: string, parent: string): boolean {
  const c = normalizeRoot(child);
  const p = normalizeRoot(parent);
  if (!c || !p) {
    return false;
  }
  if (pathsEqual(c, p)) {
    return true;
  }
  const prefix = p.endsWith('/') ? p : p + '/';
  if (PATH_CASE_INSENSITIVE) {
    return c.toLowerCase().startsWith(prefix.toLowerCase());
  }
  return c.startsWith(prefix);
}

/** Lower first: folder names that look like versioned trees (1.2.0, 2.6.0-PR). */
function versionFolderScore(name: string): number {
  if (/\d+\.\d+/.test(name || '')) {
    return 0;
  }
  return 1;
}

/**
 * Thin git façade for one repository root.
 * Paths and refs are passed as discrete arguments (no shell).
 */
export class GitService {
  private readonly git: SimpleGit;
  private readonly workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = normalizeRoot(workspaceRoot) || workspaceRoot;
    this.git = simpleGit(this.workspaceRoot);
  }

  getWorkspaceRoot(): string {
    return this.workspaceRoot;
  }

  /**
   * Local heads only (D4: remotes hidden).
   * Still returns remote: [] so callers stay compatible.
   */
  async getLocalBranches(): Promise<BranchList> {
    const current = (await this.git.revparse(['--abbrev-ref', 'HEAD']).catch(() => '')).trim();
    const currentBranch = current === 'HEAD' ? '' : current;

    const raw = await this.git.raw([
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)',
      'refs/heads',
    ]);

    const local: string[] = [];
    const localSet = new Set<string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const [refname, shortRaw] = trimmed.split('\0');
      if (!refname || !refname.startsWith('refs/heads/')) {
        continue;
      }
      const name = shortRaw || refname.slice('refs/heads/'.length);
      if (name && !localSet.has(name)) {
        localSet.add(name);
        local.push(name);
      }
    }
    local.sort((a, b) => a.localeCompare(b));
    return { local, remote: [], current: currentBranch };
  }

  /**
   * Local heads + remote-tracking branches via for-each-ref (full list).
   */
  async getAllBranches(): Promise<BranchList> {
    const current = (await this.git.revparse(['--abbrev-ref', 'HEAD']).catch(() => '')).trim();
    // Detached HEAD → empty current is fine.
    const currentBranch = current === 'HEAD' ? '' : current;

    const raw = await this.git.raw([
      'for-each-ref',
      '--format=%(refname)%00%(refname:short)',
      'refs/heads',
      'refs/remotes',
    ]);

    const local: string[] = [];
    const remote: string[] = [];
    const localSet = new Set<string>();
    const remoteSet = new Set<string>();

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const [refname, shortRaw] = trimmed.split('\0');
      if (!refname) {
        continue;
      }
      if (refname.startsWith('refs/heads/')) {
        const name = shortRaw || refname.slice('refs/heads/'.length);
        if (!localSet.has(name)) {
          localSet.add(name);
          local.push(name);
        }
      } else if (refname.startsWith('refs/remotes/')) {
        // Skip remote HEAD pointers (origin/HEAD → origin/main).
        if (refname.endsWith('/HEAD') || shortRaw === 'origin/HEAD' || shortRaw?.includes('/HEAD')) {
          continue;
        }
        const name = shortRaw || refname.slice('refs/remotes/'.length);
        if (name.endsWith('/HEAD')) {
          continue;
        }
        if (!remoteSet.has(name)) {
          remoteSet.add(name);
          remote.push(name);
        }
      }
    }

    local.sort((a, b) => a.localeCompare(b));
    remote.sort((a, b) => a.localeCompare(b));

    return { local, remote, current: currentBranch };
  }

  async getDiffFiles(baseBranch: string, targetBranch: string): Promise<DiffResult> {
    const [statusMap, numstat] = await Promise.all([
      this.readNameStatus(baseBranch, targetBranch),
      this.readNumstat(baseBranch, targetBranch),
    ]);

    const paths = new Set<string>([...statusMap.keys(), ...numstat.keys()]);
    const files: DiffFile[] = [];
    let totalAdditions = 0;
    let totalDeletions = 0;

    for (const filePath of [...paths].sort()) {
      const st = statusMap.get(filePath) ?? { status: 'modified' as FileStatus };
      const counts = numstat.get(filePath) ?? { additions: 0, deletions: 0 };
      totalAdditions += counts.additions;
      totalDeletions += counts.deletions;
      files.push({
        path: filePath,
        oldPath: st.oldPath,
        additions: counts.additions,
        deletions: counts.deletions,
        status: st.status,
      });
    }

    return { files, totalAdditions, totalDeletions };
  }

  async getCommitHistory(baseBranch: string, targetBranch: string): Promise<CommitInfo[]> {
    const result = await this.git.raw([
      'log',
      `${baseBranch}..${targetBranch}`,
      '--format=%H%x1f%an%x1f%aI%x1f%s%x1f%b%x1e',
      '--',
    ]);

    if (!result.trim()) {
      return [];
    }

    const commits: CommitInfo[] = [];
    for (const record of result.split('\x1e')) {
      const trimmed = record.trim();
      if (!trimmed) {
        continue;
      }
      const [hash, author, date, subject, body] = trimmed.split('\x1f');
      if (!hash) {
        continue;
      }
      const message = body?.trim()
        ? `${subject.trim()}\n${body.trim()}`
        : (subject ?? '').trim();
      commits.push({
        hash: hash.trim(),
        shortHash: hash.trim().slice(0, 7),
        message,
        author: (author ?? '').trim(),
        date: this.formatDate(date ?? ''),
      });
    }

    return commits;
  }

  async getFileContent(branch: string, filePath: string): Promise<string> {
    try {
      return await this.git.show([`${branch}:${filePath}`]);
    } catch {
      return '';
    }
  }

  /** True if path exists as a blob at ref. */
  async pathExistsAt(ref: string, filePath: string): Promise<boolean> {
    try {
      await this.git.raw(['cat-file', '-e', `${ref}:${filePath}`]);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Write or delete a worktree path to match `sourceRef` in this repo
   * (same-repo fast path via git restore).
   */
  async restoreWorktreeFrom(sourceRef: string, filePath: string): Promise<void> {
    const exists = await this.pathExistsAt(sourceRef, filePath);
    if (!exists) {
      // File gone on source → remove from worktree if present.
      const abs = path.join(this.workspaceRoot, filePath);
      if (fs.existsSync(abs)) {
        fs.unlinkSync(abs);
      }
      return;
    }
    await this.git.raw(['restore', '--source', sourceRef, '--worktree', '--', filePath]);
  }

  /**
   * Copy blob bytes from this repo's ref into an absolute worktree path
   * (cross-repo discard: Target 1 → Target 2 disk).
   */
  async writeBlobToAbsolutePath(
    ref: string,
    filePath: string,
    destAbsPath: string
  ): Promise<void> {
    const content = await this.git.show([`${ref}:${filePath}`]);
    const dir = path.dirname(destAbsPath);
    fs.mkdirSync(dir, { recursive: true });
    // Buffer preserves binary-ish content better than string for most text; git show is utf8 for text.
    fs.writeFileSync(destAbsPath, content, 'utf8');
  }

  /**
   * Map path → blob id at a tree-ish (one git call).
   * Format: `git ls-tree -r <ref>` → `mode type hash\tpath`.
   */
  async listTreeBlobs(ref: string): Promise<Map<string, string>> {
    const raw = await this.git.raw(['ls-tree', '-r', ref]);
    const map = new Map<string, string>();
    for (const line of raw.split('\n')) {
      const trimmed = line.trimEnd();
      if (!trimmed) {
        continue;
      }
      // 100644 blob <hash>\t<path>  (hash may be space-padded from older git)
      const tab = trimmed.indexOf('\t');
      if (tab < 0) {
        continue;
      }
      const meta = trimmed.slice(0, tab).trim().split(/\s+/);
      const filePath = trimmed.slice(tab + 1);
      const hash = meta[2];
      if (filePath && hash) {
        map.set(filePath, hash);
      }
    }
    return map;
  }

  /**
   * Compare two trees that may live in different repositories.
   * Status is from target1 → target2 (deleted = only in 1, added = only in 2).
   * Line counts are omitted for cross-repo (0/0); same-repo uses getDiffFiles.
   */
  static async compareTrees(
    root1: string,
    ref1: string,
    root2: string,
    ref2: string
  ): Promise<DiffResult> {
    const r1 = normalizeRoot(root1);
    const r2 = normalizeRoot(root2);
    if (pathsEqual(r1, r2)) {
      return new GitService(r1).getDiffFiles(ref1, ref2);
    }

    const g1 = new GitService(r1);
    const g2 = new GitService(r2);
    const [map1, map2] = await Promise.all([
      g1.listTreeBlobs(ref1),
      g2.listTreeBlobs(ref2),
    ]);

    const all = new Set<string>([...map1.keys(), ...map2.keys()]);
    const files: DiffFile[] = [];

    for (const filePath of [...all].sort()) {
      const id1 = map1.get(filePath);
      const id2 = map2.get(filePath);
      if (id1 && !id2) {
        files.push({ path: filePath, additions: 0, deletions: 0, status: 'deleted' });
      } else if (!id1 && id2) {
        files.push({ path: filePath, additions: 0, deletions: 0, status: 'added' });
      } else if (id1 && id2 && id1 !== id2) {
        files.push({ path: filePath, additions: 0, deletions: 0, status: 'modified' });
      }
    }

    return { files, totalAdditions: 0, totalDeletions: 0 };
  }

  /**
   * Build unique compare endpoints for workspace repos.
   * HEAD (current branch) first per folder, then other local branches.
   * D1/D2 via listWorkspaceRepos + id set; D4 no remotes.
   */
  static async buildEndpoints(repos: readonly RepoInfo[]): Promise<CompareEndpoint[]> {
    const sorted = [...repos].sort((a, b) => {
      const sa = versionFolderScore(a.name);
      const sb = versionFolderScore(b.name);
      if (sa !== sb) {
        return sa - sb;
      }
      return a.name.localeCompare(b.name);
    });

    const results = await Promise.all(
      sorted.map(async (repo): Promise<CompareEndpoint[]> => {
        const folder = repo.name || path.basename(repo.root) || repo.root;
        const root = normalizeRoot(repo.root);
        try {
          const git = new GitService(root);
          const branches = await git.getLocalBranches();
          const out: CompareEndpoint[] = [];
          const seenRef = new Set<string>();
          const current = branches.current;

          const push = (ref: string, isHead: boolean) => {
            if (!ref || seenRef.has(ref)) {
              return;
            }
            seenRef.add(ref);
            const label = isHead ? `${folder} · ${ref} (HEAD)` : `${folder} · ${ref}`;
            out.push({
              id: makeEndpointId(root, ref),
              root,
              ref,
              label,
              folder,
              isHead,
            });
          };

          if (current) {
            push(current, true);
          } else {
            push('HEAD', true);
          }
          for (const b of branches.local) {
            if (b !== current) {
              push(b, false);
            }
          }
          return out;
        } catch {
          return [
            {
              id: makeEndpointId(root, 'HEAD'),
              root,
              ref: 'HEAD',
              label: `${folder} · HEAD`,
              folder,
              isHead: true,
            },
          ];
        }
      })
    );

    const endpoints: CompareEndpoint[] = [];
    const seenId = new Set<string>();
    for (const group of results) {
      for (const ep of group) {
        if (seenId.has(ep.id)) {
          continue;
        }
        seenId.add(ep.id);
        endpoints.push(ep);
      }
    }
    return endpoints;
  }

  /**
   * List git repos among workspace folders (one entry per unique toplevel).
   * Probes folders in parallel — no persistent index; each open re-scans.
   */
  static async listWorkspaceRepos(
    folders: readonly { name: string; path: string }[]
  ): Promise<RepoInfo[]> {
    const probes = folders.map(async (folder): Promise<RepoInfo | null> => {
      if (!folder.path || !fs.existsSync(folder.path)) {
        return null;
      }
      // Fast reject: no .git here and not worth spawning git for empty dirs.
      // (Submodule/worktree edge cases still go through git below.)
      const gitMarker = path.join(folder.path, '.git');
      const hasLocalGit = fs.existsSync(gitMarker);
      try {
        const git = simpleGit(folder.path);
        if (!hasLocalGit) {
          const isRepo = await git.checkIsRepo();
          if (!isRepo) {
            return null;
          }
        }
        const root = normalizeRoot((await git.revparse(['--show-toplevel'])).trim());
        if (!root) {
          return null;
        }
        return {
          name: folder.name,
          root,
          folderPath: normalizeRoot(folder.path) || folder.path,
        };
      } catch {
        return null;
      }
    });

    const found = await Promise.all(probes);
    const out: RepoInfo[] = [];
    const seen = new Set<string>();
    for (const info of found) {
      if (!info) {
        continue;
      }
      const key = PATH_CASE_INSENSITIVE ? info.root.toLowerCase() : info.root;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      out.push(info);
    }
    return out;
  }

  private async readNameStatus(
    base: string,
    target: string
  ): Promise<Map<string, { status: FileStatus; oldPath?: string }>> {
    const raw = await this.git.raw(['diff', '--name-status', '-M', '-C', base, target]);
    const map = new Map<string, { status: FileStatus; oldPath?: string }>();

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parts = trimmed.split('\t');
      const code = parts[0] ?? '';
      const letter = code.charAt(0);
      const status = STATUS_MAP[letter] ?? 'unknown';

      if ((letter === 'R' || letter === 'C') && parts.length >= 3) {
        map.set(parts[2], { status, oldPath: parts[1] });
      } else if (parts.length >= 2) {
        map.set(parts[1], { status });
      }
    }

    return map;
  }

  private async readNumstat(
    base: string,
    target: string
  ): Promise<Map<string, { additions: number; deletions: number }>> {
    const raw = await this.git.raw(['diff', '--numstat', '-M', '-C', base, target]);
    const map = new Map<string, { additions: number; deletions: number }>();

    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      const parts = trimmed.split('\t');
      if (parts.length < 3) {
        continue;
      }
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10) || 0;
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10) || 0;
      const filePath = parts.length >= 4 ? parts[parts.length - 1] : parts[2];
      map.set(filePath, { additions, deletions });
    }

    return map;
  }

  private formatDate(dateStr: string): string {
    if (!dateStr) {
      return '';
    }
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return dateStr;
    }
    const p = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`;
  }
}
