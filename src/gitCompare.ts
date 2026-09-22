import { execFile } from 'node:child_process';
import * as path from 'node:path';
import * as vscode from 'vscode';
import { docxToDiffText } from './convert';
import { getLog } from './log';

export const DIFF_SCHEME = 'gitdoc-diff';
const HEAD = 'HEAD';

function gitPath(): string {
  const configured = vscode.workspace.getConfiguration('git').get<string | string[]>('path');
  const candidate = Array.isArray(configured) ? configured[0] : configured;
  return typeof candidate === 'string' && candidate.trim() !== '' ? candidate : 'git';
}

function run(args: readonly string[], cwd: string): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      gitPath(),
      [...args],
      { cwd, encoding: 'buffer', maxBuffer: 512 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        const spawnCode = (error as { code?: unknown } | null)?.code;
        if (typeof spawnCode === 'string') {
          reject(new Error(`GitDoc could not run git ("${gitPath()}"). Install git or set the "git.path" setting.`));
          return;
        }
        resolve({ code: typeof spawnCode === 'number' ? spawnCode : 0, stdout, stderr: stderr.toString('utf8') });
      },
    );
  });
}

async function repoRoot(fileDir: string): Promise<string | undefined> {
  const result = await run(['rev-parse', '--show-toplevel'], fileDir);
  if (result.code !== 0) {
    return undefined;
  }
  const root = result.stdout.toString('utf8').trim();
  return root === '' ? undefined : path.normalize(root);
}

function toRelative(root: string, filePath: string): string | undefined {
  const relative = path.relative(root, filePath).replaceAll('\\', '/');
  return relative === '' || relative.startsWith('../') ? undefined : relative;
}

async function readAtRef(root: string, relativePath: string, ref: string): Promise<Buffer> {
  const result = await run(['--no-optional-locks', 'show', `${ref}:${relativePath}`], root);
  if (result.code !== 0) {
    throw new Error(
      /unknown revision|bad revision|ambiguous argument/i.test(result.stderr)
        ? `This repository has no commit to compare against yet (${ref} is unborn).`
        : `"${relativePath}" does not exist in ${ref}.`,
    );
  }
  return result.stdout;
}

/** Serves both sides of the comparison as plain text, converting on demand. */
export class DocxDiffContentProvider implements vscode.TextDocumentContentProvider {
  private readonly changed = new vscode.EventEmitter<vscode.Uri>();
  public readonly onDidChange = this.changed.event;

  public refresh(uri: vscode.Uri): void {
    this.changed.fire(uri);
  }

  public async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
    const { target, ref } = decodeDiffUri(uri);
    const bytes = ref
      ? await this.readRef(target, ref)
      : await vscode.workspace.fs.readFile(target);
    try {
      return await docxToDiffText(bytes);
    } catch {
      return '(GitDoc could not convert this revision to text.)';
    }
  }

  private async readRef(target: vscode.Uri, ref: string): Promise<Uint8Array> {
    const root = await repoRoot(path.dirname(target.fsPath));
    if (!root) {
      throw new Error('This document is not inside a git repository.');
    }
    const relative = toRelative(root, target.fsPath);
    if (!relative) {
      throw new Error('This document is not inside a git repository.');
    }
    return readAtRef(root, relative, ref);
  }
}

function encodeDiffUri(target: vscode.Uri, ref: string | undefined): vscode.Uri {
  return vscode.Uri.from({
    scheme: DIFF_SCHEME,
    path: target.path,
    query: ref ? `ref=${encodeURIComponent(ref)}&of=${encodeURIComponent(target.toString())}` : `of=${encodeURIComponent(target.toString())}`,
  });
}

function decodeDiffUri(uri: vscode.Uri): { target: vscode.Uri; ref: string | undefined } {
  const params = new URLSearchParams(uri.query);
  const of = params.get('of');
  return { target: of ? vscode.Uri.parse(of) : uri.with({ scheme: 'file' }), ref: params.get('ref') ?? undefined };
}

export async function compareWithHead(target: vscode.Uri | undefined, provider: DocxDiffContentProvider): Promise<void> {
  if (!target || target.scheme !== 'file') {
    void vscode.window.showWarningMessage('GitDoc: open or select a Word document to compare it with HEAD.');
    return;
  }
  const name = path.basename(target.path);
  try {
    const root = await repoRoot(path.dirname(target.fsPath));
    if (!root) {
      throw new Error(`${name} is not inside a git repository.`);
    }
    const relative = toRelative(root, target.fsPath);
    if (!relative) {
      throw new Error(`${name} is not inside a git repository.`);
    }
    await readAtRef(root, relative, HEAD); // fail fast, before the diff editor opens a blank side

    const left = encodeDiffUri(target, HEAD);
    const right = encodeDiffUri(target, undefined);
    provider.refresh(left);
    provider.refresh(right);
    await vscode.commands.executeCommand('vscode.diff', left, right, `${name} (HEAD ↔ Working Tree)`, { preview: true });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    getLog().error(`Comparing ${name} with HEAD failed.`, error);
    void vscode.window.showWarningMessage(`GitDoc: ${message}`);
  }
}
