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

  const activeTarget = (uri: vscode.Uri | undefined): vscode.Uri | undefined =>
    uri ?? vscode.window.activeTextEditor?.document.uri ?? provider.getActiveDocumentUri();

  context.subscriptions.push(
    vscode.commands.registerCommand('gitdoc.openWith', async (uri?: vscode.Uri) => {
      const target = activeTarget(uri);
      if (target) {
        await vscode.commands.executeCommand('vscode.openWith', target, DocxEditorProvider.viewType);
      }
    }),
    vscode.commands.registerCommand('gitdoc.compareWithHead', (uri?: vscode.Uri) => compareWithHead(activeTarget(uri), diffProvider)),
    vscode.commands.registerCommand('gitdoc.enableGitTextDiff', () => enableGitTextDiff(context)),
    vscode.commands.registerCommand('gitdoc.writeMirror', (uri?: vscode.Uri) => writeMirrorForCommand(activeTarget(uri))),
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
