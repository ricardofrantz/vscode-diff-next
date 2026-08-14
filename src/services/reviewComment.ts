/**
 * Slim revision notes for Claude / Codex.
 * `myfile.md` → `myfile-rev.json` beside it, created on the first save.
 */

import * as path from 'path';

export const AGENT_TAGS = ['fix', 'improve', 'explain', 're-check', 'discuss'] as const;

export type AgentTag = (typeof AGENT_TAGS)[number];

export type AgentComment = {
  selected_text: string;
  range: string;
  tag: AgentTag;
  comment: string;
};

export function isAgentTag(value: string): value is AgentTag {
  return (AGENT_TAGS as readonly string[]).includes(value);
}

/** Inclusive 1-based lines. One line is `"14-14"`; a span is `"14-21"`. */
export function commentRange(startLine: number, endLine: number): string {
  const start = Math.min(startLine, endLine);
  const end = Math.max(startLine, endLine);
  return `${start}-${end}`;
}

/** Parse `"14-21"` back to inclusive 1-based lines. */
export function parseCommentRange(range: string): { startLine: number; endLine: number } | undefined {
  const match = /^(\d+)-(\d+)$/.exec(range);
  if (!match) {
    return undefined;
  }
  const startLine = Number(match[1]);
  const endLine = Number(match[2]);
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine) || startLine < 1 || endLine < 1) {
    return undefined;
  }
  return {
    startLine: Math.min(startLine, endLine),
    endLine: Math.max(startLine, endLine),
  };
}

export function makeAgentComment(input: {
  selectedText: string;
  range: string;
  tag: AgentTag;
  comment: string;
}): AgentComment {
  return {
    selected_text: input.selectedText,
    range: input.range,
    tag: input.tag,
    comment: input.comment.trim(),
  };
}

/** `src/myfile.md` → `src/myfile-rev.json` */
export function revisionFilePath(filePath: string): string {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const dot = base.lastIndexOf('.');
  const stem = dot > 0 ? base.slice(0, dot) : base;
  return path.join(dir, `${stem}-rev.json`);
}

/** First save is `[note]`. Later saves append. Always an array. */
export function mergeAgentComments(existing: unknown, next: AgentComment): AgentComment[] {
  return [...readAgentComments(existing), next];
}

/** Drop one saved note. Empty array means the revision file can go. */
export function removeAgentComment(existing: unknown, entry: AgentComment): AgentComment[] {
  return readAgentComments(existing).filter((item) => !sameComment(item, entry));
}

export function readAgentComments(existing: unknown): AgentComment[] {
  if (Array.isArray(existing)) {
    return existing.filter(isAgentComment);
  }
  if (isAgentComment(existing)) {
    return [existing];
  }
  return [];
}

function sameComment(a: AgentComment, b: AgentComment): boolean {
  return (
    a.selected_text === b.selected_text &&
    a.range === b.range &&
    a.tag === b.tag &&
    a.comment === b.comment
  );
}

function isAgentComment(value: unknown): value is AgentComment {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const entry = value as {
    selected_text?: unknown;
    range?: unknown;
    tag?: unknown;
    comment?: unknown;
  };
  return (
    typeof entry.selected_text === 'string' &&
    typeof entry.range === 'string' &&
    typeof entry.tag === 'string' &&
    isAgentTag(entry.tag) &&
    typeof entry.comment === 'string'
  );
}
