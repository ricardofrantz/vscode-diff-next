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
  /** Typed by the user. Empty means the tab shows the folder · folder label. */
  name?: string;
};

export type CloseMode = 'one' | 'others' | 'right';

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

export function uniqueFolders(
  endpoints: readonly PickerEndpoint[],
  caseInsensitive = true
): PickerFolder[] {
  const seen = new Map<string, PickerFolder>();
  for (const ep of endpoints || []) {
    const root = normalizePickerRoot(ep.root);
    if (!root) {
      continue;
    }
    const key = caseInsensitive ? root.toLowerCase() : root;
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

/** A tab keeps its own name; without one it falls back to folder · folder. */
export function sessionDisplayName(name: string, folder1: string, folder2: string): string {
  const custom = String(name || '').trim();
  return custom || sessionTabLabel(folder1, folder2);
}

/** Drag or Ctrl+Shift+Arrow. Out of range or a no-op returns the list unchanged. */
export function moveSession<T>(sessions: readonly T[], from: number, to: number): T[] {
  const list = [...(sessions || [])];
  if (from < 0 || from >= list.length || to < 0 || to >= list.length || from === to) {
    return list;
  }
  const [item] = list.splice(from, 1);
  list.splice(to, 0, item as T);
  return list;
}

/** The copy lands right after its source and carries both endpoints. */
export function duplicateSession<T extends { id: string; name?: string }>(
  sessions: readonly T[],
  id: string,
  newId: string
): T[] {
  const list = [...(sessions || [])];
  const index = list.findIndex((s) => s.id === id);
  const source = list[index];
  if (index < 0 || !source || !newId) {
    return list;
  }
  const named = String(source.name || '').trim();
  const copy = { ...source, id: newId, ...(named ? { name: `${named} (2)` } : {}) } as T;
  list.splice(index + 1, 0, copy);
  return list;
}

/** Close one tab, every other tab, or everything to its right. Never empties. */
export function closeSessions<T extends { id: string }>(
  sessions: readonly T[],
  activeId: string,
  mode: CloseMode,
  id: string
): { sessions: T[]; activeId: string } {
  const list = [...(sessions || [])];
  const index = list.findIndex((s) => s.id === id);
  if (index < 0) {
    return { sessions: list, activeId };
  }
  let kept: T[];
  if (mode === 'others') {
    kept = [list[index] as T];
  } else if (mode === 'right') {
    kept = list.slice(0, index + 1);
  } else {
    kept = list.filter((s) => s.id !== id);
  }
  if (!kept.length || kept.length === list.length) {
    return { sessions: list, activeId };
  }
  if (kept.some((s) => s.id === activeId)) {
    return { sessions: kept, activeId };
  }
  const next = mode === 'one' ? kept[Math.min(index, kept.length - 1)] : kept[kept.length - 1];
  return { sessions: kept, activeId: next ? next.id : activeId };
}

/**
 * Which folder the picker opens on: this side's own folder, else the folder the
 * other side is already using, else the last folder touched. Empty means the
 * folder list. An explicit choice on this side is never overridden.
 */
export function pickerStartRoot(
  side: number,
  root1: string,
  root2: string,
  lastFolderRoot: string
): string {
  const own = side === 1 ? root1 : root2;
  const peer = side === 1 ? root2 : root1;
  return (
    normalizePickerRoot(own) ||
    normalizePickerRoot(peer) ||
    normalizePickerRoot(lastFolderRoot) ||
    ''
  );
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
      ...(String(s.name || '').trim() ? { name: String(s.name).trim() } : {}),
    }));
    const first = sessions[0];
    const activeId =
      (saved.activeId && sessions.some((s) => s.id === saved.activeId) && saved.activeId) ||
      first!.id;
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
${sessionDisplayName.toString()}
${moveSession.toString()}
${duplicateSession.toString()}
${closeSessions.toString()}
${pickerStartRoot.toString()}
${migrateSessions.toString()}
const EndpointPicker = Object.freeze({
  uniqueFolders,
  filterByQuery,
  branchesForFolder,
  sessionTabLabel,
  sessionDisplayName,
  canCloseSession,
  moveSession,
  duplicateSession,
  closeSessions,
  pickerStartRoot,
  migrateSessions,
  normalizePickerRoot,
  samePickerRoot
});`;
}
