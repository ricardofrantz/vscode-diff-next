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
  pinTab: false,
  showMoves: false,
};

export function normalizeDiffView(raw: unknown): DiffViewPrefs {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const has = (k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);
  return {
    wordWrap: has('wordWrap') ? o.wordWrap === true : DEFAULT_DIFF_VIEW.wordWrap,
    ignoreTrimWhitespace: o.ignoreTrimWhitespace === true,
    sideBySide: has('sideBySide') ? o.sideBySide === true : DEFAULT_DIFF_VIEW.sideBySide,
    collapseUnchanged: o.collapseUnchanged === true,
    pinTab: o.pinTab === true,
    showMoves: o.showMoves === true,
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
  if (!current) {
    return (delta > 0 ? paths[0] : paths[paths.length - 1]) || '';
  }
  if (i < 0) {
    return '';
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
    wordWrap: Object.prototype.hasOwnProperty.call(o, 'wordWrap') ? o.wordWrap === true : true,
    ignoreTrimWhitespace: o.ignoreTrimWhitespace === true,
    sideBySide: Object.prototype.hasOwnProperty.call(o, 'sideBySide') ? o.sideBySide === true : true,
    collapseUnchanged: o.collapseUnchanged === true,
    pinTab: o.pinTab === true,
    showMoves: o.showMoves === true
  };
}
function neighborPath(paths, current, delta) {
  if (!paths || !paths.length) {
    return '';
  }
  const i = paths.indexOf(current);
  if (!current) {
    return (delta > 0 ? paths[0] : paths[paths.length - 1]) || '';
  }
  if (i < 0) {
    return '';
  }
  const n = i + delta;
  if (n < 0 || n >= paths.length) {
    return '';
  }
  return paths[n] || '';
}`;
}
