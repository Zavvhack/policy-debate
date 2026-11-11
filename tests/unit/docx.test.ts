// .docx export and import.
// The exported file is unzipped and read back with the app's own reader, so
// these tests cover both directions and prove the two agree.
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { emptyCite } from '../../src/core/cards/cite';
import { setLevel, toParagraphs } from '../../src/core/cards/text';
import { buildDocx, documentXml, highlightHex, type DocItem, type ExportCard } from '../../src/core/docx/write';
import { docxToText, extractCards, paragraphText, readDocx } from '../../src/core/docx/read';
import { escapeXml, parseXml, stripInvalidXml, unescapeXml, descendants } from '../../src/core/docx/xml';
import { cardToHtml, cardToPlainText, escapeHtml, itemsToHtml } from '../../src/core/export/html';
import { defaultSettings } from '../../src/core/debate/topics';

const style = defaultSettings().highlight;
const wordStyle = { ...style, mode: 'word' as const };

const TEXT = 'Roughly 26 million Americans remain uninsured. That number is not falling.\nSubsidies expired & premiums rose <sharply> — “double digits”.';

function sampleCard(): ExportCard {
  let marks = setLevel(TEXT, [], 0, 46, 1); // first sentence underlined
  marks = setLevel(TEXT, marks, 8, 28, 2); // "26 million Americans" highlighted
  marks = setLevel(TEXT, marks, 36, 46, 3); // "uninsured." emphasis
  return {
    tag: [{ t: 'Coverage gaps are ' }, { t: 'not closing', u: true }],
    cite: { ...emptyCite('AB'), first: 'Maria', last: 'Okafor', year: '2026', date: '1/28', quals: 'professor at Example University', title: 'Why gaps persist', publication: 'Example Review', url: 'https://example.org/a?b=1&c=2' },
    text: TEXT,
    marks,
  };
}

/** Pull the run properties out of the generated XML for a piece of text. */
function runFor(xml: string, text: string): string {
  const at = xml.indexOf(`>${escapeXml(text)}</w:t>`);
  expect(at, `run containing "${text}"`).toBeGreaterThan(-1);
  return xml.slice(xml.lastIndexOf('<w:r>', at), at);
}

describe('card format in the exported file', () => {
  const xml = documentXml([{ kind: 'card', card: sampleCard(), side: 'neg' }], style);

  it('tag is Heading 4, bold, 13pt, with the key phrase underlined', () => {
    expect(xml).toContain('<w:pPr><w:pStyle w:val="Heading4"/></w:pPr>');
    const plain = runFor(xml, 'Coverage gaps are ');
    expect(plain).toContain('<w:b/>');
    expect(plain).toContain('<w:sz w:val="26"/>');
    expect(plain).not.toContain('<w:u ');
    expect(runFor(xml, 'not closing')).toContain('<w:u w:val="single"/>');
  });

  it('cite: last name and last two digits of the year are bold 13pt, the rest 11pt, ending //AB', () => {
    for (const big of ['Okafor,', '26']) {
      const r = runFor(xml, big);
      expect(r).toContain('<w:b/>');
      expect(r).toContain('<w:sz w:val="26"/>');
      expect(r).toContain('<w:rStyle w:val="Style13ptBold"/>');
    }
    for (const small of ['Maria ', '20', ' //AB']) {
      const r = runFor(xml, small);
      expect(r).not.toContain('<w:b/>');
      expect(r).toContain('<w:sz w:val="22"/>');
    }
    expect(xml).toContain('https://example.org/a?b=1&amp;c=2');
  });

  it('body: 7pt unread, 11pt underlined, 11pt underlined+highlighted, bold emphasis', () => {
    const unread = runFor(xml, ' That number is not falling.');
    expect(unread).toContain('<w:sz w:val="14"/>'); // 7pt
    expect(unread).not.toContain('<w:u ');
    const underlined = runFor(xml, 'Roughly ');
    expect(underlined).toContain('<w:u w:val="single"/>');
    expect(underlined).toContain('<w:sz w:val="22"/>');
    expect(underlined).not.toContain('w:fill=');
    const read = runFor(xml, '26 million Americans');
    expect(read).toContain('<w:u w:val="single"/>');
    expect(read).toContain('w:fill="FF9E9E"'); // neg = soft red
    expect(read).not.toContain('<w:b/>');
    const emphasis = runFor(xml, 'uninsured.');
    expect(emphasis).toContain('<w:b/>');
    expect(emphasis).toContain('<w:u w:val="single"/>');
    expect(emphasis).toContain('w:fill="FF9E9E"');
    expect(emphasis).toContain('<w:rStyle w:val="Emphasis"/>');
  });

  it('aff is blue; Word-palette mode uses real highlighters with cyan for aff', () => {
    const aff = documentXml([{ kind: 'card', card: sampleCard(), side: 'aff' }], style);
    expect(runFor(aff, '26 million Americans')).toContain('w:fill="8FD3FF"');
    const word = documentXml([{ kind: 'card', card: sampleCard(), side: 'aff' }], wordStyle);
    expect(runFor(word, '26 million Americans')).toContain('<w:highlight w:val="cyan"/>');
    expect(runFor(documentXml([{ kind: 'card', card: sampleCard(), side: 'neg' }], wordStyle), 'uninsured.')).toContain('<w:highlight w:val="red"/>');
    expect(highlightHex(wordStyle, 'aff')).toBe('#00FFFF');
    expect(highlightHex({ ...style, affColor: 'javascript:alert(1)' }, 'aff')).toBe('#8fd3ff'); // bad colours fall back
  });

  it('unread size is adjustable', () => {
    const small = documentXml([{ kind: 'card', card: sampleCard(), side: 'neg' }], { ...style, unreadPt: 6 });
    expect(runFor(small, ' That number is not falling.')).toContain('<w:sz w:val="12"/>');
  });

  it('run properties are in the order the file format requires', () => {
    const r = runFor(xml, 'uninsured.');
    const order = ['<w:rStyle', '<w:rFonts', '<w:b/>', '<w:sz ', '<w:u ', '<w:shd '].map((t) => r.indexOf(t));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const w = runFor(documentXml([{ kind: 'card', card: sampleCard(), side: 'neg' }], wordStyle), 'uninsured.');
    expect(w.indexOf('<w:highlight')).toBeLessThan(w.indexOf('<w:u '));
    expect(w.indexOf('<w:sz ')).toBeLessThan(w.indexOf('<w:highlight'));
  });
});

describe('the file itself', () => {
  it('is a valid zip with the parts Word needs, and well-formed XML', async () => {
    const bytes = await buildDocx([{ kind: 'heading', level: 3, text: '2AC — Econ DA' }, { kind: 'card', card: sampleCard(), side: 'aff' }, { kind: 'text', text: '1. No link\n2. Turn' }], style);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).sort()).toEqual(['[Content_Types].xml', '_rels/', '_rels/.rels', 'word/', 'word/_rels/', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml'].sort());
    for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels']) {
      const xml = await zip.file(name)!.async('string');
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      expect(doc.querySelector('parsererror'), `${name} parses`).toBeNull();
      // Every opening tag is closed: a quick structural check with our own parser.
      const opens = (xml.match(/<[A-Za-z][^>]*[^/]>/g) ?? []).length;
      const closes = (xml.match(/<\/[^>]+>/g) ?? []).length;
      expect(opens, `${name} is balanced`).toBe(closes);
    }
    const styles = await zip.file('word/styles.xml')!.async('string');
    for (const id of ['Heading1', 'Heading2', 'Heading3', 'Heading4', 'Style13ptBold', 'StyleUnderline', 'Emphasis']) expect(styles).toContain(`w:styleId="${id}"`);
    for (const alias of ['Pocket', 'Hat', 'Block', 'Tag']) expect(styles).toContain(`<w:aliases w:val="${alias}"/>`);
  });

  it('strips characters that would make Word call the file corrupt', async () => {
    const dirty = { ...sampleCard(), text: 'Bad\u0000 \u000Bchars\u001F here ￾ and a lone \uD83D surrogate, plus a real 🚀.', marks: [] };
    const xml = documentXml([{ kind: 'card', card: dirty, side: 'neg' }], style);
    expect(xml).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/);
    expect(xml).toContain('🚀');
    expect(stripInvalidXml('a\uD83Db')).toBe('ab');
    expect(new DOMParser().parseFromString(xml, 'application/xml').querySelector('parsererror')).toBeNull();
  });

  it('escapes text so it cannot break out of the XML', () => {
    const evil = { ...sampleCard(), tag: [{ t: '</w:t></w:r></w:p><w:p>injected "&' }] };
    const xml = documentXml([{ kind: 'card', card: evil, side: 'neg' }], style);
    expect(xml).toContain('&lt;/w:t&gt;&lt;/w:r&gt;&lt;/w:p&gt;&lt;w:p&gt;injected &quot;&amp;');
    expect(unescapeXml(escapeXml('a < b && c > "d"'))).toBe('a < b && c > "d"');
    expect(unescapeXml('&#x1F680;&#65;&apos;')).toBe("🚀A'");
  });
});

describe('export then import gives the same card back', () => {
  it('text, marks, tag and cite all survive', async () => {
    const card = sampleCard();
    const bytes = await buildDocx(
      [{ kind: 'heading', level: 1, text: 'Neg' }, { kind: 'heading', level: 3, text: 'Coverage' }, { kind: 'card', card, side: 'neg' }, { kind: 'text', text: 'An analytic line' }],
      style,
    );
    const file = extractCards(await readDocx(bytes));
    expect(file.cards).toHaveLength(1);
    const back = file.cards[0];
    expect(back.text).toBe(card.text); // character for character
    expect(back.marks).toEqual(card.marks);
    expect(back.tag).toEqual(card.tag);
    expect(back.citeRaw.map((p) => p.t).join('')).toBe('Maria Okafor, 2026 – professor at Example University, “Why gaps persist”, Example Review, 1/28, https://example.org/a?b=1&c=2 //AB');
    expect(back.citeRaw.filter((p) => p.big).map((p) => p.t)).toEqual(['Okafor,', '26']);
    expect(back.path).toEqual(['Neg', 'Coverage']);
    expect(file.outline.map((o) => o.kind)).toEqual(['heading', 'heading', 'card', 'text']);
    expect(file.outline[3]).toEqual({ kind: 'text', text: 'An analytic line' });
    // Same result in Word-highlighter mode.
    const again = extractCards(await readDocx(await buildDocx([{ kind: 'card', card, side: 'aff' }], wordStyle)));
    expect(again.cards[0].marks).toEqual(card.marks);
    // And what you would see on screen is identical.
    expect(toParagraphs(back.text, back.marks)).toEqual(toParagraphs(card.text, card.marks));
  });
});

describe('importing files made by other tools', () => {
  /** Build a minimal Verbatim-style document.xml by hand. */
  async function docx(body: string, styles = ''): Promise<Uint8Array> {
    const zip = new JSZip();
    zip.file('word/document.xml', `<?xml version="1.0"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`);
    if (styles) zip.file('word/styles.xml', `<?xml version="1.0"?><w:styles xmlns:w="x">${styles}</w:styles>`);
    return zip.generateAsync({ type: 'uint8array' });
  }
  const p = (inner: string, style = '') => `<w:p>${style ? `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>` : ''}${inner}</w:p>`;
  const r = (text: string, props = '') => `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;

  it('reads Verbatim character styles, highlights, and style-based headings', async () => {
    const styles =
      '<w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:aliases w:val="Tag"/><w:pPr><w:outlineLvl w:val="3"/></w:pPr></w:style>' +
      '<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:pPr><w:outlineLvl w:val="2"/></w:pPr></w:style>' +
      '<w:style w:type="character" w:styleId="StyleUnderline"><w:name w:val="Style Underline"/><w:rPr><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Emphasis"><w:name w:val="Emphasis"/><w:rPr><w:b/><w:u w:val="single"/></w:rPr></w:style>' +
      '<w:style w:type="character" w:styleId="Style13ptBold"><w:name w:val="Style 13 pt Bold"/><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style>';
    const body =
      p(r('Econ DA'), 'Heading3') +
      p(r('Spending tanks the economy'), 'Heading4') +
      p(r('Lee 25', '<w:rStyle w:val="Style13ptBold"/>') + r(' (Jo Lee, economist, “Title”, 3/4/2025, https://x.example)')) +
      p(r('Deficits ') + r('raise rates', '<w:rStyle w:val="StyleUnderline"/>') + r(' and ', '<w:rStyle w:val="StyleUnderline"/><w:highlight w:val="yellow"/>') + r('crash growth', '<w:rStyle w:val="Emphasis"/><w:highlight w:val="yellow"/>') + r('.', '<w:u w:val="none"/><w:rStyle w:val="StyleUnderline"/>')) +
      p(r('Second paragraph.', '<w:sz w:val="16"/>')) +
      p(r('Analytic: they dropped the link'), 'Heading4') +
      p(r('Next card tag'), 'Heading4') +
      p(r('Kim 2024', '<w:b/>') + r(' – professor')) +
      p(r('Shaded text', '<w:shd w:val="clear" w:fill="FFFF00"/>') + r(' white shading', '<w:shd w:val="clear" w:fill="FFFFFF"/>') + r(' bold only', '<w:b/>'));
    const file = extractCards(await readDocx(await docx(body, styles)));
    expect(file.cards).toHaveLength(2);
    const [a, b] = file.cards;
    expect(a.text).toBe('Deficits raise rates and crash growth.\nSecond paragraph.');
    expect(toParagraphs(a.text, a.marks)[0].runs.map((x) => [x.t, x.lv])).toEqual([
      ['Deficits ', 0],
      ['raise rates ', 1], // a space takes the lower level of its neighbours
      ['and ', 2],
      ['crash growth', 3],
      ['.', 0],
    ]);
    expect(a.last).toBe('Lee');
    expect(a.year).toBe('2025');
    expect(a.path).toEqual(['Econ DA']);
    expect(b.last).toBe('Kim');
    expect(b.year).toBe('2024');
    expect(toParagraphs(b.text, b.marks)[0].runs.map((x) => [x.t, x.lv])).toEqual([
      ['Shaded text', 2],
      [' white shading bold only', 0],
    ]);
    // The tag with nothing under it is kept as an analytic, in order.
    expect(file.outline).toEqual([
      { kind: 'heading', level: 3, text: 'Econ DA' },
      { kind: 'card', index: 0 },
      { kind: 'text', text: 'Analytic: they dropped the link' },
      { kind: 'card', index: 1 },
    ]);
  });

  it('skips deleted (tracked-change) text and reads through links and tables', async () => {
    const body =
      '<w:tbl><w:tr><w:tc>' + p(r('In a table. ') + '<w:del><w:r><w:delText>DELETED</w:delText></w:r></w:del>' + '<w:hyperlink>' + r('Linked text') + '</w:hyperlink>' + '<w:ins>' + r(' inserted') + '</w:ins>') + '</w:tc></w:tr></w:tbl>' +
      p('<w:r><w:t>Tab</w:t><w:tab/><w:t>bed &amp; &lt;escaped&gt;</w:t></w:r>');
    const paras = await readDocx(await docx(body));
    expect(paras.map(paragraphText)).toEqual(['In a table. Linked text inserted', 'Tab\tbed & <escaped>']);
    expect(docxToText(paras)).toBe('In a table. Linked text inserted\n\nTab\tbed & <escaped>');
  });

  it('gives a clear error for files that are not .docx', async () => {
    await expect(readDocx(new TextEncoder().encode('just some text'))).rejects.toThrow(/not a \.docx document/);
    const zip = new JSZip();
    zip.file('hello.txt', 'hi');
    await expect(readDocx(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/not a Word document/);
  });

  it('the XML reader copes with odd but legal input', () => {
    const tree = parseXml(`<?xml version="1.0"?><!-- c --><a x='1' y="two &amp; three"><b/><![CDATA[raw <text>]]><c>t</c></a>`);
    const a = tree.children[0];
    expect(a.attrs).toEqual({ x: '1', y: 'two & three' });
    expect(a.children.map((n) => n.name)).toEqual(['b', '#text', 'c']);
    expect(a.children[1].text).toBe('raw <text>');
    expect(descendants(tree, 'c')[0].children[0].text).toBe('t');
    expect(() => parseXml('<a><b></a></c><<<')).not.toThrow();
  });
});

describe('copying for Google Docs', () => {
  it('produces the same formatting as the .docx, as inline styles', () => {
    const html = cardToHtml(sampleCard(), 'neg', style);
    expect(html).toContain('<h4 style="font-family:Calibri,Carlito,Arial,sans-serif;font-size:13pt;font-weight:bold;margin:0">Coverage gaps are <u>not closing</u></h4>');
    expect(html).toContain('<b style="font-size:13pt">Okafor,</b>');
    expect(html).toContain('<span style="font-size:7pt;"> That number is not falling.</span>');
    expect(html).toContain('<span style="font-size:11pt;text-decoration:underline;background-color:#ff9e9e;">26 million Americans</span>');
    expect(html).toContain('<span style="font-size:11pt;text-decoration:underline;font-weight:bold;background-color:#ff9e9e;">uninsured.</span>');
  });

  it('never lets card text become live HTML', () => {
    const evil: ExportCard = { ...sampleCard(), tag: [{ t: '<img src=x onerror=alert(1)>' }], text: '<script>alert(1)</script> & more', marks: [], citeRaw: [{ t: '<b onmouseover=x>', big: true }] };
    const html = itemsToHtml([{ kind: 'card', card: evil, side: 'aff' }, { kind: 'text', text: '<iframe>' }, { kind: 'heading', level: 3, text: '<h1>' }], style);
    expect(html).not.toMatch(/<script|<img|<iframe|<b onmouseover/);
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; more');
    expect(escapeHtml(`"'<>&`)).toBe('&quot;&#39;&lt;&gt;&amp;');
  });

  it('has a plain-text version', () => {
    expect(cardToPlainText(sampleCard()).split('\n')[0]).toBe('Coverage gaps are not closing');
    const items: DocItem[] = [{ kind: 'text', text: 'x' }];
    expect(itemsToHtml(items, style)).toContain('>x</p>');
  });
});
