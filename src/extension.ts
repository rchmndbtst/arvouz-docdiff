import * as vscode from 'vscode';
import { DocxEditorProvider } from './docxEditorProvider';
import { enableGitTextDiff } from './enableGitTextDiff';
import { compareWithHead, DIFF_SCHEME, DocxDiffContentProvider } from './gitCompare';
import { getLog } from './log';
import { writeMirrorForCommand, writeWorkspaceMirrors } from './mirror';

export function activate(context: vscode.ExtensionContext): void {
  const provider = DocxEditorProvider.register(context);

  const diffProvider = new DocxDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
  );

  // A menu command's argument varies by where it was invoked from: the
  // Explorer and editor title pass a plain Uri; a right-click in Source
  // Control's Changes list passes the SourceControlResourceState itself.
  const toUri = (arg: unknown): vscode.Uri | undefined => {
    if (arg instanceof vscode.Uri) {
      return arg;
    }
    const resourceUri = (arg as { resourceUri?: unknown } | undefined)?.resourceUri;
    return resourceUri instanceof vscode.Uri ? resourceUri : undefined;
  };

  const activeTarget = (arg: unknown): vscode.Uri | undefined =>
    toUri(arg) ?? vscode.window.activeTextEditor?.document.uri ?? provider.getActiveDocumentUri();

  context.subscriptions.push(
    vscode.commands.registerCommand('gitdoc.openWith', async (arg?: unknown) => {
      const target = activeTarget(arg);
      if (target) {
        await vscode.commands.executeCommand('vscode.openWith', target, DocxEditorProvider.viewType);
      }
    }),
    vscode.commands.registerCommand('gitdoc.compareWithHead', (arg?: unknown) => compareWithHead(activeTarget(arg), diffProvider)),
    vscode.commands.registerCommand('gitdoc.enableGitTextDiff', () => enableGitTextDiff(context)),
    vscode.commands.registerCommand('gitdoc.writeMirror', (arg?: unknown) => writeMirrorForCommand(activeTarget(arg))),
    vscode.commands.registerCommand('gitdoc.writeMirrors', () => writeWorkspaceMirrors()),
    vscode.commands.registerCommand('gitdoc.toggleMode', () => provider.sendToActivePanel('toggleMode')),
    vscode.commands.registerCommand('gitdoc.cyclePageTheme', () => provider.sendToActivePanel('cyclePageTheme')),
    vscode.commands.registerCommand('gitdoc.zoomIn', () => provider.sendToActivePanel('zoomIn')),
    vscode.commands.registerCommand('gitdoc.zoomOut', () => provider.sendToActivePanel('zoomOut')),
    vscode.commands.registerCommand('gitdoc.zoomReset', () => provider.sendToActivePanel('zoomReset')),
    vscode.commands.registerCommand('gitdoc.showLog', () => getLog().show()),
  );
}

export function deactivate(): void {
  // Nothing to release beyond what context.subscriptions already disposes.
}
