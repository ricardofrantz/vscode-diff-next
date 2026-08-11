import * as vscode from 'vscode';
import { DiffHost } from '../host/DiffHost';

/** Editor-area panel opened from the command palette. */
export class BranchDiffPanel {
  public static currentPanel: BranchDiffPanel | undefined;
  public static readonly viewType = 'diff-next';

  private readonly panel: vscode.WebviewPanel;
  private readonly host: DiffHost;
  private readonly disposables: vscode.Disposable[] = [];

  public static createOrShow(
    extensionUri: vscode.Uri,
    context?: vscode.ExtensionContext
  ): void {
    const column = vscode.window.activeTextEditor?.viewColumn;

    if (BranchDiffPanel.currentPanel) {
      BranchDiffPanel.currentPanel.panel.reveal(column);
      return;
    }

    const panel = vscode.window.createWebviewPanel(
      BranchDiffPanel.viewType,
      'vscode-diff Next',
      column || vscode.ViewColumn.One,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    BranchDiffPanel.currentPanel = new BranchDiffPanel(panel, extensionUri, context);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    context?: vscode.ExtensionContext
  ) {
    this.panel = panel;
    this.host = new DiffHost(extensionUri, context);
    this.host.configureWebview(panel.webview);
    panel.webview.html = this.host.getHtml();
    panel.title = 'vscode-diff Next';

    panel.onDidDispose(() => this.dispose(), null, this.disposables);
    panel.webview.onDidReceiveMessage(
      async (message) => {
        await this.host.handleMessage(message, (msg) => {
          void this.panel.webview.postMessage(msg);
        });
      },
      null,
      this.disposables
    );
  }

  public dispose(): void {
    BranchDiffPanel.currentPanel = undefined;
    this.panel.dispose();
    while (this.disposables.length) {
      this.disposables.pop()?.dispose();
    }
  }
}
