import { readFileSync } from 'node:fs';
import { docxToDiffText } from './convert';

/**
 * git's textconv contract: one argument, the path git wants converted, output
 * on stdout. Registered by "GitDoc: Enable Readable Git Diffs" as the
 * textconv for the "word" diff driver, so `git diff`, `git log -p`, and any
 * tool that shells out to plain `git diff`/`git show <rev>` (rather than
 * `git show <rev>:<path>`) gets readable text instead of "Binary files differ".
 */
async function main(): Promise<void> {
  const filePath = process.argv[2];
  if (!filePath) {
    process.stderr.write('Usage: textconv.cjs <path>\n');
    process.exitCode = 1;
    return;
  }
  try {
    const bytes = readFileSync(filePath);
    const text = await docxToDiffText(bytes);
    process.stdout.write(text);
  } catch (error: unknown) {
    process.stderr.write(`GitDoc textconv could not read ${filePath}: ${String(error)}\n`);
    process.exitCode = 1;
  }
}

void main();
