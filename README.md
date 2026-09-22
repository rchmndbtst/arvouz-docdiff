# GitDoc

View Word documents (`.docx`, `.docm`, `.dotx`, `.dotm`) directly in VS Code — and unlike Word documents everywhere else in git, get a diff that actually reads.

## The problem this solves

Git reports a `.docx` as `Binary files differ`. So does Git Graph, GitLens, and every pull request that touches one. GitDoc fixes both ends:

1. **A viewer.** A custom editor renders the page layout (`docx-preview`) or a clean semantic view (`mammoth`), so you never leave VS Code to read one.
2. **Diffs that work everywhere, not just in this extension.** Two independent mechanisms, because no single one covers every tool:
   - **`GitDoc: Enable Readable Git Diffs`** configures a git [`textconv`](https://git-scm.com/docs/gitattributes#_generating_diff_text) driver for Word files in the current repository. From then on, plain `git diff`, `git log -p`, and `git show <commit>` print the document as text — no extension required, works in any terminal, any CI log, any tool that shells out to a real diff.
   - **Markdown mirrors** (`GitDoc: Write Markdown Mirror(s)`) write a `.docx.md` companion file beside a document. Once committed, it's an ordinary tracked text file — so **Git Graph, GitLens, GitHub/GitLab pull requests, and every other tool that reads git history shows a real, line-level diff automatically**, because none of them need to know GitDoc exists. `textconv` doesn't reach this case: most GUIs fetch a file's blob at a revision directly rather than running `git diff`, and blob reads skip `textconv` by design. GitDoc never creates a mirror without being asked; once one exists, it's kept in sync on every save (`gitdoc.markdownMirror: onChange`, the default).

Both are additive to your repository's own git history — GitDoc doesn't touch anything until you run one of these commands.

## Using it

1. Open a `.docx` — GitDoc is the default editor for all four Word extensions.
2. **Visual** shows the Word page layout; **Text** shows a clean reading view. Toggle with the toolbar or `GitDoc: Toggle Visual/Text Mode`.
3. Zoom with the toolbar or `Ctrl/Cmd` + `=`/`-`/`0`. Cycle the page background (paper/sepia/dark) with the theme button.
4. Right-click a `.docx` in the Explorer (or run from the Command Palette):
   - **Compare with HEAD** — opens the working copy against the last commit in VS Code's own diff editor.
   - **Write Markdown Mirror** — writes/updates a `.docx.md` beside this document.
   - **Write Markdown Mirrors (Workspace)** — does the same for every Word document in the workspace, after confirming how many.
5. Run **GitDoc: Enable Readable Git Diffs** once per repository to turn on the `textconv` driver.

## Commands

| Command | Purpose |
| --- | --- |
| `GitDoc: Open with GitDoc` | Open the selected file in the viewer |
| `GitDoc: Compare with HEAD` | Diff the working copy against HEAD in VS Code's diff editor |
| `GitDoc: Enable Readable Git Diffs (textconv)` | Configure this repository's `.gitattributes` + git config so `git diff`/`git log -p`/`git show` read Word documents as text |
| `GitDoc: Write Markdown Mirror` | Write/refresh a `.docx.md` beside the current document |
| `GitDoc: Write Markdown Mirrors (Workspace)` | Same, for every Word document in the workspace |
| `GitDoc: Toggle Visual/Text Mode` | Switch rendering engines |
| `GitDoc: Change Page Theme` | Cycle paper / sepia / dark |
| `GitDoc: Zoom In / Out / Reset` | Zoom the page |
| `GitDoc: Show Log` | Open the GitDoc log channel |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `gitdoc.defaultMode` | `visual` | Initial rendering mode |
| `gitdoc.defaultZoom` | `100` | Initial zoom, 25–400 |
| `gitdoc.defaultPageTheme` | `paper` | Visual-mode page background |
| `gitdoc.maxFileSizeMb` | `100` | Largest file GitDoc will open |
| `gitdoc.autoReload` | `true` | Reload when the file changes on disk |
| `gitdoc.markdownMirror` | `onChange` | Keep an existing `.docx.md` mirror current on every save; never creates one |

## How it behaves

- All four OOXML Word formats are the same package format; macros are never executed.
- Rendering runs entirely inside the sandboxed webview — no network request, no telemetry.
- If Visual mode can't render a document, it's a rendering-engine limitation, not a crash: switch to Text mode.

## Known limitations

- `.doc` (the legacy binary format) is not supported.
- Text mode shows tracked changes as accepted — `mammoth` drops deletions and inlines insertions.
- `Compare with HEAD` covers HEAD and the working tree only; comparing two arbitrary revisions isn't implemented yet.
- Password-protected documents are not supported.
- `textconv` covers the CLI and tools that run a real `git diff`/`git show <commit>`. Tools that read a file's blob at a revision directly (most GUI "click a file in a commit" views, including Git Graph's) need the Markdown mirror instead — see above.

## Development

```bash
npm install
npm run verify   # lint + type-check + test
npm run build
```

Press `F5` in VS Code to start the Extension Development Host.

## Credit

GitDoc's viewer is built on the same open-source renderers as [show-docx](https://github.com/showdocx/show-docx) (`docx-preview`, `mammoth`), and reuses its `docx-preview` shape/canvas rendering patch. The git-diff story — `textconv` plus default-on mirror refresh — is GitDoc's own.

## License

[MIT](LICENSE)
