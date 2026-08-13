import * as vscode from 'vscode';
import { commentSelection, rememberTextEditor } from './commands/commentSelection';
import { BranchDiffPanel } from './panels/BranchDiffPanel';
import { BranchDiffViewProvider } from './panels/BranchDiffViewProvider';
import { GIT_SHOW_SCHEME, GitBlobFileSystemProvider } from './host/DiffHost';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      GIT_SHOW_SCHEME,
      new GitBlobFileSystemProvider(),
      { isCaseSensitive: true, isReadonly: true }
    )
  );

  const provider = new BranchDiffViewProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(BranchDiffViewProvider.viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diff-next.compare', () => {
      BranchDiffPanel.createOrShow(context.extensionUri, context);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('diff-next.commentSelection', () =>
      commentSelection(context)
    )
  );

  rememberTextEditor(vscode.window.activeTextEditor);
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor((editor) => rememberTextEditor(editor))
  );
}

export function deactivate(): void {}
