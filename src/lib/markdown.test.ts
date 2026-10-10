import { describe, expect, it } from 'vitest';
import { isSafeHref, markdownToPlainText, parseInline, parseMarkdown } from '@/lib/markdown';

describe('markdown parser', () => {
  it('parses headings with the right level', () => {
    const blocks = parseMarkdown('# One\n\n### Three');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ type: 'heading', level: 1 });
    expect(blocks[1]).toMatchObject({ type: 'heading', level: 3 });
  });

  it('parses inline emphasis, code, strike and links', () => {
    const tokens = parseInline('a **bold** _em_ `code` ~~gone~~ [site](https://example.com)');
    expect(tokens.map((token) => token.type)).toEqual([
      'text',
      'strong',
      'text',
      'em',
      'text',
      'code',
      'text',
      'strike',
      'text',
      'link',
    ]);
    const link = tokens.at(-1);
    expect(link).toEqual({ type: 'link', value: 'site', href: 'https://example.com' });
  });

  it('refuses dangerous link targets', () => {
    expect(isSafeHref('javascript:alert(1)')).toBe(false);
    expect(isSafeHref('data:text/html;base64,PHN2Zz4=')).toBe(false);
    expect(isSafeHref('https://example.com')).toBe(true);
    expect(isSafeHref('#section')).toBe(true);
    expect(isSafeHref('/docs')).toBe(true);

    const tokens = parseInline('[click](javascript:alert(1))');
    expect(tokens.some((token) => token.type === 'link')).toBe(false);
    expect(tokens.map((token) => token.value).join('')).toContain('javascript:alert(1)');
  });

  it('parses task lists and ordered lists', () => {
    const [tasks] = parseMarkdown('- [x] done\n- [ ] todo');
    expect(tasks).toMatchObject({ type: 'list', ordered: false });
    if (tasks.type === 'list') {
      expect(tasks.items.map((item) => item.checked)).toEqual([true, false]);
    }

    const [ordered] = parseMarkdown('1. first\n2. second');
    expect(ordered).toMatchObject({ type: 'list', ordered: true });
  });

  it('parses fenced code, quotes and rules', () => {
    const blocks = parseMarkdown('```ts\nconst a = 1;\n```\n\n> quoted\n\n---');
    expect(blocks[0]).toMatchObject({ type: 'code', language: 'ts', value: 'const a = 1;' });
    expect(blocks[1]).toMatchObject({ type: 'quote' });
    expect(blocks[2]).toMatchObject({ type: 'hr' });
  });

  it('joins wrapped paragraph lines and flattens to text', () => {
    const blocks = parseMarkdown('first line\nsecond line');
    expect(blocks).toHaveLength(1);
    expect(markdownToPlainText('## Title\n\nSome **bold** text')).toBe('Title\nSome bold text');
  });

  it('returns nothing for an empty document', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('\n\n  \n')).toEqual([]);
  });
});
