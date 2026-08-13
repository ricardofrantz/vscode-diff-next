import * as path from 'path';
import * as vscode from 'vscode';
import { parseBlobUri } from '../host/DiffHost';
import {
  commentFileName,
  makeReviewComment,
  mergeReviewIndex,
  type ReviewCompare,
} from '../services/reviewComment';

const LAST_TARGETS_KEY = 'diff-next.lastTargets';

let lastTextEditor: vscode.TextEditor | undefined;

/** Remember the last compare/text editor so a sidebar click can still comment. */
export function rememberTextEditor(editor: vscode.TextEditor | undefined): void {
  if (!editor) {
    return;
  }
  if (editor.document.uri.scheme === 'output' || editor.document.uri.scheme === 'debug') {
    return;
  }
  lastTextEditor = editor;
}

function editorForComment(): vscode.TextEditor | undefined {
  const active = vscode.window.activeTextEditor;
  if (active && !active.selection.isEmpty) {
    return active;
  }
  if (lastTextEditor && !lastTextEditor.selection.isEmpty) {
    return lastTextEditor;
  }
  return active ?? lastTextEditor;
}

/**
 * Capture the current editor selection plus a typed note, and write JSON
 * the user can hand to an agent.
 */
export async function commentSelection(
  context: vscode.ExtensionContext
): Promise<void> {
  const editor = editorForComment();
  if (!editor || editor.selection.isEmpty) {
    void vscode.window.showWarningMessage(
      'Select the text you want to comment on in the compare, then run this again.'
    );
    return;
  }

  const note = await vscode.window.showInputBox({
    prompt: 'Comment for the agent',
    placeHolder: 'What should be fixed here?',
    ignoreFocusOut: true,
  });
  if (note === undefined) {
    return;
  }
  if (!note.trim()) {
    void vscode.window.showWarningMessage('Comment was empty, so nothing was saved.');
    return;
  }

  const loc = locateSelection(editor, context);
  if (!loc) {
    void vscode.window.showWarningMessage(
      'Open a folder or a vscode-diff Next compare, then try the comment again.'
    );
    return;
  }

  const start = editor.selection.start;
  const end = editor.selection.end;
  const entry = makeReviewComment({
    file: loc.file,
    side: loc.side,
    root: loc.root,
    ref: loc.ref,
    startLine: start.line + 1,
    endLine: end.line + 1,
    startCharacter: start.character,
    endCharacter: end.character,
    selectedText: editor.document.getText(editor.selection),
    comment: note,
    ...(loc.compare ? { compare: loc.compare } : {}),
  });

  const outDir = vscode.Uri.file(path.join(loc.root, '.diff-next', 'comments'));
  const indexUri = vscode.Uri.file(path.join(loc.root, '.diff-next', 'review.json'));
  const commentUri = vscode.Uri.joinPath(outDir, commentFileName(entry));

  try {
    await vscode.workspace.fs.createDirectory(outDir);
    const body = Buffer.from(`${JSON.stringify(entry, null, 2)}\n`, 'utf8');
    await vscode.workspace.fs.writeFile(commentUri, body);

    const existing = await readJson(indexUri);
    const index = mergeReviewIndex(existing, entry);
    await vscode.workspace.fs.writeFile(
      indexUri,
      Buffer.from(`${JSON.stringify(index, null, 2)}\n`, 'utf8')
    );
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not save the comment: ${error}`);
    return;
  }

  const pick = await vscode.window.showInformationMessage(
    `Saved comment on ${entry.file}:${entry.startLine}.`,
    'Open for agent'
  );
  if (pick === 'Open for agent') {
    const doc = await vscode.workspace.openTextDocument(indexUri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

function locateSelection(
  editor: vscode.TextEditor,
  context: vscode.ExtensionContext
): {
  file: string;
  side: 'left' | 'right';
  root: string;
  ref: string;
  compare?: ReviewCompare;
} | null {
  const compare = readCompare(context);
  const side = sideOfEditor(editor);
  const blob = parseBlobUri(editor.document.uri);
  if (blob) {
    return {
      file: blob.filePath,
      side,
      root: blob.root,
      ref: blob.ref,
      ...(compare ? { compare } : {}),
    };
  }
  if (editor.document.uri.scheme === 'file') {
    const abs = editor.document.uri.fsPath;
    const roots = [compare?.root2, compare?.root1, ...(vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath)].filter(
      Boolean
    ) as string[];
    for (const root of roots) {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      if (rel && !rel.startsWith('..') && !path.isAbsolute(rel)) {
        return {
          file: rel,
          side,
          root,
          ref: root === compare?.root1 ? compare.ref1 : compare?.root2 === root ? compare.ref2 : 'HEAD',
          ...(compare ? { compare } : {}),
        };
      }
    }
    const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (folder) {
      return {
        file: path.basename(abs),
        side,
        root: folder,
        ref: 'HEAD',
        ...(compare ? { compare } : {}),
      };
    }
  }
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (folder) {
    return {
      file: path.basename(editor.document.uri.path) || 'selection',
      side,
      root: folder,
      ref: 'HEAD',
      ...(compare ? { compare } : {}),
    };
  }
  return null;
}

function sideOfEditor(editor: vscode.TextEditor): 'left' | 'right' {
  const tab = vscode.window.tabGroups.activeTabGroup.activeTab;
  const input = tab?.input;
  if (input instanceof vscode.TabInputTextDiff) {
    if (editor.document.uri.toString() === input.original.toString()) {
      return 'left';
    }
    if (editor.document.uri.toString() === input.modified.toString()) {
      return 'right';
    }
  }
  return 'right';
}

function readCompare(context: vscode.ExtensionContext): ReviewCompare | undefined {
  const raw = context.workspaceState.get<ReviewCompare>(LAST_TARGETS_KEY);
  if (!raw || !raw.root1 || !raw.root2) {
    return undefined;
  }
  return {
    root1: raw.root1,
    ref1: raw.ref1 || '',
    root2: raw.root2,
    ref2: raw.ref2 || '',
  };
}

async function readJson(uri: vscode.Uri): Promise<unknown> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(buf).toString('utf8'));
  } catch {
    return undefined;
  }
}
