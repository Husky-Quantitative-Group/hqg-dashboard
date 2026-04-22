import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useStrategyWorkspace } from "./layout";

type CodeRendererProps = {
  inline?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const CodeRenderer = ({ inline, children, ...props }: CodeRendererProps) => {
  if (inline) {
    return (
      <code
        className="rounded-md border border-outline-variant/20 bg-black/30 px-1.5 py-0.5 font-mono text-[0.9em] text-on-surface"
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <pre className="overflow-x-auto rounded-xl border border-outline-variant/10 bg-black/35 px-5 py-4">
      <code className="block whitespace-pre text-sm leading-6 text-on-surface/90">{children}</code>
    </pre>
  );
};

const markdownComponents: Components = {
  code: CodeRenderer,
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
      rel="noreferrer"
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

export default function StrategyOverview() {
  const { files, strategy } = useStrategyWorkspace();

  const readmeContent =
    files.find((file) => file.path.toLowerCase() === "readme.md")?.content ||
    `# ${strategy.name}\n\nNo README found.`;

  return (
    <div className="space-y-8">
      <section className="overflow-hidden rounded-xl border border-[rgba(148,163,184,.1)] ">
        <div className="flex items-center gap-3 border-b border-[rgba(148,163,184,0.1)] bg-[rgba(24,24,21,0.65)] px-8 py-4">
          <span className="material-symbols-outlined text-on-surface-variant/60">article</span>
          <div>
            <h3 className="font-headline font-bold text-sm tracking-tight text-on-surface">README.md</h3>
          </div>
        </div>

        <div className="bg-[#121215]/60 px-10 py-7">
          <article className="mx-auto max-w-5xl space-y-4">
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
              {readmeContent}
            </ReactMarkdown>
          </article>
        </div>
      </section>
    </div>
  );
}
