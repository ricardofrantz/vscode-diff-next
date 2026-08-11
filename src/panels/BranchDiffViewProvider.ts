import * as vscode from 'vscode';
import { DiffHost } from '../host/DiffHost';

/** Activity-bar sidebar webview. */
export class BranchDiffViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'diff-next.panel';

  private view?: vscode.WebviewView;
  private readonly host: DiffHost;

  constructor(
    extensionUri: vscode.Uri,
    context?: vscode.ExtensionContext
  ) {
    this.host = new DiffHost(extensionUri, context);
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.view = webviewView;
    this.host.configureWebview(webviewView.webview);
    webviewView.webview.html = this.host.getHtml();

    webviewView.webview.onDidReceiveMessage(async (message) => {
      await this.host.handleMessage(message, (msg) => {
        void this.view?.webview.postMessage(msg);
      });
    });
  }
}
