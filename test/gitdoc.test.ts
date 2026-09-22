// Smallest self-check for the two pieces of real logic behind GitDoc's git
// story: converting a docx to diff-friendly text, and merging .gitattributes
// idempotently. Run with `node --test test/` (Node 22.6+ strips TS types
// natively, so this needs no build step and no test framework).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import JSZip from 'jszip';
import { docxToDiffText } from '../src/convert.ts';
import { missingAttributeLines } from '../src/gitAttributes.ts';

async function buildMinimalDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
      + '</Types>',
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
      + '</Relationships>',
  );
  const body = paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('');
  zip.file(
    'word/document.xml',
    '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
      + `<w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

void test('docxToDiffText puts one paragraph per line, so a one-word edit is a one-line diff', async () => {
  const before = await buildMinimalDocx(['Hello world', 'Second paragraph']);
  const after = await buildMinimalDocx(['Hello there', 'Second paragraph']);

  const beforeLines = (await docxToDiffText(before)).split('\n').filter((line) => line.trim() !== '');
  const afterLines = (await docxToDiffText(after)).split('\n').filter((line) => line.trim() !== '');

  assert.equal(beforeLines.length, 2);
  assert.equal(afterLines.length, 2);
  assert.equal(beforeLines[1], afterLines[1]);
  assert.notEqual(beforeLines[0], afterLines[0]);
});

void test('missingAttributeLines adds the diff=word lines once and is idempotent', () => {
  const first = missingAttributeLines('');
  assert.match(first, /\*\.docx diff=word/);
  assert.match(first, /\*\.docm diff=word/);
  assert.equal(missingAttributeLines(`existing content\n${first}`), '');
});

void test('missingAttributeLines only adds what is missing, keeping unrelated lines untouched', () => {
  const partial = 'custom.bin binary\n*.docx diff=word\n';
  const addition = missingAttributeLines(partial);
  assert.doesNotMatch(addition, /\*\.docx diff=word/);
  assert.match(addition, /\*\.docm diff=word/);
});
