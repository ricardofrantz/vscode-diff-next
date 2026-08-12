/**
 * What a changed file is, in one place.
 *
 * This table used to be four: the status union and git's letter codes lived in
 * gitService, while the webview kept its own letter map, its own group order
 * and its own group labels, and the CSS kept a class per status. Nothing tied
 * them together, so a status added on one side simply never appeared on the
 * other, and the behaviour that follows from a status — "added means the
 * discard button deletes from disk", "deleted means there is no file on disk
 * to open", "renamed means the left side uses the old path" — was spelled out
 * again at every call site.
 *
 * The order of this array is the order the groups appear in the panel. The
 * webview does not restate any of it: DiffHost injects this table into the
 * page, so both sides read the same list.
 */
export interface FileStatusInfo {
  /** Status name used in messages, CSS classes and the diff payload. */
  value: FileStatus;
  /** Letter git reports in `--name-status`, or null when git never emits it. */
  gitCode: string | null;
  /** Letter shown in the file row. */
  letter: string;
  /** Group heading in the panel. */
  label: string;
  /** False when the file is gone from Target 2, so there is nothing to open. */
  presentInTarget2: boolean;
  /** True when the file is new in Target 2, so discarding it means deleting. */
  addedInTarget2: boolean;
  /** True when Target 1's copy lives at `oldPath` rather than `path`. */
  carriesOldPath: boolean;
}

export type FileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'copied'
  | 'typechange'
  | 'unknown';

export const FILE_STATUSES: readonly FileStatusInfo[] = Object.freeze([
  {
    value: 'modified',
    gitCode: 'M',
    letter: 'M',
    label: 'Modified',
    presentInTarget2: true,
    addedInTarget2: false,
    carriesOldPath: false,
  },
  {
    value: 'added',
    gitCode: 'A',
    letter: 'U',
    label: 'New (U)',
    presentInTarget2: true,
    addedInTarget2: true,
    carriesOldPath: false,
  },
  {
    value: 'deleted',
    gitCode: 'D',
    letter: 'D',
    label: 'Deleted',
    presentInTarget2: false,
    addedInTarget2: false,
    carriesOldPath: false,
  },
  {
    value: 'renamed',
    gitCode: 'R',
    letter: 'R',
    label: 'Renamed',
    presentInTarget2: true,
    addedInTarget2: false,
    carriesOldPath: true,
  },
  {
    value: 'copied',
    gitCode: 'C',
    letter: 'C',
    label: 'Copied',
    presentInTarget2: true,
    addedInTarget2: false,
    carriesOldPath: true,
  },
  {
    value: 'typechange',
    gitCode: 'T',
    letter: 'T',
    label: 'Type change',
    presentInTarget2: true,
    addedInTarget2: false,
    carriesOldPath: false,
  },
  {
    // Git has no code for this: it is what an unrecognised record falls back to.
    value: 'unknown',
    gitCode: null,
    letter: '?',
    label: 'Other',
    presentInTarget2: true,
    addedInTarget2: false,
    carriesOldPath: false,
  },
] as const satisfies readonly FileStatusInfo[]);

const BY_VALUE = new Map(FILE_STATUSES.map((info) => [info.value, info]));

/** Git's `--name-status` letter → status name. */
export const STATUS_MAP: Record<string, FileStatus> = Object.freeze(
  Object.fromEntries(
    FILE_STATUSES.filter((info) => info.gitCode).map((info) => [
      info.gitCode as string,
      info.value,
    ])
  )
);

/** Everything known about a status; anything unrecognised reads as 'unknown'. */
export function statusInfo(status: string): FileStatusInfo {
  return BY_VALUE.get(status as FileStatus) ?? BY_VALUE.get('unknown')!;
}

/** Position of a status in the panel's group order. */
export function statusRank(status: string): number {
  const index = FILE_STATUSES.findIndex((info) => info.value === status);
  return index < 0 ? FILE_STATUSES.length : index;
}

/**
 * The table as a script fragment for the webview.
 *
 * The panel is an inline script under a strict CSP, so it cannot import this
 * module. Injecting the table keeps it a copy of the same definition rather
 * than a second one someone has to remember to update.
 */
export function statusTableScript(): string {
  // JSON, not a JS literal: nothing here can execute in the page.
  return `const FILE_STATUSES = Object.freeze(${JSON.stringify(FILE_STATUSES)});`;
}
