import * as path from 'path';
import * as vscode from 'vscode';
import { GIT_SHOW_SCHEME, parseBlobUri } from '../host/DiffHost';
import {
  AGENT_TAGS,
  commentRange,
  isAgentTag,
  makeAgentComment,
  mergeAgentComments,
  parseCommentRange,
  readAgentComments,
  removeAgentComment,
  revisionFilePath,
  type AgentComment,
  type AgentTag,
} from '../services/reviewComment';

const NOTE_CONTEXT = 'diffNext.noteDraft';
const NOTE_MAX = 2000;

/** Amber marks a saved note. It has to stay warm on top of the diff's green. */
const AMBER_WASH_DARK = 'rgba(227, 178, 60, 0.30)';
const AMBER_WASH_LIGHT = 'rgba(227, 178, 60, 0.42)';
const AMBER_INK_DARK = '#e3b23c';
const AMBER_INK_LIGHT = '#8a6410';

const DEFAULT_TAG: AgentTag = 'fix';

let lastTextEditor: vscode.TextEditor | undefined;

type Draft = {
  uri: vscode.Uri;
  range: vscode.Range;
  note: string;
  tag: AgentTag;
};

type SavedDoc = {
  revision: vscode.Uri;
  entries: AgentComment[];
};

type DeleteArg = {
  uri: string;
  entry: AgentComment;
};

/** Remember the last compare/text editor so a sidebar click can still comment. */
function rememberTextEditor(editor: vscode.TextEditor | undefined): void {
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
 * Layout A: a strip on the selection. Save, Delete, and tags sit on one
 * row above the note; the note itself trails the first selected line.
 * Typing goes into the note while the caret stays on that range, and the
 * keyboard returns to the editor the moment it leaves.
 */
export function registerReviewComments(): vscode.Disposable {
  rememberTextEditor(vscode.window.activeTextEditor);
  const review = new ReviewComments();
  return vscode.Disposable.from(
    review,
    vscode.commands.registerCommand('diff-next.commentSelection', () => review.commentSelection()),
    vscode.commands.registerCommand('diff-next.saveComment', () => review.saveComment()),
    vscode.commands.registerCommand('diff-next.deleteComment', (arg: unknown) =>
      review.deleteComment(arg)
    ),
    vscode.commands.registerCommand('diff-next.pickCommentTag', (tag: unknown) => review.pickTag(tag)),
    vscode.window.onDidChangeActiveTextEditor((editor) => {
      rememberTextEditor(editor);
      if (editor) {
        void review.ensureSaved(editor.document);
      }
      review.onFocusMoved();
    }),
    vscode.window.onDidChangeTextEditorSelection((event) => {
      review.onSelectionChanged(event);
    }),
    vscode.workspace.onDidOpenTextDocument((document) => {
      void review.ensureSaved(document);
    })
  );
}

class ReviewComments implements vscode.Disposable {
  private readonly lens: SelectionCommentLens;
  private readonly wash: vscode.TextEditorDecorationType;
  private readonly rail: vscode.TextEditorDecorationType;
  private readonly note: vscode.TextEditorDecorationType;
  private readonly chip: vscode.TextEditorDecorationType;
  private readonly savedWash: vscode.TextEditorDecorationType;
  private readonly savedRail: vscode.TextEditorDecorationType;
  private readonly saved = new Map<string, SavedDoc>();
  private readonly noteUndo: string[] = [];
  private draft: Draft | undefined;
  private lensTimer: ReturnType<typeof setTimeout> | undefined;
  private draftTimer: ReturnType<typeof setTimeout> | undefined;
  private saving = false;
  private skipAuto: { key: string; until: number } | undefined;
  private capture: vscode.Disposable | undefined;

  constructor() {
    this.wash = vscode.window.createTextEditorDecorationType({
      backgroundColor: new vscode.ThemeColor('editor.rangeHighlightBackground'),
      isWholeLine: false,
    });
    this.rail = vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      borderColor: new vscode.ThemeColor('editorInfo.foreground'),
      isWholeLine: true,
    });
    this.savedWash = vscode.window.createTextEditorDecorationType({
      isWholeLine: false,
      light: { backgroundColor: AMBER_WASH_LIGHT },
      dark: { backgroundColor: AMBER_WASH_DARK },
    });
    this.savedRail = vscode.window.createTextEditorDecorationType({
      borderWidth: '0 0 0 3px',
      borderStyle: 'solid',
      isWholeLine: true,
      overviewRulerLane: vscode.OverviewRulerLane.Right,
      light: { borderColor: AMBER_INK_LIGHT, overviewRulerColor: AMBER_INK_LIGHT },
      dark: { borderColor: AMBER_INK_DARK, overviewRulerColor: AMBER_INK_DARK },
    });
    this.note = vscode.window.createTextEditorDecorationType({});
    this.chip = vscode.window.createTextEditorDecorationType({});
    this.lens = new SelectionCommentLens(this);
    void vscode.commands.executeCommand('setContext', NOTE_CONTEXT, false);
    const open = vscode.window.activeTextEditor?.document;
    if (open) {
      void this.ensureSaved(open);
    }
  }

  draftOn(uri: vscode.Uri): Draft | undefined {
    if (this.draft && this.draft.uri.toString() === uri.toString()) {
      return this.draft;
    }
    return undefined;
  }

  savedOn(uri: vscode.Uri): AgentComment[] {
    return this.saved.get(uri.toString())?.entries ?? [];
  }

  scheduleLensRefresh(): void {
    if (this.lensTimer) {
      clearTimeout(this.lensTimer);
    }
    this.lensTimer = setTimeout(() => this.lens.refresh(), 80);
  }

  /** The caret left the note, or the editor did: give the keyboard back. */
  onFocusMoved(): void {
    this.syncCapture();
    this.paint();
  }

  onSelectionChanged(event: vscode.TextEditorSelectionChangeEvent): void {
    const draft = this.draft;
    if (draft && event.textEditor.document.uri.toString() === draft.uri.toString()) {
      const live = event.textEditor.selections.some((one) => touches(draft.range, one));
      if (!live && !draft.note.trim()) {
        this.clearDraft();
      } else {
        this.syncCapture();
      }
    }
    this.scheduleLensRefresh();
    this.scheduleDraft(event);
  }

  /** After the selection settles in a compare, open the strip on those lines. */
  scheduleDraft(event: vscode.TextEditorSelectionChangeEvent): void {
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
    }
    if (this.draft?.note.trim()) {
      return;
    }
    const editor = event.textEditor;
    if (!isCompareDocument(editor.document)) {
      return;
    }
    if (editor.selection.isEmpty || !editor.document.getText(editor.selection).trim()) {
      return;
    }
    const uri = editor.document.uri;
    const range = new vscode.Range(editor.selection.start, editor.selection.end);
    this.draftTimer = setTimeout(() => {
      const current = vscode.window.activeTextEditor;
      if (!current || current.document.uri.toString() !== uri.toString() || current.selection.isEmpty) {
        return;
      }
      const settled = new vscode.Range(current.selection.start, current.selection.end);
      if (!settled.isEqual(range)) {
        return;
      }
      if (this.shouldSkipAuto(uri, settled)) {
        return;
      }
      this.openDraft(uri, settled);
    }, 280);
  }

  async commentSelection(): Promise<void> {
    const editor = editorForComment();
    if (!editor || editor.selection.isEmpty) {
      void vscode.window.showWarningMessage(
        'Select the text you want to comment on, then try again.'
      );
      return;
    }
    if (!canComment(editor.document)) {
      void vscode.window.showWarningMessage(
        'Open a file on disk or a vscode-diff Next compare, then add the comment there.'
      );
      return;
    }
    if (editor !== vscode.window.activeTextEditor) {
      await focusEditor(editor);
    }
    this.openDraft(editor.document.uri, new vscode.Range(editor.selection.start, editor.selection.end));
  }

  pickTag(tag: unknown): void {
    const value = String(tag);
    if (!isAgentTag(value) || !this.draft) {
      return;
    }
    this.draft.tag = value;
    this.paint();
    this.lens.refresh();
  }

  onType(text: string): boolean {
    if (!this.draftIsFocused() || !this.draft) {
      return false;
    }
    if (text === '\n' || text === '\r\n') {
      void this.saveComment();
      return true;
    }
    this.pushUndo();
    this.draft.note = clampNote(this.draft.note + text);
    this.paint();
    return true;
  }

  onBackspace(): boolean {
    if (!this.draftIsFocused() || !this.draft || this.draft.note.length === 0) {
      return !!this.draftIsFocused();
    }
    this.pushUndo();
    this.draft.note = this.draft.note.slice(0, -1);
    this.paint();
    return true;
  }

  onDeleteWord(): boolean {
    if (!this.draftIsFocused() || !this.draft) {
      return false;
    }
    if (this.draft.note.length === 0) {
      return true;
    }
    this.pushUndo();
    this.draft.note = this.draft.note.replace(/\s*\S+\s*$/, '');
    this.paint();
    return true;
  }

  async onPaste(): Promise<boolean> {
    if (!this.draftIsFocused() || !this.draft) {
      return false;
    }
    const text = await vscode.env.clipboard.readText();
    if (!text) {
      return true;
    }
    this.pushUndo();
    this.draft.note = clampNote(this.draft.note + text.replace(/\r\n/g, '\n'));
    this.paint();
    return true;
  }

  onCut(): boolean {
    if (!this.draftIsFocused() || !this.draft) {
      return false;
    }
    if (!this.draft.note) {
      return true;
    }
    void vscode.env.clipboard.writeText(this.draft.note);
    this.pushUndo();
    this.draft.note = '';
    this.paint();
    return true;
  }

  onUndo(): boolean {
    if (!this.draftIsFocused() || !this.draft || this.noteUndo.length === 0) {
      return !!this.draftIsFocused() && !!this.draft;
    }
    const prev = this.noteUndo.pop();
    if (prev === undefined) {
      return true;
    }
    this.draft.note = prev;
    this.paint();
    return true;
  }

  async saveComment(): Promise<void> {
    if (!this.draft || this.saving) {
      return;
    }
    const note = this.draft.note.trim();
    if (!note) {
      void vscode.window.showWarningMessage('Type a note, then Save.');
      return;
    }

    const draft = this.draft;
    const doc = await documentForThread(draft.uri);
    if (!doc) {
      void vscode.window.showWarningMessage('Could not read the selected file.');
      return;
    }
    const disk = diskFileForDocument(doc);
    if (!disk) {
      void vscode.window.showWarningMessage(
        'Open a file on disk or a vscode-diff Next compare, then try the comment again.'
      );
      return;
    }

    const startLine = draft.range.start.line + 1;
    const endLine = draft.range.end.line + 1;
    const revision = vscode.Uri.file(revisionFilePath(disk.fsPath));
    const created = !(await fileExists(revision));
    const entry = makeAgentComment({
      selectedText: doc.getText(draft.range),
      range: commentRange(startLine, endLine),
      tag: draft.tag,
      comment: note,
    });

    this.saving = true;
    try {
      const existing = created ? undefined : await readJson(revision);
      const merged = mergeAgentComments(existing, entry);
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(revision.fsPath)));
      await vscode.workspace.fs.writeFile(
        revision,
        Buffer.from(`${JSON.stringify(merged, null, 2)}\n`, 'utf8')
      );
      this.storeSaved(draft.uri.toString(), revision, merged);
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not save the comment: ${error}`);
      return;
    } finally {
      this.saving = false;
    }

    this.rememberSkip(draft.uri, draft.range);
    this.clearDraft();
    const name = path.basename(revision.fsPath);
    void vscode.window.setStatusBarMessage(
      created ? `Created ${name}` : `Added ${entry.tag} → ${name}`,
      2500
    );
  }

  async deleteComment(arg?: unknown): Promise<void> {
    const targeted = deleteArg(arg);
    if (targeted) {
      await this.removeSaved(targeted.uri, targeted.entry);
      return;
    }
    if (this.draft) {
      this.rememberSkip(this.draft.uri, this.draft.range);
      this.clearDraft();
      return;
    }
    const editor = vscode.window.activeTextEditor ?? lastTextEditor;
    if (!editor) {
      return;
    }
    const hit = this.savedAt(editor.document.uri, editor.selection.active);
    if (hit) {
      await this.removeSaved(editor.document.uri.toString(), hit);
    }
  }

  async ensureSaved(document: vscode.TextDocument): Promise<void> {
    if (!canComment(document) || this.saved.has(document.uri.toString())) {
      return;
    }
    const disk = diskFileForDocument(document);
    if (!disk) {
      return;
    }
    const revision = vscode.Uri.file(revisionFilePath(disk.fsPath));
    const entries = readAgentComments(await readJson(revision));
    this.saved.set(document.uri.toString(), { revision, entries });
    this.paint();
  }

  paint(): void {
    for (const editor of vscode.window.visibleTextEditors) {
      this.paintEditor(editor);
    }
    this.scheduleLensRefresh();
  }

  dispose(): void {
    if (this.lensTimer) {
      clearTimeout(this.lensTimer);
    }
    if (this.draftTimer) {
      clearTimeout(this.draftTimer);
    }
    this.endCapture();
    void vscode.commands.executeCommand('setContext', NOTE_CONTEXT, false);
    this.draft = undefined;
    this.saved.clear();
    this.wash.dispose();
    this.rail.dispose();
    this.savedWash.dispose();
    this.savedRail.dispose();
    this.note.dispose();
    this.chip.dispose();
    this.lens.dispose();
  }

  private shouldSkipAuto(uri: vscode.Uri, range: vscode.Range): boolean {
    if (!this.skipAuto || Date.now() > this.skipAuto.until) {
      return false;
    }
    return this.skipAuto.key === rangeKey(uri, range);
  }

  private rememberSkip(uri: vscode.Uri, range: vscode.Range): void {
    this.skipAuto = { key: rangeKey(uri, range), until: Date.now() + 2000 };
  }

  private openDraft(uri: vscode.Uri, range: vscode.Range): void {
    if (this.draft && this.draft.uri.toString() === uri.toString() && this.draft.range.isEqual(range)) {
      this.syncCapture();
      this.paint();
      return;
    }
    this.draft = {
      uri,
      range,
      note: '',
      tag: DEFAULT_TAG,
    };
    this.noteUndo.length = 0;
    this.syncCapture();
    this.paint();
  }

  private clearDraft(): void {
    this.draft = undefined;
    this.noteUndo.length = 0;
    this.syncCapture();
    this.paint();
  }

  /** Another extension owns typing, so ask for the note instead of eating keys. */
  private async promptNote(): Promise<void> {
    const draft = this.draft;
    if (!draft) {
      return;
    }
    this.paint();
    const note = await vscode.window.showInputBox({
      prompt: `Note · ${draft.tag}`,
      placeHolder: 'Note',
    });
    if (this.draft !== draft) {
      return;
    }
    if (!note?.trim()) {
      this.clearDraft();
      return;
    }
    draft.note = clampNote(note);
    await this.saveComment();
  }

  /**
   * The keyboard is ours only while the caret is still on the drafted range.
   * Click anywhere else and typing goes back to the editor immediately.
   */
  private syncCapture(): void {
    const live = this.draftIsFocused();
    if (live && !this.capture) {
      if (!this.beginCapture()) {
        void vscode.commands.executeCommand('setContext', NOTE_CONTEXT, false);
        void this.promptNote();
        return;
      }
    } else if (!live && this.capture) {
      this.endCapture();
    }
    void vscode.commands.executeCommand('setContext', NOTE_CONTEXT, live);
  }

  private beginCapture(): boolean {
    const parts: vscode.Disposable[] = [];
    const claim = (id: string, handler: () => boolean | Promise<boolean>) => {
      try {
        parts.push(
          vscode.commands.registerCommand(id, async (args: unknown) => {
            if (await handler()) {
              return;
            }
            return vscode.commands.executeCommand(`default:${id}`, args);
          })
        );
      } catch {
        // Someone else owns that key. The note still works without it.
      }
    };
    try {
      parts.push(
        vscode.commands.registerCommand('type', (args: { text?: string } | undefined) => {
          if (this.onType(typeof args?.text === 'string' ? args.text : '')) {
            return;
          }
          return vscode.commands.executeCommand('default:type', args);
        })
      );
    } catch {
      return false;
    }
    claim('deleteLeft', () => this.onBackspace());
    claim('deleteWordLeft', () => this.onDeleteWord());
    claim('editor.action.clipboardPasteAction', () => this.onPaste());
    claim('editor.action.clipboardCutAction', () => this.onCut());
    claim('undo', () => this.onUndo());
    this.capture = vscode.Disposable.from(...parts);
    return true;
  }

  private endCapture(): void {
    this.capture?.dispose();
    this.capture = undefined;
  }

  private draftIsFocused(): boolean {
    const draft = this.draft;
    if (!draft) {
      return false;
    }
    const editor = vscode.window.activeTextEditor;
    if (!editor || editor.document.uri.toString() !== draft.uri.toString()) {
      return false;
    }
    return editor.selections.some((one) => touches(draft.range, one));
  }

  private pushUndo(): void {
    if (!this.draft) {
      return;
    }
    this.noteUndo.push(this.draft.note);
    if (this.noteUndo.length > 40) {
      this.noteUndo.shift();
    }
  }

  private storeSaved(uriKey: string, revision: vscode.Uri, entries: AgentComment[]): void {
    this.saved.set(uriKey, { revision, entries });
    for (const value of this.saved.values()) {
      if (value.revision.toString() === revision.toString()) {
        value.entries = entries;
      }
    }
  }

  private savedAt(uri: vscode.Uri, position: vscode.Position): AgentComment | undefined {
    const doc = vscode.workspace.textDocuments.find((item) => item.uri.toString() === uri.toString());
    if (!doc) {
      return undefined;
    }
    for (const entry of this.savedOn(uri)) {
      const range = rangeFromEntry(entry, doc);
      if (range?.contains(position)) {
        return entry;
      }
    }
    return undefined;
  }

  private async removeSaved(uriKey: string, entry: AgentComment): Promise<void> {
    const bucket = this.saved.get(uriKey);
    if (!bucket) {
      return;
    }
    try {
      const existing = await readJson(bucket.revision);
      const left = removeAgentComment(existing, entry);
      if (left.length === 0) {
        await vscode.workspace.fs.delete(bucket.revision);
      } else {
        await vscode.workspace.fs.writeFile(
          bucket.revision,
          Buffer.from(`${JSON.stringify(left, null, 2)}\n`, 'utf8')
        );
      }
      this.storeSaved(uriKey, bucket.revision, left);
      this.paint();
    } catch (error) {
      void vscode.window.showErrorMessage(`Could not delete the comment: ${error}`);
    }
  }

  private paintEditor(editor: vscode.TextEditor): void {
    if (!canComment(editor.document)) {
      return;
    }
    const draft = this.draftOn(editor.document.uri);
    const wash: vscode.DecorationOptions[] = [];
    const rail: vscode.DecorationOptions[] = [];
    const notes: vscode.DecorationOptions[] = [];
    const chips: vscode.DecorationOptions[] = [];
    const savedWash: vscode.DecorationOptions[] = [];
    const savedRail: vscode.DecorationOptions[] = [];

    if (draft) {
      const typed = draft.note.trim().length > 0;
      wash.push({ range: draft.range });
      rail.push({ range: draft.range });
      notes.push({
        range: composerAnchor(draft.range, editor.document),
        renderOptions: {
          after: {
            contentText: displayNote(draft.note),
            color: new vscode.ThemeColor(
              typed ? 'editorWidget.foreground' : 'input.placeholderForeground'
            ),
            backgroundColor: new vscode.ThemeColor('editorWidget.background'),
            border: '1px solid',
            borderColor: new vscode.ThemeColor(this.capture ? 'focusBorder' : 'editorWidget.border'),
            fontStyle: typed ? 'normal' : 'italic',
            fontWeight: '400',
            textDecoration:
              'none; padding: 3px 10px; border-radius: 0 4px 4px 0; white-space: pre; min-width: 20ch; display: inline-block;',
          },
          // The armed tag rides inside the box, so it is never a lookup away.
          // Each theme carries the whole attachment: VS Code merges `dark` and
          // `light` over the base one key deep, so a partial `before` is lost.
          dark: { before: draftChip(draft.tag, '#20180a', AMBER_INK_DARK) },
          light: { before: draftChip(draft.tag, '#fdf6e6', AMBER_INK_LIGHT) },
        },
      });
    }

    for (const entry of this.savedOn(editor.document.uri)) {
      const range = rangeFromEntry(entry, editor.document);
      if (!range) {
        continue;
      }
      if (draft?.range.intersection(range)) {
        continue;
      }
      const hoverMessage = savedHover(editor.document.uri, entry);
      savedWash.push({ range, hoverMessage });
      savedRail.push({ range, hoverMessage });
      chips.push({
        range: endCharRange(range, editor.document),
        hoverMessage,
        renderOptions: {
          dark: { after: savedChip(entry.tag, AMBER_INK_DARK) },
          light: { after: savedChip(entry.tag, AMBER_INK_LIGHT) },
        },
      });
    }

    editor.setDecorations(this.wash, wash);
    editor.setDecorations(this.rail, rail);
    editor.setDecorations(this.savedWash, savedWash);
    editor.setDecorations(this.savedRail, savedRail);
    editor.setDecorations(this.note, notes);
    editor.setDecorations(this.chip, chips);
  }
}

class SelectionCommentLens implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly change = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses = this.change.event;
  private readonly registration: vscode.Disposable;

  constructor(private readonly review: ReviewComments) {
    this.registration = vscode.languages.registerCodeLensProvider(
      [{ scheme: GIT_SHOW_SCHEME }, { scheme: 'file' }],
      this
    );
  }

  refresh(): void {
    this.change.fire();
  }

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (!canComment(document)) {
      return [];
    }
    const draft = this.review.draftOn(document.uri);
    if (draft) {
      return toolbarLenses(draft.range, draft.tag);
    }
    const editor = vscode.window.visibleTextEditors.find(
      (item) => item.document.uri.toString() === document.uri.toString()
    );
    if (!editor || editor.selection.isEmpty) {
      const hit = savedLens(document, editor, this.review.savedOn(document.uri));
      return hit ? [hit] : [];
    }
    return [
      new vscode.CodeLens(new vscode.Range(editor.selection.start, editor.selection.end), {
        title: '$(comment) Add comment',
        tooltip: 'Open a note on this selection',
        command: 'diff-next.commentSelection',
      }),
    ];
  }

  dispose(): void {
    this.registration.dispose();
    this.change.dispose();
  }
}

function rangeKey(uri: vscode.Uri, range: vscode.Range): string {
  return `${uri.toString()}::${range.start.line}:${range.start.character}-${range.end.line}:${range.end.character}`;
}

function toolbarLenses(range: vscode.Range, active: AgentTag): vscode.CodeLens[] {
  // Save first, tags in the middle, Delete last — deleting is the rare move.
  const actions: vscode.Command[] = [
    {
      title: '$(save) Save',
      tooltip: 'Save this note (Enter)',
      command: 'diff-next.saveComment',
    },
  ];
  for (const tag of AGENT_TAGS) {
    actions.push({
      title: tag === active ? `$(circle-filled) ${tag}` : `$(circle-outline) ${tag}`,
      tooltip: `Tag as ${tag}`,
      command: 'diff-next.pickCommentTag',
      arguments: [tag],
    });
  }
  actions.push({
    title: '$(trash) Delete',
    tooltip: 'Discard this note (Esc)',
    command: 'diff-next.deleteComment',
  });
  return actions.map((item) => new vscode.CodeLens(range, item));
}

function savedLens(
  document: vscode.TextDocument,
  editor: vscode.TextEditor | undefined,
  entries: AgentComment[]
): vscode.CodeLens | undefined {
  if (!editor) {
    return undefined;
  }
  for (const entry of entries) {
    const range = rangeFromEntry(entry, document);
    if (range?.contains(editor.selection.active)) {
      return new vscode.CodeLens(range, {
        title: `$(trash) Delete ${tagChip(entry.tag)}`,
        tooltip: 'Delete this note',
        command: 'diff-next.deleteComment',
        arguments: [{ uri: document.uri.toString(), entry } satisfies DeleteArg],
      });
    }
  }
  return undefined;
}

function savedHover(uri: vscode.Uri, entry: AgentComment): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(
    `**${tagChip(entry.tag)}** · lines ${entry.range}\n\n${escapeMarkdown(entry.comment)}`
  );
  const arg = encodeURIComponent(JSON.stringify({ uri: uri.toString(), entry } satisfies DeleteArg));
  md.appendMarkdown(`\n\n[$(trash) Delete](command:diff-next.deleteComment?${arg})`);
  return md;
}

function deleteArg(value: unknown): DeleteArg | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const arg = value as { uri?: unknown; entry?: unknown };
  if (typeof arg.uri !== 'string' || !arg.entry || typeof arg.entry !== 'object') {
    return undefined;
  }
  const entry = arg.entry as AgentComment;
  if (
    typeof entry.selected_text !== 'string' ||
    typeof entry.range !== 'string' ||
    typeof entry.tag !== 'string' ||
    !isAgentTag(entry.tag) ||
    typeof entry.comment !== 'string'
  ) {
    return undefined;
  }
  return { uri: arg.uri, entry };
}

function rangeFromEntry(entry: AgentComment, document: vscode.TextDocument): vscode.Range | undefined {
  const parsed = parseCommentRange(entry.range);
  if (!parsed) {
    return undefined;
  }
  const start = Math.min(parsed.startLine, document.lineCount) - 1;
  const end = Math.min(parsed.endLine, document.lineCount) - 1;
  if (start < 0 || end < 0) {
    return undefined;
  }
  const endLine = document.lineAt(end);
  return new vscode.Range(start, 0, end, endLine.text.length);
}

/** `fix` → `{fix}`. Same shape armed on the strip and left behind on a save. */
function tagChip(tag: AgentTag): string {
  return `{${tag}}`;
}

function draftChip(tag: AgentTag, ink: string, ground: string): vscode.ThemableDecorationAttachmentRenderOptions {
  return {
    contentText: tagChip(tag),
    color: ink,
    backgroundColor: ground,
    fontWeight: '600',
    margin: '0 0 0 2ch',
    textDecoration:
      'none; padding: 3px 7px; border-radius: 4px 0 0 4px; font-size: 0.85em; letter-spacing: 0.04em;',
  };
}

function savedChip(tag: AgentTag, ink: string): vscode.ThemableDecorationAttachmentRenderOptions {
  return {
    contentText: tagChip(tag),
    color: ink,
    fontWeight: '600',
    margin: '0 0 0 2ch',
    textDecoration: 'none; font-size: 0.85em; letter-spacing: 0.04em;',
  };
}

/** The note trails the first selected line, so no code is pushed sideways. */
function composerAnchor(range: vscode.Range, document: vscode.TextDocument): vscode.Range {
  const end = document.lineAt(range.start.line).text.length;
  return new vscode.Range(range.start.line, end, range.start.line, end);
}

function touches(range: vscode.Range, selection: vscode.Selection): boolean {
  return !!range.intersection(new vscode.Range(selection.start, selection.end));
}

function endCharRange(range: vscode.Range, document: vscode.TextDocument): vscode.Range {
  const line = document.lineAt(range.end.line);
  if (line.text.length === 0) {
    return range;
  }
  const col = line.text.length;
  return new vscode.Range(range.end.line, col - 1, range.end.line, col);
}

const NOTE_WIDTH = 96;

/** Show the tail of a long note so the caret stays in view while typing. */
function displayNote(note: string): string {
  const flat = note.replace(/\s+/g, ' ');
  if (!flat.trim()) {
    return 'Note';
  }
  const clipped = flat.length > NOTE_WIDTH ? `…${flat.slice(1 - NOTE_WIDTH)}` : flat;
  return `${clipped} |`;
}

function clampNote(note: string): string {
  return note.length > NOTE_MAX ? note.slice(0, NOTE_MAX) : note;
}

function escapeMarkdown(text: string): string {
  return text.replace(/[\\`*_[\]()#+\-.!]/g, '\\$&');
}

function canComment(document: vscode.TextDocument): boolean {
  if (parseBlobUri(document.uri)) {
    return true;
  }
  return document.uri.scheme === 'file';
}

function isCompareDocument(document: vscode.TextDocument): boolean {
  if (parseBlobUri(document.uri)) {
    return true;
  }
  return document.uri.scheme === 'file' && isInDiffTab(document.uri);
}

function isInDiffTab(uri: vscode.Uri): boolean {
  const target = uri.toString();
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (!(tab.input instanceof vscode.TabInputTextDiff)) {
        continue;
      }
      if (tab.input.original.toString() === target || tab.input.modified.toString() === target) {
        return true;
      }
    }
  }
  return false;
}

function diskFileForDocument(document: vscode.TextDocument): vscode.Uri | undefined {
  const blob = parseBlobUri(document.uri);
  if (blob) {
    return vscode.Uri.file(path.join(blob.root, blob.filePath));
  }
  if (document.uri.scheme === 'file') {
    return document.uri;
  }
  return undefined;
}

async function documentForThread(uri: vscode.Uri): Promise<vscode.TextDocument | undefined> {
  const open = vscode.workspace.textDocuments.find((doc) => doc.uri.toString() === uri.toString());
  if (open) {
    return open;
  }
  try {
    return await vscode.workspace.openTextDocument(uri);
  } catch {
    return undefined;
  }
}

async function fileExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri);
    return true;
  } catch {
    return false;
  }
}

async function readJson(uri: vscode.Uri): Promise<unknown> {
  try {
    const buf = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(buf).toString('utf8'));
  } catch {
    return undefined;
  }
}

async function focusEditor(editor: vscode.TextEditor): Promise<void> {
  await vscode.window.showTextDocument(editor.document, {
    preserveFocus: false,
    preview: true,
    selection: editor.selection,
  });
}
