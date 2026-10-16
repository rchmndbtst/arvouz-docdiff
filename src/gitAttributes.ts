export const DOCX_DIFF_ATTRIBUTE_LINES = [
  '*.docx diff=docdiff',
  '*.docm diff=docdiff',
  '*.dotx diff=docdiff',
  '*.dotm diff=docdiff',
];

/**
 * The text to append to .gitattributes so it declares the "docdiff" diff driver
 * for every Word extension, or '' when every line is already there. Pulled
 * out from setupGitTextDiff so it can be unit tested without a vscode host.
 */
export function missingAttributeLines(existing: string): string {
  const missing = DOCX_DIFF_ATTRIBUTE_LINES.filter((line) => !existing.includes(line));
  if (missing.length === 0) {
    return '';
  }
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  return `${prefix}${missing.join('\n')}\n`;
}
