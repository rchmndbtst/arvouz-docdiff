# DocDiff: Word Viewer & Git Diffs

**Stop seeing `Binary files differ`.** DocDiff opens Word documents (`.docx`, `.docm`, `.dotx`, `.dotm`) right inside VS Code, and makes every git tool you already use show *what changed* in them: the terminal, Source Control, Git Graph, GitLens, and GitHub/GitLab pull requests.

## Why it exists

Git treats a Word file as an opaque blob, so its history shows only that something changed, not what. DocDiff tackles that from three sides:

| Where you look at history | What DocDiff gives you | How |
| --- | --- | --- |
| VS Code itself | **Diff with Last Commit**: a side-by-side text diff in VS Code's own diff editor | Converts both revisions to text on the fly |
| `git diff`, `git log -p`, `git show`, CI logs | Real line-level text diffs in any terminal | A git [`textconv`](https://git-scm.com/docs/gitattributes#_generating_diff_text) driver, set up once per repository |
| Git Graph, GitLens, pull requests on GitHub/GitLab | Real line-level diffs, with nothing to install for reviewers | A **Markdown companion** (`report.docx` → `report.docx.md`) committed next to the document |

Why two git mechanisms? GUIs and code-review sites read a file's content at a revision directly (`git show <rev>:<path>`), and git never runs `textconv` for that. A committed text companion is the one thing every tool can already diff.

DocDiff never touches your repository until you run one of its commands.

## Quick start

1. Install **DocDiff** from the Marketplace, then open any `.docx`. DocDiff becomes the default viewer for Word files.
2. Switch between **Page** view (the Word layout) and **Reading** view (clean text that follows your theme) with the toolbar or `Ctrl+Alt+V` / `Cmd+Alt+V`.
3. In a git repository, click the compare icon in the editor title bar (**Diff with Last Commit**) to see what changed since the last commit.
4. Want diffs in the terminal? Run **DocDiff: Set Up Git Text Diffs for This Repository** once.
5. Want diffs in pull requests and Git Graph? Right-click the document and choose **DocDiff: Write Markdown Companion**, then commit the `.docx.md` file alongside it. DocDiff keeps it up to date every time the document changes.

## Commands

All commands are under the **DocDiff** category in the Command Palette.

| Command | What it does | Also in |
| --- | --- | --- |
| Open in DocDiff Viewer | Open a Word file in the viewer | Explorer context menu |
| Diff with Last Commit | Text diff of the working copy against `HEAD` | Editor title, Explorer, Source Control |
| Set Up Git Text Diffs for This Repository | Adds `diff=docdiff` lines to `.gitattributes` and registers the textconv driver in the repo's git config | |
| Write Markdown Companion | Writes or refreshes `<name>.docx.md` beside the document | Editor title `…` menu, Explorer, Source Control |
| Write Markdown Companions for Whole Workspace | The same for every Word file in the workspace (asks first) | |
| Switch Page / Reading View | Toggle the rendering engine (`Ctrl/Cmd+Alt+V`) | Editor title |
| Cycle Paper Tone | White → sepia → night behind Page view | Editor title `…` menu, toolbar |
| Zoom In / Zoom Out / Actual Size (100%) | `Ctrl/Cmd` + `=` / `-` / `0` | Toolbar |
| Show Output | Open DocDiff's log | |

## Settings

| Setting | Default | Description |
| --- | --- | --- |
| `docdiff.defaultView` | `page` | `page` or `reading` |
| `docdiff.defaultZoom` | `100` | Opening zoom, 25–400 % |
| `docdiff.defaultPaperTone` | `white` | `white`, `sepia` or `night` |
| `docdiff.maxFileSizeMb` | `100` | Largest document DocDiff will open |
| `docdiff.reloadOnChange` | `true` | Re-render when the file changes on disk |
| `docdiff.autoUpdateCompanions` | `true` | Keep existing `.docx.md` companions in sync; never creates one on its own |

## Privacy and safety

- Everything runs locally, in a sandboxed webview with a strict Content Security Policy. No network requests, no telemetry.
- Macros in `.docm`/`.dotm` files are never executed.
- The textconv driver is a self-contained script copied into VS Code's extension storage, so it keeps working across DocDiff updates. It needs `node` on your `PATH`.

## Limitations

- Legacy binary `.doc` files and password-protected documents are not supported.
- Reading view and all text diffs show tracked changes as if accepted.
- **Diff with Last Commit** compares `HEAD` with the working tree only, not two arbitrary revisions.
- If Page view cannot lay a document out faithfully, that is a rendering-engine limit. Reading view will still show the content.

## Contributing

```bash
npm install        # also applies the docx-preview patch
npm run verify     # lint + type-check + tests
npm run package    # build a .vsix
```

Press `F5` in VS Code to launch an Extension Development Host. Issues and pull requests are welcome at [github.com/rchmndbtst/arvouz-docdiff](https://github.com/rchmndbtst/arvouz-docdiff).

## Acknowledgements

Rendering is powered by [docx-preview](https://github.com/VolodymyrBaydalka/docxjs) (Page view) and [mammoth](https://github.com/mwilliamson/mammoth.js) (Reading view and all text diffs). A fix for `docx-preview` shape and canvas rendering is adapted from [show-docx](https://github.com/showdocx/show-docx) (MIT); see [LICENSE](LICENSE).

## License

[MIT](LICENSE) © [Richmond Bautista](https://rbautista.pro)
