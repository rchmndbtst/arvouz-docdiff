# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Standing instructions (machine-local, optional)

@instr/core/1-CORE.md
@instr/core/2-OPERATIONS.md
@instr/core/9-README.md

The three imports above are the Principal's personal CORE instruction set (`9-README.md`'s own Repository Map tells you which `instr/base/*.md` file to load for a given task, e.g. code changes load `20-CODE-STANDARDS.md`, git operations load `60-GIT-STANDARDS.md`).

`instr/` is **not part of this repository**: it holds symlinks into the Principal's separate `core` and `core-config` projects, and is gitignored here. On the Principal's own machine the imports above resolve and CORE governs the session. Anyone else cloning this public repository will not have `instr/` on disk, the imports above will simply resolve to nothing, and CORE does not apply to their sessions. This is intentional (CORE is the Principal's personal layer, not a project requirement) and not a bug to fix.

No Project-tier (`instr/project/###-*.md`) file exists yet for this repository.

## Commands

```bash
npm install              # also applies the docx-preview patch via patch-package
npm run build             # esbuild: dist/extension.js, dist/textconv.cjs, dist/webview/main.{js,css}
npm run watch              # same, in watch mode
npm run check-types        # tsc --noEmit against both the extension-host and webview tsconfigs
npm run lint               # eslint src webview-src test
npm test                   # node --experimental-strip-types --test "test/**/*.test.ts"
npm run verify              # lint + check-types + test (also what vsce runs before packaging)
npm run package             # build + vsce package -> arvouz-gitdoc-<version>.vsix
```

Run a single test by name: `node --experimental-strip-types --test --test-name-pattern="mirror" "test/**/*.test.ts"`.

Tests run directly against the `.ts` sources under Node's built-in type stripping (Node 22.6+/24) — no test framework, no build step. Relative imports in `test/*.test.ts` must include the explicit `.ts` extension (Node's ESM resolver requires it); omitting it fails with `ERR_MODULE_NOT_FOUND` even though `tsc` won't complain.

To try the extension in a real VS Code window: `npm run package && code --install-extension arvouz-gitdoc-*.vsix`, then open any `.docx`/`.docm`/`.dotx`/`.dotm` file.

## Architecture

Three esbuild entry points, defined in `esbuild.mjs`, share no runtime code path with each other despite importing from the same `src/`:

- **`src/extension.ts` → `dist/extension.js`** (node, cjs, `vscode` external). The extension host. Registers `DocxEditorProvider` (custom readonly editor) and every command.
- **`webview-src/main.ts` → `dist/webview/main.js`** (browser, iife). Runs inside the sandboxed webview `docxEditorProvider.ts` creates; receives the document as base64 over `postMessage`, renders it with `docx-preview` (Visual mode) or `mammoth` (Text mode).
- **`src/textconvEntry.ts` → `dist/textconv.cjs`** (node, cjs, **fully self-contained** — bundles `mammoth` in rather than requiring it from `node_modules`). Invoked directly by `git` itself as a `textconv` driver (`node dist/textconv.cjs <path>`), completely outside the VS Code process. This is why `convert.ts` (the shared docx→text logic) must not import `vscode`.

### The git-diff story is two independent mechanisms, not one

This project's reason for existing over a plain docx viewer is that git (and everything built on it) reports a Word document as `Binary files differ`. Two separate, non-overlapping fixes exist for this, implemented in `src/gitAttributes.ts` + `src/enableGitTextDiff.ts` and `src/mirror.ts` respectively:

1. **`textconv`** (`enableGitTextDiff.ts`): writes a `diff=word` `.gitattributes` entry and a `git config diff.word.textconv` pointing at `dist/textconv.cjs`. This only affects tools that run a real `git diff`/`git log -p`/`git show <commit>` — i.e., the CLI.
2. **Markdown mirrors** (`mirror.ts`): an optional `<name>.docx.md` file written beside the document, kept in sync on save once created. This is what makes Git Graph, GitLens, and GitHub/GitLab PRs show a real diff, because those tools fetch a file's blob at a revision directly (`git show <rev>:<path>`) rather than running a diff, and a direct blob read never applies `textconv` — only an ordinary tracked text file works there.

Neither mechanism is created without an explicit command (`GitDoc: Enable Readable Git Diffs`, `GitDoc: Write Markdown Mirror(s)`) — see `mirror.ts`'s module comment for why. `src/gitCompare.ts` is a third, separate path (VS Code's own diff editor via a virtual `gitdoc-diff:` scheme), unrelated to either.

### Shared conversion, one function

`src/convert.ts`'s `docxToDiffText` is the single converter behind the mirror, the `textconv` script, and `gitCompare.ts`'s diff-editor content provider — all three must treat a document the same way for a diff to make sense across them. Don't add a second conversion path; extend this one.

### Reused upstream fix

`patches/docx-preview+0.3.7.patch` (applied via `patch-package` on `postinstall`) is copied from the `show-docx` project this repo's viewer is based on: it fixes `docx-preview` rendering of shapes/canvases/groups that the unpatched library silently drops. Don't remove it without confirming that upstream `docx-preview` has actually merged the fix.
