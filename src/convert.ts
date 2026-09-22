import * as mammoth from 'mammoth';

/**
 * One converter behind the mirror file, the git diff driver and the
 * Compare-with-HEAD command, so all three read the same document the same way.
 * mammoth.extractRawText already puts one paragraph per line, which is what
 * keeps a one-word edit to a single changed line in a diff.
 */
export async function docxToDiffText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { value } = await mammoth.extractRawText({ buffer });
  return value;
}
