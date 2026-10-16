# Changelog

## 0.1.0

First public release.

- Word viewer for `.docx`, `.docm`, `.dotx` and `.dotm`, with Page and Reading views, paper tones, and zoom.
- **Diff with Last Commit** in VS Code's diff editor, available from the editor title, Explorer, and Source Control.
- **Set Up Git Text Diffs** registers a git textconv driver, giving `git diff`, `git log -p` and `git show` readable text diffs. The driver lives in stable extension storage, so it survives DocDiff updates.
- **Markdown companions** (`.docx.md`) give diffs in Git Graph, GitLens, and pull requests, and stay in sync automatically.
