// Small XML helpers for reading and writing .docx files.
//
// A .docx is a zip of XML files. We write the XML by hand (it is short) and
// read it with the tiny parser below, which is enough for Word's files and
// works the same in every browser and in the tests.

/** Characters that are not allowed in XML at all. Pasted PDF text often contains them, and Word refuses files that do. */
const INVALID_XML = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;

export function stripInvalidXml(s: string): string {
  return s.replace(INVALID_XML, '');
}

/** Make text safe to put inside XML. */
export function escapeXml(s: string): string {
  return stripInvalidXml(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

export function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_, code: string) => {
    if (code === 'amp') return '&';
    if (code === 'lt') return '<';
    if (code === 'gt') return '>';
    if (code === 'quot') return '"';
    if (code === 'apos') return "'";
    const n = code[1] === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
    return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '';
  });
}

export interface XNode {
  /** Tag name including its prefix, e.g. "w:p". Text nodes are named "#text". */
  name: string;
  attrs: Record<string, string>;
  children: XNode[];
  /** Only for "#text" nodes. */
  text: string;
}

/**
 * Parse XML into a simple tree. Handles elements, attributes, text, CDATA,
 * comments and processing instructions. It does not validate; on damaged
 * input it returns what it could read rather than throwing.
 */
export function parseXml(xml: string): XNode {
  const root: XNode = { name: '#root', attrs: {}, children: [], text: '' };
  const stack: XNode[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
  for (let m; (m = re.exec(xml)); ) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      top.children.push({ name: '#text', attrs: {}, children: [], text: m[1] });
    } else if (m[2] !== undefined) {
      // Closing tag: pop back to the matching element (tolerates sloppy nesting).
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].name === m[2]) {
          stack.length = i;
          break;
        }
      }
    } else if (m[3] !== undefined) {
      const node: XNode = { name: m[3], attrs: {}, children: [], text: '' };
      const attrRe = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      for (let a; (a = attrRe.exec(m[4] ?? '')); ) node.attrs[a[1]] = unescapeXml(a[2] ?? a[3] ?? '');
      top.children.push(node);
      if (!m[5]) stack.push(node);
    } else if (m[6] !== undefined) {
      top.children.push({ name: '#text', attrs: {}, children: [], text: unescapeXml(m[6]) });
    }
  }
  return root;
}

/** First direct child with this tag name. */
export function child(node: XNode | undefined, name: string): XNode | undefined {
  return node?.children.find((c) => c.name === name);
}

/** Every descendant with this tag name, in document order. */
export function descendants(node: XNode, name: string, out: XNode[] = []): XNode[] {
  for (const c of node.children) {
    if (c.name === name) out.push(c);
    descendants(c, name, out);
  }
  return out;
}
