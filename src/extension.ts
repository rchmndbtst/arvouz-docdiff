import * as vscode from 'vscode';
import { DocxEditorProvider } from './docxEditorProvider';
import { refreshTextconv, setupGitTextDiff } from './setupGitTextDiff';
import { diffWithHead, DIFF_SCHEME, DocxDiffContentProvider, interceptDocumentDiffs } from './gitCompare';
import { getLog } from './log';
import { writeCompanionForCommand, writeWorkspaceCompanions } from './companion';

export function activate(context: vscode.ExtensionContext): void {
  const provider = DocxEditorProvider.register(context);
  void refreshTextconv(context);

  const diffProvider = new DocxDiffContentProvider();
  context.subscriptions.push(
    vscode.workspace.registerTextDocumentContentProvider(DIFF_SCHEME, diffProvider),
    interceptDocumentDiffs(diffProvider),
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
    vscode.commands.registerCommand('docdiff.open', async (arg?: unknown) => {
      const target = activeTarget(arg);
      if (target) {
        await vscode.commands.executeCommand('vscode.openWith', target, DocxEditorProvider.viewType);
      }
    }),
    vscode.commands.registerCommand('docdiff.diffWithHead', (arg?: unknown) => diffWithHead(activeTarget(arg), diffProvider)),
    vscode.commands.registerCommand('docdiff.setupGitTextDiff', () => setupGitTextDiff(context)),
    vscode.commands.registerCommand('docdiff.writeCompanion', (arg?: unknown) => writeCompanionForCommand(activeTarget(arg))),
    vscode.commands.registerCommand('docdiff.writeCompanions', () => writeWorkspaceCompanions()),
    vscode.commands.registerCommand('docdiff.switchView', () => provider.sendToActivePanel('switchView')),
    vscode.commands.registerCommand('docdiff.cyclePaperTone', () => provider.sendToActivePanel('cyclePaperTone')),
    vscode.commands.registerCommand('docdiff.zoomIn', () => provider.sendToActivePanel('zoomIn')),
    vscode.commands.registerCommand('docdiff.zoomOut', () => provider.sendToActivePanel('zoomOut')),
    vscode.commands.registerCommand('docdiff.zoomReset', () => provider.sendToActivePanel('zoomReset')),
    vscode.commands.registerCommand('docdiff.showOutput', () => getLog().show()),
  );
}

export function deactivate(): void {
  // Nothing to release beyond what context.subscriptions already disposes.
}
