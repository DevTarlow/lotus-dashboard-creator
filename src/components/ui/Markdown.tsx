import { Fragment, useMemo, type ReactNode } from 'react';
import { isSafeHref, parseMarkdown, type InlineToken } from '@/lib/markdown';
import { cn } from '@/lib/utils';

/**
 * Renders markdown without ever producing raw HTML — the parser returns tokens
 * and this component maps them to React elements, so user notes can not inject
 * markup.
 */
function InlineTokens({ tokens }: { tokens: readonly InlineToken[] }): ReactNode {
  return tokens.map((token, index) => {
    const key = `${token.type}-${index}`;
    switch (token.type) {
      case 'strong':
        return (
          <strong key={key} className="font-semibold text-slate-900 dark:text-white">
            {token.value}
          </strong>
        );
      case 'em':
        return (
          <em key={key} className="italic">
            {token.value}
          </em>
        );
      case 'strike':
        return (
          <span key={key} className="line-through opacity-70">
            {token.value}
          </span>
        );
      case 'code':
        return (
          <code
            key={key}
            className="rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[0.85em] text-violet-700 dark:bg-slate-800 dark:text-violet-300"
          >
            {token.value}
          </code>
        );
      case 'link':
        return isSafeHref(token.href) ? (
          <a
            key={key}
            href={token.href}
            target="_blank"
            rel="noreferrer noopener"
            className="font-medium text-violet-600 underline decoration-violet-300 underline-offset-2 transition hover:text-violet-500 dark:text-violet-400 dark:decoration-violet-500/50"
          >
            {token.value}
          </a>
        ) : (
          <Fragment key={key}>{token.value}</Fragment>
        );
      default:
        return <Fragment key={key}>{token.value}</Fragment>;
    }
  });
}

export interface MarkdownProps {
  source: string;
  className?: string;
  /** Rendered when the document is empty. */
  placeholder?: ReactNode;
}

export function Markdown({ source, className, placeholder }: MarkdownProps) {
  const blocks = useMemo(() => parseMarkdown(source), [source]);

  if (blocks.length === 0) {
    return (
      <p className="text-sm italic text-slate-400 dark:text-slate-500">
        {placeholder ?? 'Nothing written yet.'}
      </p>
    );
  }

  return (
    <div className={cn('space-y-2.5 text-sm leading-relaxed text-slate-600 dark:text-slate-300', className)}>
      {blocks.map((block, index) => {
        const key = `${block.type}-${index}`;
        switch (block.type) {
          case 'heading': {
            const sizes = {
              1: 'text-lg font-semibold',
              2: 'text-base font-semibold',
              3: 'text-sm font-semibold uppercase tracking-wide',
              4: 'text-sm font-semibold',
              5: 'text-xs font-semibold uppercase tracking-wide',
              6: 'text-xs font-semibold',
            } as const;
            const Heading = `h${block.level}` as 'h1';
            return (
              <Heading key={key} className={cn('text-slate-900 dark:text-white', sizes[block.level])}>
                <InlineTokens tokens={block.content} />
              </Heading>
            );
          }
          case 'paragraph':
            return (
              <p key={key}>
                <InlineTokens tokens={block.content} />
              </p>
            );
          case 'list':
            return block.ordered ? (
              <ol key={key} className="ml-4 list-decimal space-y-1">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`}>
                    <InlineTokens tokens={item.content} />
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={key} className="ml-4 list-disc space-y-1">
                {block.items.map((item, itemIndex) => (
                  <li key={`${key}-${itemIndex}`} className={item.checked === undefined ? undefined : 'list-none'}>
                    {item.checked === undefined ? null : (
                      <span
                        className={cn(
                          'mr-1.5 inline-flex h-3.5 w-3.5 translate-y-[1px] items-center justify-center rounded border text-[9px] font-bold',
                          item.checked
                            ? 'border-violet-500 bg-violet-500 text-white'
                            : 'border-slate-300 text-transparent dark:border-slate-600',
                        )}
                        aria-hidden="true"
                      >
                        ✓
                      </span>
                    )}
                    <InlineTokens tokens={item.content} />
                  </li>
                ))}
              </ul>
            );
          case 'quote':
            return (
              <blockquote
                key={key}
                className="border-l-2 border-violet-300 pl-3 italic text-slate-500 dark:border-violet-500/50 dark:text-slate-400"
              >
                {block.lines.map((line, lineIndex) => (
                  <p key={`${key}-${lineIndex}`}>
                    <InlineTokens tokens={line} />
                  </p>
                ))}
              </blockquote>
            );
          case 'code':
            return (
              <pre
                key={key}
                className="overflow-x-auto rounded-lg bg-slate-900 p-3 font-mono text-xs leading-relaxed text-slate-100 dark:bg-slate-950"
              >
                <code>{block.value}</code>
              </pre>
            );
          case 'hr':
            return <hr key={key} className="border-slate-200 dark:border-slate-700" />;
          default:
            return null;
        }
      })}
    </div>
  );
}
