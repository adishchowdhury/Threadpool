import { Fragment, createElement } from "react";

function renderInline(text: string, keyPrefix: string) {
  const nodes: React.ReactNode[] = [];
  const pattern = /(\*\*(.+?)\*\*|`(.+?)`|\*(.+?)\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(lastIndex, match.index)}</Fragment>);
    }
    if (match[2] !== undefined) {
      nodes.push(<strong key={`${keyPrefix}-b${i++}`}>{match[2]}</strong>);
    } else if (match[3] !== undefined) {
      nodes.push(
        <code key={`${keyPrefix}-c${i++}`} className="rounded bg-panel-elevated px-1 py-0.5 font-mono text-[0.85em]">
          {match[3]}
        </code>,
      );
    } else if (match[4] !== undefined) {
      nodes.push(<em key={`${keyPrefix}-i${i++}`}>{match[4]}</em>);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    nodes.push(<Fragment key={`${keyPrefix}-t${i++}`}>{text.slice(lastIndex)}</Fragment>);
  }
  return nodes;
}

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let listItems: string[] | null = null;
  let listType: "ul" | "ol" | null = null;
  let paragraph: string[] = [];
  let blockIndex = 0;
  let tableRows: string[] = [];

  function flushTable() {
    if (tableRows.length === 0) return;
    const parse = (row: string) => row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    const rows = tableRows.filter((r) => !/^[\s|:-]+$/.test(r)).map(parse);
    tableRows = [];
    if (rows.length === 0) return;
    const [head, ...body] = rows;
    blocks.push(
      <div key={`table-${blockIndex++}`} className="mb-3 overflow-x-auto rounded-md border border-panel-border last:mb-0">
        <table className="w-full border-collapse text-left text-[0.85em]">
          <thead className="bg-panel-elevated">
            <tr>
              {head.map((cell, i) => (
                <th key={i} className="border-b border-panel-border px-2.5 py-1.5 font-semibold">
                  {renderInline(cell, `th-${blockIndex}-${i}`)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r} className="border-b border-panel-border last:border-0">
                {row.map((cell, i) => (
                  <td key={i} className="px-2.5 py-1.5 align-top">
                    {renderInline(cell, `td-${blockIndex}-${r}-${i}`)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    );
  }

  function flushParagraph() {
    if (paragraph.length) {
      const text = paragraph.join(" ").trim();
      if (text) {
        blocks.push(
          <p key={`p-${blockIndex++}`} className="mb-3 leading-relaxed last:mb-0">
            {renderInline(text, `p-${blockIndex}`)}
          </p>,
        );
      }
      paragraph = [];
    }
  }

  function flushList() {
    if (listItems && listItems.length) {
      const items = listItems.map((item, idx) => (
        <li key={`li-${blockIndex}-${idx}`} className="leading-relaxed">
          {renderInline(item, `li-${blockIndex}-${idx}`)}
        </li>
      ));
      blocks.push(
        listType === "ol" ? (
          <ol key={`list-${blockIndex++}`} className="mb-3 ml-5 list-decimal space-y-1 last:mb-0">
            {items}
          </ol>
        ) : (
          <ul key={`list-${blockIndex++}`} className="mb-3 ml-5 list-disc space-y-1 last:mb-0">
            {items}
          </ul>
        ),
      );
    }
    listItems = null;
    listType = null;
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();

    if (trimmed.startsWith("|") && trimmed.endsWith("|") && trimmed.length > 1) {
      flushParagraph();
      flushList();
      tableRows.push(trimmed);
      continue;
    }
    flushTable();

    const headingMatch = /^(#{1,6})\s+(.*)$/.exec(trimmed);
    const olMatch = /^(\d+)[.)]\s+(.*)$/.exec(trimmed);
    const ulMatch = /^[-*+]\s+(.*)$/.exec(trimmed);
    const hrMatch = /^(---|\*\*\*|___)$/.exec(trimmed);

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    if (hrMatch) {
      flushParagraph();
      flushList();
      blocks.push(<hr key={`hr-${blockIndex++}`} className="my-4 border-panel-border" />);
      continue;
    }

    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const text = headingMatch[2];
      const sizes: Record<number, string> = {
        1: "text-xl font-semibold mt-5 mb-2",
        2: "text-lg font-semibold mt-4 mb-2",
        3: "text-base font-semibold mt-4 mb-1.5",
        4: "text-sm font-semibold mt-3 mb-1",
        5: "text-sm font-semibold mt-3 mb-1",
        6: "text-sm font-semibold mt-3 mb-1",
      };
      const tagName = `h${Math.min(level, 6)}`;
      blocks.push(
        createElement(
          tagName,
          { key: `h-${blockIndex++}`, className: `${sizes[level]} first:mt-0` },
          renderInline(text, `h-${blockIndex}`),
        ),
      );
      continue;
    }

    if (olMatch) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
        listItems = [];
      }
      listItems!.push(olMatch[2]);
      continue;
    }

    if (ulMatch) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
        listItems = [];
      }
      listItems!.push(ulMatch[1]);
      continue;
    }

    flushList();
    paragraph.push(trimmed);
  }
  flushParagraph();
  flushList();
  flushTable();

  return <div className={className}>{blocks}</div>;
}
