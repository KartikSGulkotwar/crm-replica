import { Fragment, ReactNode } from 'react';
import { Link } from 'react-router-dom';

/**
 * A small, safe Markdown renderer for assistant answers: paragraphs, bullet and numbered
 * lists, **bold**, `code` and [links](url). It builds React elements (never raw HTML), and only
 * links to in-app paths or http(s) URLs.
 */
export function Markdown({ text, onNavigate }: { text: string; onNavigate?: () => void }) {
  const blocks: ReactNode[] = [];
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const bullet = /^\s*[-*•]\s+(.*)$/;
    const numbered = /^\s*\d+[.)]\s+(.*)$/;
    const list = bullet.test(line) ? bullet : numbered.test(line) ? numbered : null;
    if (list) {
      const items: string[] = [];
      while (i < lines.length && list.test(lines[i])) items.push(list.exec(lines[i++])![1]);
      const Tag = list === bullet ? 'ul' : 'ol';
      blocks.push(
        <Tag
          key={blocks.length}
          className={`space-y-1 pl-5 ${Tag === 'ul' ? 'list-disc' : 'list-decimal'}`}
        >
          {items.map((item, n) => (
            <li key={n}>{inline(item, onNavigate)}</li>
          ))}
        </Tag>,
      );
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      blocks.push(
        <p key={blocks.length} className="font-semibold">
          {inline(heading[1], onNavigate)}
        </p>,
      );
      i++;
      continue;
    }
    const paragraph: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !bullet.test(lines[i]) &&
      !numbered.test(lines[i]) &&
      !/^#{1,6}\s/.test(lines[i])
    )
      paragraph.push(lines[i++]);
    blocks.push(
      <p key={blocks.length}>
        {paragraph.map((p, n) => (
          <Fragment key={n}>
            {n > 0 && <br />}
            {inline(p, onNavigate)}
          </Fragment>
        ))}
      </p>,
    );
  }
  return <div className="space-y-2 break-words">{blocks}</div>;
}

const INLINE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

function inline(text: string, onNavigate?: () => void): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const key = out.length;
    if (m[1] !== undefined)
      out.push(<SafeLink key={key} label={m[1]} href={m[2]} onNavigate={onNavigate} />);
    else if (m[3] !== undefined) out.push(<strong key={key}>{m[3]}</strong>);
    else
      out.push(
        <code key={key} className="rounded bg-raised px-1 text-[0.9em]">
          {m[4]}
        </code>,
      );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function SafeLink({
  label,
  href,
  onNavigate,
}: {
  label: string;
  href: string;
  onNavigate?: () => void;
}) {
  const className = 'font-medium text-accent underline-offset-2 hover:underline';
  if (href.startsWith('/') && !href.startsWith('//')) {
    return (
      <Link to={href} className={className} onClick={onNavigate}>
        {label}
      </Link>
    );
  }
  if (/^https?:\/\//i.test(href)) {
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
        {label}
      </a>
    );
  }
  return <>{label}</>;
}
