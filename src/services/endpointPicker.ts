/**
 * Folder-then-branch grouping for compare endpoints.
 *
 * The webview cannot import this module (inline script, strict CSP). DiffHost
 * injects pickerScript() so the panel and the smoke tests share one definition.
 */

export type PickerEndpoint = {
  id: string;
  root: string;
  ref: string;
  folder: string;
  label: string;
  isHead?: boolean;
};

export type PickerFolder = {
  folder: string;
  root: string;
  branchCount: number;
};

export type SavedPair = {
  id: string;
  root1: string;
  ref1: string;
  root2: string;
  ref2: string;
};

export type SavedSessions = {
  sessions: SavedPair[];
  activeId: string;
};

export function normalizePickerRoot(p: string): string {
  if (!p) {
    return '';
  }
  return String(p).replace(/\\/g, '/').replace(/\/+$/, '');
}

export function samePickerRoot(a: string, b: string, caseInsensitive: boolean): boolean {
  const na = normalizePickerRoot(a);
  const nb = normalizePickerRoot(b);
  if (!na || !nb) {
    return false;
  }
  return caseInsensitive ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

export function uniqueFolders(endpoints: readonly PickerEndpoint[]): PickerFolder[] {
  const seen = new Map<string, PickerFolder>();
  for (const ep of endpoints || []) {
    const root = normalizePickerRoot(ep.root);
    if (!root) {
      continue;
    }
    const key = root.toLowerCase();
    const hit = seen.get(key);
    if (hit) {
      hit.branchCount += 1;
      continue;
    }
    seen.set(key, {
      folder: ep.folder || root.split('/').pop() || root,
      root,
      branchCount: 1,
    });
  }
  return [...seen.values()];
}

export function filterByQuery<T>(
  items: readonly T[],
  query: string,
  textOf: (item: T) => string
): T[] {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const list = [...(items || [])];
  if (!q) {
    return list;
  }
  return list.filter((item) => textOf(item).toLowerCase().includes(q));
}

export function branchesForFolder(
  endpoints: readonly PickerEndpoint[],
  folderRoot: string,
  excludeId: string,
  caseInsensitive: boolean
): PickerEndpoint[] {
  const root = normalizePickerRoot(folderRoot);
  return (endpoints || []).filter((ep) => {
    if (excludeId && ep.id === excludeId) {
      return false;
    }
    return samePickerRoot(ep.root, root, caseInsensitive);
  });
}

export function sessionTabLabel(folder1: string, folder2: string): string {
  const a = String(folder1 || '').trim();
  const b = String(folder2 || '').trim();
  if (!a && !b) {
    return 'New compare';
  }
  if (!b || a === b) {
    return a || b;
  }
  if (!a) {
    return b;
  }
  return `${a} · ${b}`;
}

export function canCloseSession(sessionCount: number): boolean {
  return sessionCount > 1;
}

export function migrateSessions(
  saved: SavedSessions | undefined,
  lastTargets:
    | { root1: string; ref1: string; root2: string; ref2: string }
    | undefined
): SavedSessions {
  if (saved && Array.isArray(saved.sessions) && saved.sessions.length) {
    const sessions = saved.sessions.map((s, i) => ({
      id: s.id || `s${i + 1}`,
      root1: s.root1 || '',
      ref1: s.ref1 || '',
      root2: s.root2 || '',
      ref2: s.ref2 || '',
    }));
    const first = sessions[0];
    if (!first) {
      return {
        sessions: [{ id: 's1', root1: '', ref1: '', root2: '', ref2: '' }],
        activeId: 's1',
      };
    }
    const activeId =
      (saved.activeId && sessions.some((s) => s.id === saved.activeId) && saved.activeId) ||
      first.id;
    return { sessions, activeId };
  }
  if (lastTargets && lastTargets.root1 && lastTargets.root2) {
    return {
      sessions: [
        {
          id: 'migrated',
          root1: lastTargets.root1,
          ref1: lastTargets.ref1 || '',
          root2: lastTargets.root2,
          ref2: lastTargets.ref2 || '',
        },
      ],
      activeId: 'migrated',
    };
  }
  return {
    sessions: [{ id: 's1', root1: '', ref1: '', root2: '', ref2: '' }],
    activeId: 's1',
  };
}

/**
 * Function bodies as a script fragment for the webview.
 * JSON cannot carry functions; toString() of these closures-free helpers is
 * the same source the smoke tests execute.
 */
export function pickerScript(): string {
  return `${normalizePickerRoot.toString()}
${samePickerRoot.toString()}
${uniqueFolders.toString()}
${filterByQuery.toString()}
${branchesForFolder.toString()}
${sessionTabLabel.toString()}
${canCloseSession.toString()}
${migrateSessions.toString()}
const EndpointPicker = Object.freeze({
  uniqueFolders,
  filterByQuery,
  branchesForFolder,
  sessionTabLabel,
  canCloseSession,
  migrateSessions,
  normalizePickerRoot,
  samePickerRoot
});`;
}
