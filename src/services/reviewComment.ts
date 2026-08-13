/**
 * One review note from a diff selection, written as JSON for an agent.
 */

export type ReviewCompare = {
  root1: string;
  ref1: string;
  root2: string;
  ref2: string;
};

export type ReviewComment = {
  id: string;
  createdAt: string;
  file: string;
  side: 'left' | 'right';
  root: string;
  ref: string;
  startLine: number;
  endLine: number;
  startCharacter: number;
  endCharacter: number;
  selectedText: string;
  comment: string;
  compare?: ReviewCompare;
};

export function makeReviewComment(input: {
  file: string;
  side: 'left' | 'right';
  root: string;
  ref: string;
  startLine: number;
  endLine: number;
  startCharacter: number;
  endCharacter: number;
  selectedText: string;
  comment: string;
  compare?: ReviewCompare;
  now?: Date;
}): ReviewComment {
  const now = input.now ?? new Date();
  const createdAt = now.toISOString();
  const entry: ReviewComment = {
    id: createdAt.replace(/[.:]/g, '-'),
    createdAt,
    file: input.file,
    side: input.side,
    root: input.root,
    ref: input.ref,
    startLine: input.startLine,
    endLine: input.endLine,
    startCharacter: input.startCharacter,
    endCharacter: input.endCharacter,
    selectedText: input.selectedText,
    comment: input.comment.trim(),
  };
  if (input.compare) {
    entry.compare = input.compare;
  }
  return entry;
}

export function commentFileName(c: ReviewComment): string {
  const slug = (c.file || 'file')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    ?.replace(/[^\w.-]+/g, '-') || 'file';
  return `${c.id}-${slug}.json`;
}

export function mergeReviewIndex(
  existing: unknown,
  next: ReviewComment
): { comments: ReviewComment[] } {
  const comments = Array.isArray((existing as { comments?: unknown })?.comments)
    ? ([...(existing as { comments: ReviewComment[] }).comments] as ReviewComment[])
    : [];
  comments.push(next);
  return { comments };
}
