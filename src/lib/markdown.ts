/**
 * A tiny, dependency-free Markdown parser.
 *
 * It intentionally produces a **token tree** instead of an HTML string: the
 * renderer maps tokens to React elements, which makes HTML injection (and the
 * need for a sanitiser) impossible by construction.
 *
 * Supported: ATX headings, paragraphs, fenced code, blockquotes, ordered and
 * unordered lists (including task lists), thematic breaks, and inline
 * `**bold**`, `_italic_`, `` `code` ``, `~~strike~~` and `[links](url)`.
 */

export type InlineToken =
  | { type: 'text'; value: string }
  | { type: 'strong'; value: string }
  | { type: 'em'; value: string }
  | { type: 'code'; value: string }
  | { type: 'strike'; value: string }
  | { type: 'link'; value: string; href: string };

export interface MarkdownListItem {
  content: InlineToken[];
  /** Present for task list items: `- [x] done`. */
  checked?: boolean;
}

export type MarkdownBlock =
  | { type: 'heading'; level: 1 | 2 | 3 | 4 | 5 | 6; content: InlineToken[] }
  | { type: 'paragraph'; content: InlineToken[] }
  | { type: 'list'; ordered: boolean; items: MarkdownListItem[] }
  | { type: 'quote'; lines: InlineToken[][] }
  | { type: 'code'; language: string; value: string }
  | { type: 'hr' };

const INLINE_PATTERN =
  /(`[^`]+`)|(\*\*[^*]+\*\*)|(__[^_]+__)|(\*[^*]+\*)|(_[^_]+_)|(~~[^~]+~~)|(!?\[[^\]]*\]\([^)\s]+\))/g;

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const FENCE_PATTERN = /^```\s*([\w+-]*)\s*$/;
const HR_PATTERN = /^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;
const QUOTE_PATTERN = /^\s{0,3}>\s?(.*)$/;
const LIST_PATTERN = /^(\s*)(?:([-*+])|(\d{1,9})[.)])\s+(.*)$/;
const TASK_PATTERN = /^\[([ xX])\]\s+(.*)$/;

/**
 * Only allow links that cannot execute script. Everything else is rendered as
 * plain text by the renderer.
 */
export function isSafeHref(href: string): boolean {
  const trimmed = href.trim();
  if (trimmed === '') return false;
  if (trimmed.startsWith('#') || trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return true;
  }
  return /^(?:https?:|mailto:|tel:)/i.test(trimmed);
}

/** Parse inline markdown into tokens. */
export function parseInline(source: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let cursor = 0;
  INLINE_PATTERN.lastIndex = 0;

  const pushText = (value: string) => {
    if (value.length === 0) return;
    const previous = tokens[tokens.length - 1];
    if (previous && previous.type === 'text') {
      previous.value += value;
      return;
    }
    tokens.push({ type: 'text', value });
  };

  for (let match = INLINE_PATTERN.exec(source); match !== null; match = INLINE_PATTERN.exec(source)) {
    pushText(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;
    const [raw, code, boldStar, boldUnderscore, emStar, emUnderscore, strike, link] = match;

    if (code) {
      tokens.push({ type: 'code', value: code.slice(1, -1) });
    } else if (boldStar) {
      tokens.push({ type: 'strong', value: boldStar.slice(2, -2) });
    } else if (boldUnderscore) {
      tokens.push({ type: 'strong', value: boldUnderscore.slice(2, -2) });
    } else if (emStar) {
      tokens.push({ type: 'em', value: emStar.slice(1, -1) });
    } else if (emUnderscore) {
      tokens.push({ type: 'em', value: emUnderscore.slice(1, -1) });
    } else if (strike) {
      tokens.push({ type: 'strike', value: strike.slice(2, -2) });
    } else if (link) {
      const matchGroups = /^!?\[([^\]]*)\]\(([^)\s]+)\)$/.exec(link);
      if (matchGroups) {
        const [, label, href] = matchGroups;
        if (isSafeHref(href)) {
          tokens.push({ type: 'link', value: label || href, href });
        } else {
          pushText(raw);
        }
      } else {
        pushText(raw);
      }
    }
    if (cursor >= source.length) break;
  }

  pushText(source.slice(cursor));
  return tokens;
}

/** Parse a markdown document into a block list. */
export function parseMarkdown(source: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (line.trim() === '') {
      index += 1;
      continue;
    }

    const fence = FENCE_PATTERN.exec(line);
    if (fence) {
      const language = fence[1] ?? '';
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !/^```/.test(lines[index])) {
        body.push(lines[index]);
        index += 1;
      }
      index += 1; // consume the closing fence (or run off the end)
      blocks.push({ type: 'code', language, value: body.join('\n') });
      continue;
    }

    const heading = HEADING_PATTERN.exec(line);
    if (heading) {
      const level = Math.min(6, heading[1].length) as 1 | 2 | 3 | 4 | 5 | 6;
      blocks.push({ type: 'heading', level, content: parseInline(heading[2].trim()) });
      index += 1;
      continue;
    }

    if (HR_PATTERN.test(line)) {
      blocks.push({ type: 'hr' });
      index += 1;
      continue;
    }

    if (QUOTE_PATTERN.test(line)) {
      const quoteLines: InlineToken[][] = [];
      while (index < lines.length) {
        const quoted = QUOTE_PATTERN.exec(lines[index]);
        if (!quoted) break;
        quoteLines.push(parseInline(quoted[1]));
        index += 1;
      }
      blocks.push({ type: 'quote', lines: quoteLines });
      continue;
    }

    if (LIST_PATTERN.test(line)) {
      const items: MarkdownListItem[] = [];
      let ordered = false;
      while (index < lines.length) {
        const item = LIST_PATTERN.exec(lines[index]);
        if (!item) break;
        ordered = Boolean(item[3]);
        const task = TASK_PATTERN.exec(item[4]);
        if (task) {
          items.push({ content: parseInline(task[2]), checked: task[1].toLowerCase() === 'x' });
        } else {
          items.push({ content: parseInline(item[4]) });
        }
        index += 1;
      }
      blocks.push({ type: 'list', ordered, items });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const paragraph: string[] = [];
    while (index < lines.length) {
      const candidate = lines[index];
      if (
        candidate.trim() === '' ||
        FENCE_PATTERN.test(candidate) ||
        HEADING_PATTERN.test(candidate) ||
        HR_PATTERN.test(candidate) ||
        QUOTE_PATTERN.test(candidate) ||
        LIST_PATTERN.test(candidate)
      ) {
        break;
      }
      paragraph.push(candidate.trim());
      index += 1;
    }
    blocks.push({ type: 'paragraph', content: parseInline(paragraph.join(' ')) });
  }

  return blocks;
}

/** Flatten a markdown document to plain text (used for previews and tests). */
export function markdownToPlainText(source: string): string {
  const inline = (tokens: InlineToken[]): string => tokens.map((token) => token.value).join('');
  return parseMarkdown(source)
    .map((block) => {
      switch (block.type) {
        case 'heading':
        case 'paragraph':
          return inline(block.content);
        case 'quote':
          return block.lines.map(inline).join(' ');
        case 'list':
          return block.items.map((item) => inline(item.content)).join(' ');
        case 'code':
          return block.value;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n');
}
