import { createHash } from 'node:crypto';
import * as mammoth from 'mammoth';

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (whole, code: string) => {
    if (code[0] !== '#') {
      return ENTITIES[code.toLowerCase()] ?? whole;
    }
    const point = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return String.fromCodePoint(point);
  });
}

function attr(tag: string, name: string): string {
  return decode(new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1] ?? '');
}

/**
 * Flattens mammoth's HTML into markdown-ish lines: one block per line, tables
 * as `| a | b |` rows, images as `![alt](image:<content hash>)` so a replaced
 * picture changes its line, headings, lists, links and emphasis marked.
 */
function htmlToLines(html: string): string {
  let out = '';
  const lists: { ordered: boolean; n: number }[] = [];
  let inCell = 0;
  const endLine = (): void => {
    if (inCell === 0 && out !== '' && !out.endsWith('\n')) {
      out += '\n';
    }
  };
  for (const match of html.matchAll(/<(\/?)(\w+)([^>]*)>|([^<]+)/g)) {
    const [, close, tag = '', rest = '', text] = match;
    if (text !== undefined) {
      out += decode(text);
      continue;
    }
    const closing = close === '/';
    switch (tag) {
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6':
        if (closing) {
          endLine();
        } else {
          out += `${'#'.repeat(Number(tag[1]))} `;
        }
        break;
      case 'p':
        if (closing) {
          endLine();
        }
        break;
      case 'ul': case 'ol':
        if (closing) {
          lists.pop();
        } else {
          lists.push({ ordered: tag === 'ol', n: 0 });
        }
        break;
      case 'li':
        if (closing) {
          endLine();
        } else {
          const list = lists[lists.length - 1];
          if (list) {
            list.n += 1;
          }
          out += `${'  '.repeat(Math.max(0, lists.length - 1))}${list?.ordered ? `${list.n}.` : '-'} `;
        }
        break;
      case 'table':
        endLine();
        break;
      case 'tr':
        if (closing) {
          endLine();
        } else {
          out += '|';
        }
        break;
      case 'td': case 'th':
        if (closing) {
          inCell -= 1;
          out += ' |';
        } else {
          inCell += 1;
          out += ' ';
        }
        break;
      case 'strong': out += '**'; break;
      case 'em': out += '*'; break;
      case 'br': out += ' '; break;
      case 'a':
        if (closing) {
          out += `](${pendingHref})`;
        } else {
          pendingHref = attr(rest, 'href');
          out += '[';
        }
        break;
      case 'img':
        out += `![${attr(rest, 'alt')}](${attr(rest, 'src')})`;
        break;
      default:
        break;
    }
  }
  return out.replace(/\n+$/, '') + '\n';
}
let pendingHref = '';

/**
 * One converter behind the companion file, the git diff driver and the
 * Compare-with-HEAD command, so all three read the same document the same way.
 * One block per line keeps a one-word edit to a single changed line.
 */
export async function docxToDiffText(bytes: Uint8Array): Promise<string> {
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const { value } = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const hash = createHash('sha1').update(await image.read()).digest('hex').slice(0, 8);
      return { src: `image:${hash}:${image.contentType}`, alt: (image as { altText?: string }).altText ?? '' };
    }),
  });
  return htmlToLines(value);
}
