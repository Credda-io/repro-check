/**
 * A small, forgiving reader for the kind of Markdown people actually paste into
 * an issue tracker.
 *
 * It is not a Markdown implementation and does not try to be. It finds the
 * handful of structures the checks need -- code blocks, headings and the text
 * between them, images -- and it is deliberately biased towards *under*
 * reporting structure, because every check in this tool only ever complains
 * about something it could not find.
 */

/** A fenced or indented run of code found in the report. */
export interface CodeBlock {
  /** The fence's info string, lowercased, or `null` for an untagged block. */
  readonly lang: string | null;
  readonly body: string;
  /** 1-based line number of the block's first content line. */
  readonly startLine: number;
  readonly fenced: boolean;
  /** Nearest non-empty line above the block, trimmed, if there is one. */
  readonly intro: string | null;
}

/** A heading and the text beneath it, up to the next heading. */
export interface Section {
  /** Heading text with markers removed, e.g. `Steps to reproduce`. */
  readonly heading: string;
  /**
   * How the heading was written. `label` is the weakest of the three -- a bare
   * `Something:` line -- so checks that could be noisy require more of it.
   */
  readonly kind: 'atx' | 'bold' | 'label';
  /** 1-based line number of the heading itself. */
  readonly headingLine: number;
  /** Everything under the heading up to the next one, verbatim. */
  readonly body: string;
}

/** The parsed shape of one issue body. */
export interface ParsedReport {
  readonly source: string;
  readonly lines: readonly string[];
  readonly blocks: readonly CodeBlock[];
  readonly sections: readonly Section[];
  /** The body with code blocks and HTML comments blanked out. */
  readonly prose: string;
  /** The contents of every `<!-- ... -->` in the body. */
  readonly htmlComments: readonly string[];
  /** Image references: Markdown images, `<img>` tags, bare image URLs. */
  readonly images: readonly string[];
}

const FENCE = /^(\s{0,3})(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const ATX_HEADING = /^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$/;
/** A bolded line on its own, which issue templates use as a heading. */
const BOLD_HEADING = /^\s{0,3}\*\*(.+?)\*\*:?\s*$/;
/** `Expected behaviour:` on its own line, another common template shape. */
const LABEL_HEADING = /^\s{0,3}([A-Za-z][A-Za-z0-9 /'-]{2,40}):\s*$/;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^)\s]+)/g;
const HTML_IMAGE = /<img\b[^>]*?\bsrc\s*=\s*["']([^"']+)["']/gi;
const BARE_IMAGE_URL = /\bhttps?:\/\/\S+\.(?:png|jpe?g|gif|webp|svg|mp4|mov)\b/gi;
const LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s/;

/**
 * Splits an issue body into the structures the checks read.
 *
 * Line endings are normalised, and every line index reported anywhere in this
 * tool is 1-based and refers to the body as the reporter wrote it.
 */
export function parseReport(source: string): ParsedReport {
  const normalized = source.replace(/\r\n?/g, '\n');
  const lines = normalized.split('\n');

  const blocks: CodeBlock[] = [];
  /** Lines consumed by a code block, so prose can exclude them. */
  const codeLines = new Set<number>();

  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const fence = FENCE.exec(line);
    if (fence) {
      const [, , marker, info] = fence;
      const closer = new RegExp(`^\\s{0,3}${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
      const body: string[] = [];
      codeLines.add(index);
      let cursor = index + 1;
      while (cursor < lines.length && !closer.test(lines[cursor] ?? '')) {
        body.push(lines[cursor] ?? '');
        codeLines.add(cursor);
        cursor += 1;
      }
      if (cursor < lines.length) codeLines.add(cursor);
      blocks.push({
        lang: info.length > 0 ? info.toLowerCase() : null,
        body: body.join('\n'),
        startLine: index + 2,
        fenced: true,
        intro: previousNonEmpty(lines, index),
      });
      index = cursor + 1;
      continue;
    }
    index += 1;
  }

  collectIndentedBlocks(lines, codeLines, blocks);

  const proseLines = lines.map((line, at) => (codeLines.has(at) ? '' : line));
  const withoutComments = blankHtmlComments(proseLines.join('\n'));

  return {
    source: normalized,
    lines,
    blocks: blocks.sort((a, b) => a.startLine - b.startLine),
    sections: readSections(lines, codeLines),
    prose: withoutComments,
    htmlComments: readHtmlComments(normalized),
    images: readImages(normalized),
  };
}

function previousNonEmpty(lines: readonly string[], from: number): string | null {
  for (let at = from - 1; at >= 0; at -= 1) {
    const candidate = (lines[at] ?? '').trim();
    if (candidate.length > 0) return candidate;
  }
  return null;
}

/**
 * Four-space indented runs, which is how a lot of older reports paste code.
 *
 * A run that begins with a list marker is skipped: in practice that is a nested
 * list item far more often than it is a program, and mistaking prose for code
 * would let the code-shaped checks say things about a sentence.
 */
function collectIndentedBlocks(
  lines: readonly string[],
  codeLines: Set<number>,
  blocks: CodeBlock[],
): void {
  let at = 0;
  while (at < lines.length) {
    if (codeLines.has(at) || !isIndentedCode(lines[at] ?? '')) {
      at += 1;
      continue;
    }
    if (at > 0 && (lines[at - 1] ?? '').trim().length > 0) {
      at += 1;
      continue;
    }
    const start = at;
    const body: string[] = [];
    while (at < lines.length && !codeLines.has(at) && (isIndentedCode(lines[at] ?? '') || (lines[at] ?? '').trim().length === 0)) {
      body.push((lines[at] ?? '').replace(/^ {4}|^\t/, ''));
      at += 1;
    }
    while (body.length > 0 && (body[body.length - 1] ?? '').trim().length === 0) body.pop();
    if (body.length < 2 || LIST_MARKER.test(body[0] ?? '')) continue;
    for (let mark = start; mark < start + body.length; mark += 1) codeLines.add(mark);
    blocks.push({
      lang: null,
      body: body.join('\n'),
      startLine: start + 1,
      fenced: false,
      intro: previousNonEmpty(lines, start),
    });
  }
}

function isIndentedCode(line: string): boolean {
  return (/^ {4}\S/.test(line) || /^\t\S/.test(line)) && !LIST_MARKER.test(line);
}

function readSections(lines: readonly string[], codeLines: ReadonlySet<number>): Section[] {
  const sections: Section[] = [];
  let current: { heading: string; kind: Section['kind']; headingLine: number; body: string[] } | null = null;

  const flush = (): void => {
    if (current === null) return;
    sections.push({
      heading: current.heading,
      kind: current.kind,
      headingLine: current.headingLine,
      body: current.body.join('\n').trim(),
    });
    current = null;
  };

  for (const [at, line] of lines.entries()) {
    if (codeLines.has(at)) {
      current?.body.push(line);
      continue;
    }
    const heading = headingText(line);
    if (heading !== null) {
      flush();
      current = { heading: heading.text, kind: heading.kind, headingLine: at + 1, body: [] };
      continue;
    }
    current?.body.push(line);
  }
  flush();
  return sections;
}

function headingText(line: string): { text: string; kind: Section['kind'] } | null {
  const atx = ATX_HEADING.exec(line);
  if (atx) return { text: atx[2].replace(/[*_`]/g, '').trim(), kind: 'atx' };
  const bold = BOLD_HEADING.exec(line);
  if (bold) return { text: bold[1].replace(/[*_`]/g, '').trim(), kind: 'bold' };
  const label = LABEL_HEADING.exec(line);
  if (label && !/\bhttps?$/i.test(label[1])) return { text: label[1].trim(), kind: 'label' };
  return null;
}

/** Replaces comment bodies with spaces, so offsets and line counts survive. */
function blankHtmlComments(text: string): string {
  return text.replace(/<!--[\s\S]*?(?:-->|$)/g, (match) => match.replace(/[^\n]/g, ' '));
}

function readHtmlComments(text: string): string[] {
  const found: string[] = [];
  const pattern = /<!--([\s\S]*?)-->/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) found.push(match[1].trim());
  return found;
}

function readImages(text: string): string[] {
  const found = new Set<string>();
  for (const pattern of [MARKDOWN_IMAGE, HTML_IMAGE]) {
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) found.add(match[1]);
  }
  BARE_IMAGE_URL.lastIndex = 0;
  let bare: RegExpExecArray | null;
  while ((bare = BARE_IMAGE_URL.exec(text)) !== null) found.add(bare[0]);
  return [...found];
}

/** Shortens text for use inside a message, on one line. */
export function excerpt(text: string, limit = 90): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= limit ? flat : `${flat.slice(0, limit - 1)}…`;
}
