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

/** Empty ref is git's own convention for "the index" (staged content). */
async function readAtRef(root: string, relativePath: string, ref: string): Promise<Buffer> {
  const spec = ref === '' ? `:${relativePath}` : `${ref}:${relativePath}`;
  const result = await run(['--no-optional-locks', 'show', spec], root);
  if (result.code !== 0) {
    const label = ref === '' ? 'the index' : ref;
    throw new Error(
      /unknown revision|bad revision|ambiguous argument/i.test(result.stderr)
        ? `This repository has no commit to compare against yet (${label} is unborn).`
        : `"${relativePath}" does not exist in ${label}.`,
    );
  }
  return result.stdout;
}

interface VsCodeGitUriParams {
  readonly path: string;
  readonly ref: string;
}

function parseVsCodeGitUri(uri: vscode.Uri): VsCodeGitUriParams | undefined {
  try {
    const parsed = JSON.parse(uri.query) as Partial<VsCodeGitUriParams>;
    return typeof parsed.path === 'string' && typeof parsed.ref === 'string'
      ? { path: parsed.path, ref: parsed.ref }
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * `~` is not a git revision: it's VS Code's own git extension using it as a
 * sentinel for "the version being compared against the working tree,"
 * resolved dynamically to the index if this path has staged changes, HEAD
 * otherwise. Mirrors that extension's own GitContentProvider logic using
 * plain git plumbing rather than its internal repository model.
 */
async function resolveTildeRef(root: string, relativePath: string): Promise<string> {
  const indexEntry = await run(['ls-files', '-s', '--', relativePath], root);
  const indexOid = indexEntry.code === 0 ? indexEntry.stdout.toString('utf8').trim().split(/\s+/)[1] : undefined;
  const headEntry = await run(['rev-parse', '--verify', '--quiet', `HEAD:${relativePath}`], root);
  const headOid = headEntry.code === 0 ? headEntry.stdout.toString('utf8').trim() : undefined;
  return indexOid !== undefined && indexOid !== headOid ? '' : HEAD;
}

/**
 * Reads a document from VS Code's built-in git extension's own `git:` scheme
 * URI (its `toGitUri` convention: query is `{"path": <fsPath>, "ref": <rev>}`,
 * where ref is a real revision, `''` for the index, or `~` per
 * resolveTildeRef above). Used in place of `vscode.workspace.fs.readFile` on
 * that scheme: that API delegates to whatever `FileSystemProvider` the git
 * extension registers for it, which returned truncated, invalid bytes for a
 * real document GitDoc encountered (Source Control's own diff-on-click,
 * distinct from compareWithHead below). A direct `git show`, the same call
 * compareWithHead already relies on, is verified correct.
 */
export async function readVsCodeGitUri(uri: vscode.Uri): Promise<Uint8Array> {
  const params = parseVsCodeGitUri(uri);
  if (!params) {
    throw new Error('GitDoc could not parse this git revision reference.');
  }
  const root = await repoRoot(path.dirname(params.path));
  if (!root) {
    throw new Error('This document is not inside a git repository.');
  }
  const relative = toRelative(root, params.path);
  if (!relative) {
    throw new Error('This document is not inside a git repository.');
  }
  const ref = params.ref === '~' ? await resolveTildeRef(root, relative) : params.ref;
  return readAtRef(root, relative, ref);
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
