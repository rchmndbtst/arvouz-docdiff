import * as path from 'node:path';
import * as vscode from 'vscode';
import { readVsCodeGitUri } from './gitCompare';
import { getLog } from './log';
import { refreshExistingMirror } from './mirror';

type RenderMode = 'visual' | 'text';
type PageTheme = 'paper' | 'sepia' | 'dark';

interface ViewerSettings {
  defaultMode: RenderMode;
  defaultZoom: number;
  defaultPageTheme: PageTheme;
  autoReload: boolean;
}

interface PanelEntry {
  panel: vscode.WebviewPanel;
  uri: vscode.Uri;
  ready: boolean;
  disposed: boolean;
  subscriptions: vscode.Disposable[];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** A readonly document is just its bytes plus the uri they came from. */
class DocxDocument implements vscode.CustomDocument {
  public constructor(public readonly uri: vscode.Uri) {}
  public dispose(): void {
    // Nothing to release: the bytes live only for the duration of a render.
  }
}

export class DocxEditorProvider implements vscode.CustomReadonlyEditorProvider<DocxDocument> {
  public static readonly viewType = 'gitdoc.docxViewer';
  private readonly panels = new Set<PanelEntry>();
  private activeEntry: PanelEntry | undefined;

  public static register(context: vscode.ExtensionContext): DocxEditorProvider {
    const provider = new DocxEditorProvider(context);
    context.subscriptions.push(
      vscode.window.registerCustomEditorProvider(DocxEditorProvider.viewType, provider, {
        supportsMultipleEditorsPerDocument: false,
        webviewOptions: { retainContextWhenHidden: false },
      }),
      provider,
    );
    return provider;
  }

  public constructor(private readonly context: vscode.ExtensionContext) {}

  public openCustomDocument(uri: vscode.Uri): DocxDocument {
    return new DocxDocument(uri);
  }

  public async resolveCustomEditor(document: DocxDocument, panel: vscode.WebviewPanel): Promise<void> {
    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')],
    };

    const entry: PanelEntry = { panel, uri: document.uri, ready: false, disposed: false, subscriptions: [] };
    this.panels.add(entry);
    this.activeEntry = entry;

    entry.subscriptions.push(
      panel.webview.onDidReceiveMessage((message: { type: string }) => this.onMessage(entry, message)),
    );
    entry.subscriptions.push(
      panel.onDidChangeViewState(({ webviewPanel }) => {
        if (webviewPanel.active) {
          this.activeEntry = entry;
        }
      }),
    );
    entry.subscriptions.push(
      panel.onDidDispose(() => {
        entry.disposed = true;
        for (const sub of entry.subscriptions) {
          sub.dispose();
        }
        this.panels.delete(entry);
        if (this.activeEntry === entry) {
          this.activeEntry = undefined;
        }
      }),
    );

    if (this.getSettings().autoReload) {
      const watcher = vscode.workspace.createFileSystemWatcher(document.uri.fsPath);
      entry.subscriptions.push(watcher);
      entry.subscriptions.push(
        watcher.onDidChange(() => {
          if (entry.ready) {
            void this.sendDocument(entry, true);
          }
          void refreshExistingMirror(document.uri, (uri) => this.readDocument(uri));
        }),
      );
    }

    panel.webview.html = this.getHtml(panel.webview);
  }

  public sendToActivePanel(type: string): boolean {
    if (!this.activeEntry || this.activeEntry.disposed) {
      return false;
    }
    void this.activeEntry.panel.webview.postMessage({ type });
    return true;
  }

  public getActiveDocumentUri(): vscode.Uri | undefined {
    return this.activeEntry?.uri;
  }

  public dispose(): void {
    for (const entry of this.panels) {
      entry.disposed = true;
      for (const sub of entry.subscriptions) {
        sub.dispose();
      }
    }
    this.panels.clear();
  }

  private async onMessage(entry: PanelEntry, message: { type: string }): Promise<void> {
    if (message.type === 'ready') {
      entry.ready = true;
      await this.sendDocument(entry, false);
    } else if (message.type === 'retry') {
      await this.sendDocument(entry, true);
    }
  }

  private async sendDocument(entry: PanelEntry, reload: boolean): Promise<void> {
    if (entry.disposed) {
      return;
    }
    const name = path.basename(entry.uri.path);
    try {
      const data = await this.readDocument(entry.uri);
      await entry.panel.webview.postMessage({
        type: 'document',
        fileName: name,
        fileSize: data.byteLength,
        settings: this.getSettings(),
        reload,
        data: Buffer.from(data).toString('base64'),
      });
    } catch (error: unknown) {
      getLog().error(`Opening ${name} failed.`, error);
      void entry.panel.webview.postMessage({
        type: 'hostError',
        message: error instanceof Error ? error.message : 'GitDoc could not open this document.',
      });
    }
  }

  private async readDocument(uri: vscode.Uri): Promise<Uint8Array> {
    const maxBytes = this.maxFileSize;
    // VS Code opens this side of a Source Control diff-click with a `git:`
    // scheme URI, backed by its own git extension's FileSystemProvider, not
    // ours. vscode.workspace.fs.readFile trusts that provider's bytes; when
    // it returned wrong, truncated content for a real document, GitDoc
    // rendered "corrupted" although nothing in the repository actually was.
    // Reading it ourselves via `git show`, the same call compareWithHead
    // already relies on, is verified correct.
    getLog().info(`Reading ${uri.toString()} (scheme=${uri.scheme}).`);
    const data = uri.scheme === 'git'
      ? await readVsCodeGitUri(uri)
      : await vscode.workspace.fs.readFile(uri);
    getLog().info(`Read ${data.byteLength} bytes from ${uri.toString()}.`);
    if (data.byteLength > maxBytes) {
      throw new Error(`This document is larger than the ${Math.round(maxBytes / (1024 * 1024))} MB limit (gitdoc.maxFileSizeMb).`);
    }
    return data;
  }

  private get maxFileSize(): number {
    const mb = clamp(vscode.workspace.getConfiguration('gitdoc').get<number>('maxFileSizeMb', 100), 1, 500);
    return mb * 1024 * 1024;
  }

  private getSettings(): ViewerSettings {
    const configuration = vscode.workspace.getConfiguration('gitdoc');
    return {
      defaultMode: configuration.get<RenderMode>('defaultMode', 'visual'),
      defaultZoom: clamp(configuration.get<number>('defaultZoom', 100), 25, 400),
      defaultPageTheme: configuration.get<PageTheme>('defaultPageTheme', 'paper'),
      autoReload: configuration.get<boolean>('autoReload', true),
    };
  }

  private getHtml(webview: vscode.Webview): string {
    const nonce = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.css'));

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data: blob:; font-src ${webview.cspSource} data:;">
<link rel="stylesheet" href="${styleUri}">
<title>GitDoc</title>
</head>
<body>
<div id="app" class="gitdoc-app">
  <header class="gitdoc-toolbar" role="toolbar" aria-label="Document viewer controls">
    <div class="toolbar-file">
      <span id="file-name" class="file-name">Word document</span>
      <span id="file-size" class="file-size"></span>
    </div>
    <div class="toolbar-group mode-switcher" aria-label="Rendering mode">
      <button id="mode-visual" class="toolbar-button mode-button" type="button" aria-pressed="true">Visual</button>
      <button id="mode-text" class="toolbar-button mode-button" type="button" aria-pressed="false">Text</button>
    </div>
    <div class="toolbar-spacer"></div>
    <button id="page-theme-button" class="toolbar-button" type="button" title="Page theme">Theme</button>
    <div class="toolbar-group zoom-controls" aria-label="Zoom controls">
      <button id="zoom-out" class="toolbar-button icon-button" type="button" title="Zoom out">-</button>
      <button id="zoom-reset" class="zoom-value" type="button" title="Reset zoom">100%</button>
      <button id="zoom-in" class="toolbar-button icon-button" type="button" title="Zoom in">+</button>
    </div>
  </header>
  <main id="viewport" class="gitdoc-viewport">
    <div id="loading" class="gitdoc-loading">
      <div id="loading-label">Waiting for document...</div>
    </div>
    <section id="error-state" class="gitdoc-error hidden" role="alert">
      <h1>Unable to preview this document</h1>
      <p id="error-message"></p>
      <button id="retry-button" class="primary-button" type="button">Try again</button>
    </section>
    <div id="zoom-frame" class="zoom-frame hidden">
      <div id="zoom-surface" class="zoom-surface">
        <div id="visual-container" class="render-container visual-container"></div>
        <article id="text-container" class="render-container gitdoc-text hidden"></article>
      </div>
    </div>
  </main>
</div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
