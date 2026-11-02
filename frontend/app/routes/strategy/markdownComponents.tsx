import type { Components } from "react-markdown";
import { PrismLight as SyntaxHighlighter } from "react-syntax-highlighter";
import oneDark from "react-syntax-highlighter/dist/esm/styles/prism/one-dark";
import bash from "react-syntax-highlighter/dist/esm/languages/prism/bash";
import javascript from "react-syntax-highlighter/dist/esm/languages/prism/javascript";
import json from "react-syntax-highlighter/dist/esm/languages/prism/json";
import jsx from "react-syntax-highlighter/dist/esm/languages/prism/jsx";
import python from "react-syntax-highlighter/dist/esm/languages/prism/python";
import sql from "react-syntax-highlighter/dist/esm/languages/prism/sql";
import tsx from "react-syntax-highlighter/dist/esm/languages/prism/tsx";
import typescript from "react-syntax-highlighter/dist/esm/languages/prism/typescript";

SyntaxHighlighter.registerLanguage("bash", bash);
SyntaxHighlighter.registerLanguage("sh", bash);
SyntaxHighlighter.registerLanguage("shell", bash);
SyntaxHighlighter.registerLanguage("javascript", javascript);
SyntaxHighlighter.registerLanguage("js", javascript);
SyntaxHighlighter.registerLanguage("json", json);
SyntaxHighlighter.registerLanguage("jsx", jsx);
SyntaxHighlighter.registerLanguage("python", python);
SyntaxHighlighter.registerLanguage("python3", python);
SyntaxHighlighter.registerLanguage("py", python);
SyntaxHighlighter.registerLanguage("sql", sql);
SyntaxHighlighter.registerLanguage("typescript", typescript);
SyntaxHighlighter.registerLanguage("ts", typescript);
SyntaxHighlighter.registerLanguage("tsx", tsx);

type CodeRendererProps = {
  className?: string;
  children?: React.ReactNode;
};

const CodeRenderer = ({ className, children, ...props }: CodeRendererProps) => {
  const content = String(children ?? "").replace(/\n$/, "");
  const isBlock = Boolean(className) || content.includes("\n");
  const languageMatch = /language-([\w-]+)/.exec(className ?? "");
  const language = languageMatch?.[1]?.toLowerCase();

  if (!isBlock) {
    return (
      <code
        className="rounded-md border border-outline-variant/20 bg-black/30 px-1.5 py-0.5 font-mono text-[0.9em] text-on-surface"
        {...props}
      >
        {content}
      </code>
    );
  }

  return (
    <SyntaxHighlighter
      language={language}
      style={oneDark}
      PreTag="div"
      customStyle={{
        margin: 0,
        padding: 0,
        background: "transparent",
        fontSize: "0.875rem",
        lineHeight: "1.5rem",
      }}
      codeTagProps={{
        className: `block whitespace-pre text-sm leading-6 ${className ?? ""}`.trim(),
      }}
      {...props}
    >
      {content}
    </SyntaxHighlighter>
  );
};

export const strategyMarkdownComponents: Components = {
  code: CodeRenderer,
  pre: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-outline-variant/10 bg-black/35 px-5 py-4">
      {children}
    </div>
  ),
  h1: ({ children }) => (
    <h1 className="scroll-m-20 text-3xl font-bold tracking-tight text-on-surface first:mt-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-8 border-b border-outline-variant/10 pb-2 text-2xl font-bold tracking-tight text-on-surface">
      {children}
    </h2>
  ),
  h3: ({ children }) => <h3 className="mt-6 text-xl font-bold tracking-tight text-on-surface">{children}</h3>,
  h4: ({ children }) => <h4 className="mt-5 text-lg font-semibold text-on-surface">{children}</h4>,
  h5: ({ children }) => (
    <h5 className="mt-4 text-xs font-bold uppercase tracking-[0.22em] text-secondary/80">{children}</h5>
  ),
  p: ({ children }) => <p className="text-[14px] leading-7 text-on-surface/85">{children}</p>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="font-medium text-secondary underline decoration-secondary/30 underline-offset-4 transition hover:text-on-surface hover:decoration-secondary/60"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="space-y-2 pl-5 text-[14px] leading-7 text-on-surface/85 marker:text-secondary">{children}</ul>,
  ol: ({ children }) => <ol className="space-y-2 pl-5 text-[14px] leading-7 text-on-surface/85 marker:text-secondary">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="rounded-r-xl border-l-4 border-secondary/60 bg-white/[0.03] px-4 py-2 italic text-on-surface/85">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-7 border-outline-variant/10" />,
  table: ({ children }) => (
    <div className="overflow-x-auto rounded-xl border border-outline-variant/10 bg-black/20">
      <table className="min-w-full border-collapse text-left text-sm text-on-surface/85">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-white/[0.04]">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => <tr className="border-t border-outline-variant/10">{children}</tr>,
  th: ({ children }) => <th className="px-4 py-2.5 font-semibold tracking-wide text-on-surface">{children}</th>,
  td: ({ children }) => <td className="px-4 py-2.5 align-top text-on-surface/80">{children}</td>,
  img: ({ src, alt }) => (
    <img
      src={src}
      alt={alt ?? ""}
      className="rounded-xl border border-outline-variant/10 shadow-[0_18px_50px_rgba(0,0,0,0.25)]"
    />
  ),
};
