import { execFile } from 'node:child_process';
import { appendFile, readFile } from 'node:fs/promises';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { missingAttributeLines } from './gitAttributes';
import { getLog } from './log';

function git(args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile('git', [...args], { cwd, windowsHide: true }, (error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function repoRoot(dir: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile('git', ['rev-parse', '--show-toplevel'], { cwd: dir, windowsHide: true }, (error, stdout) => {
      resolve(error ? undefined : stdout.trim());
    });
  });
}

/**
 * Configures git so `git diff`, `git log -p` and `git show <commit>` print
 * readable text for a Word document instead of "Binary files differ": the
 * standard git textconv mechanism, honoured by the CLI and by any GUI that
 * shells out to a real `git diff`/`git show <commit>` (rather than reading a
 * blob directly, which textconv does not cover; the Markdown companion commands
 * are what covers that case, including Git Graph's per-file diff view).
 */
export async function setupGitTextDiff(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage('DocDiff: open a folder first.');
    return;
  }
  const root = await repoRoot(folder.uri.fsPath);
  if (!root) {
    void vscode.window.showWarningMessage('DocDiff: this folder is not a git repository.');
    return;
  }

  try {
    const scriptPath = await installTextconv(context);
    await git(['config', 'diff.docdiff.textconv', `node "${scriptPath}"`], root);
    await git(['config', 'diff.docdiff.cachetextconv', 'true'], root);
    await ensureAttributes(root);
    void vscode.window.showInformationMessage(
      'DocDiff: readable git diffs enabled for this repository. `git diff`, `git log -p` and `git show` will now show Word documents as text.',
    );
  } catch (error: unknown) {
    getLog().error('Enabling readable git diffs failed.', error);
    void vscode.window.showWarningMessage('DocDiff: could not configure git. See the DocDiff log.');
  }
}

/**
 * git config must not point into the extension's own folder: VS Code deletes
 * that folder (its name carries the version) on every update, which would
 * leave `git diff` failing. A copy in global storage has a stable path and is
 * refreshed on every activation by refreshTextconv.
 */
async function installTextconv(context: vscode.ExtensionContext): Promise<string> {
  const target = vscode.Uri.joinPath(context.globalStorageUri, 'textconv.cjs');
  await vscode.workspace.fs.createDirectory(context.globalStorageUri);
  await vscode.workspace.fs.copy(vscode.Uri.joinPath(context.extensionUri, 'dist', 'textconv.cjs'), target, { overwrite: true });
  return target.fsPath;
}

/** Keeps an already-installed textconv copy in step with this version of the extension. */
export async function refreshTextconv(context: vscode.ExtensionContext): Promise<void> {
  try {
    await vscode.workspace.fs.stat(vscode.Uri.joinPath(context.globalStorageUri, 'textconv.cjs'));
  } catch {
    return; // never set up; nothing to refresh
  }
  try {
    await installTextconv(context);
  } catch (error: unknown) {
    getLog().error('Refreshing the textconv script failed.', error);
  }
}

async function ensureAttributes(root: string): Promise<void> {
  const attrPath = path.join(root, '.gitattributes');
  let existing = '';
  try {
    existing = await readFile(attrPath, 'utf8');
  } catch {
    // No .gitattributes yet: appendFile below creates it.
  }
  const addition = missingAttributeLines(existing);
  if (addition !== '') {
    await appendFile(attrPath, addition);
  }
}
