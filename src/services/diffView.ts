/**
 * Compare-window prefs for diffs this extension opens.
 * VS Code owns the editor; we remember the toggles and apply them on open.
 */

export type DiffViewPrefs = {
  wordWrap: boolean;
  ignoreTrimWhitespace: boolean;
  sideBySide: boolean;
  collapseUnchanged: boolean;
  pinTab: boolean;
  showMoves: boolean;
};

export const DEFAULT_DIFF_VIEW: DiffViewPrefs = {
  wordWrap: true,
  ignoreTrimWhitespace: false,
  sideBySide: true,
  collapseUnchanged: false,
  pinTab: true,
  showMoves: true,
};

export function normalizeDiffView(raw: unknown): DiffViewPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    wordWrap: o.wordWrap !== false,
    ignoreTrimWhitespace: o.ignoreTrimWhitespace === true,
    sideBySide: o.sideBySide !== false,
    collapseUnchanged: o.collapseUnchanged === true,
    pinTab: o.pinTab !== false,
    showMoves: o.showMoves !== false,
  };
}

/** Next or previous path in the current compare list. Empty at the ends. */
export function neighborPath(
  paths: readonly string[],
  current: string,
  delta: 1 | -1
): string {
  if (!paths.length) {
    return '';
  }
  const i = paths.indexOf(current);
  if (i < 0) {
    return (delta > 0 ? paths[0] : paths[paths.length - 1]) || '';
  }
  const n = i + delta;
  if (n < 0 || n >= paths.length) {
    return '';
  }
  return paths[n] || '';
}

export function diffViewScript(): string {
  return `const DEFAULT_DIFF_VIEW = Object.freeze(${JSON.stringify(DEFAULT_DIFF_VIEW)});
function normalizeDiffView(raw) {
  const o = raw && typeof raw === 'object' ? raw : {};
  return {
    wordWrap: o.wordWrap !== false,
    ignoreTrimWhitespace: o.ignoreTrimWhitespace === true,
    sideBySide: o.sideBySide !== false,
    collapseUnchanged: o.collapseUnchanged === true,
    pinTab: o.pinTab !== false,
    showMoves: o.showMoves !== false
  };
}
function neighborPath(paths, current, delta) {
  if (!paths || !paths.length) {
    return '';
  }
  const i = paths.indexOf(current);
  if (i < 0) {
    return (delta > 0 ? paths[0] : paths[paths.length - 1]) || '';
  }
  const n = i + delta;
  if (n < 0 || n >= paths.length) {
    return '';
  }
  return paths[n];
}`;
}
