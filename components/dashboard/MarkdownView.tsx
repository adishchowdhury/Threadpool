"use client";

import { useState, type ComponentProps } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

// Fenced ```code``` blocks render as <pre><code class="language-x">…</code></pre>;
// a bare `inline` code span has no `language-*` class and no surrounding <pre>.
function CodeBlock({ className, children, ...props }: ComponentProps<"code">) {
  const match = /language-(\w+)/.exec(className ?? "");
  const [copied, setCopied] = useState(false);

  if (!match) {
    return (
      <code className={cn("rounded bg-panel-elevated px-1 py-0.5 font-mono text-[0.85em]", className)} {...props}>
        {children}
      </code>
    );
  }

  const text = String(children).replace(/\n$/, "");

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard access denied - nothing to recover from here
    }
  }

  return (
    <div className="group/code relative my-3 overflow-hidden rounded-xl border border-panel-border bg-[#0d1117] last:mb-0">
      <div className="flex items-center justify-between border-b border-white/10 px-3.5 py-1.5 text-xs text-white/50">
        <span className="font-mono">{match[1]}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 transition-colors hover:bg-white/10 hover:text-white/90"
        >
          {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto px-3.5 py-3 text-[0.82em] leading-relaxed">
        <code className={className} {...props}>
          {children}
        </code>
      </pre>
    </div>
  );
}

export function MarkdownView({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "max-w-none",
        "[&_p]:mb-3 [&_p]:leading-relaxed [&_p:last-child]:mb-0",
        "[&_h1]:mt-5 [&_h1]:mb-2 [&_h1]:text-xl [&_h1]:font-semibold [&_h1:first-child]:mt-0",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-lg [&_h2]:font-semibold [&_h2:first-child]:mt-0",
        "[&_h3]:mt-4 [&_h3]:mb-1.5 [&_h3]:text-base [&_h3]:font-semibold [&_h3:first-child]:mt-0",
        "[&_h4]:mt-3 [&_h4]:mb-1 [&_h4]:text-sm [&_h4]:font-semibold [&_h5]:mt-3 [&_h5]:mb-1 [&_h5]:text-sm [&_h5]:font-semibold [&_h6]:mt-3 [&_h6]:mb-1 [&_h6]:text-sm [&_h6]:font-semibold",
        "[&_ul]:mb-3 [&_ul]:ml-5 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul:last-child]:mb-0",
        "[&_ol]:mb-3 [&_ol]:ml-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol:last-child]:mb-0",
        "[&_li]:leading-relaxed [&_li>ul]:mt-1 [&_li>ol]:mt-1",
        "[&_a]:underline [&_a]:underline-offset-2 [&_a]:decoration-muted-foreground/50 hover:[&_a]:decoration-foreground",
        "[&_strong]:font-semibold",
        "[&_hr]:my-4 [&_hr]:border-panel-border",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-panel-border [&_blockquote]:pl-3.5 [&_blockquote]:italic [&_blockquote]:text-muted-foreground",
        "[&_img]:my-3 [&_img]:max-w-full [&_img]:rounded-lg",
        "[&_table]:w-full [&_table]:border-collapse [&_table]:text-left [&_table]:text-[0.85em]",
        "[&_th]:border-b [&_th]:border-panel-border [&_th]:bg-panel-elevated [&_th]:px-2.5 [&_th]:py-1.5 [&_th]:font-semibold",
        "[&_td]:border-b [&_td]:border-panel-border [&_td]:px-2.5 [&_td]:py-1.5 [&_td]:align-top [&_tr:last-child>td]:border-0",
        "[&_.table-wrap]:my-3 [&_.table-wrap]:overflow-x-auto [&_.table-wrap]:rounded-md [&_.table-wrap]:border [&_.table-wrap]:border-panel-border [&_.table-wrap:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: false, ignoreMissing: true }]]}
        components={{
          code: CodeBlock,
          pre: ({ children }) => <>{children}</>,
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
