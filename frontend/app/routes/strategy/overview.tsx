import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useMemo } from "react";
import { useStrategyWorkspace } from "./layout";

const markdownComponents: Components = {
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded-2xl border border-white/10 bg-[#0a1220] px-5 py-4 text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
      {children}
    </pre>
  ),
  code: ({ className, children, ...props }) =>
    className ? (
      <code className={`font-mono text-[0.92em] text-slate-100 ${className}`} {...props}>
        {children}
      </code>
    ) : (
      <code
        className="rounded-md bg-white/[0.06] px-1.5 py-0.5 font-mono text-[0.9em] text-cyan-200"
        {...props}
      >
        {children}
      </code>
    ),
  hr: () => <hr className="border-white/10" />,
  h1: ({ children }) => <h1 className="text-3xl font-semibold tracking-tight text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="text-2xl font-semibold tracking-tight text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xl font-semibold tracking-tight text-white">{children}</h3>,
  p: ({ children }) => <p className="leading-8 text-slate-300">{children}</p>,
  ul: ({ children }) => <ul className="ml-6 list-disc space-y-2 text-slate-300 marker:text-slate-500">{children}</ul>,
  ol: ({ children }) => <ol className="ml-6 list-decimal space-y-2 text-slate-300 marker:text-slate-500">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-100">{children}</strong>,
};

export default function StrategyOverview() {
  const { strategy, files } = useStrategyWorkspace();

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    []
  );
  const labelColor = "text-slate-400";
  const mutedColor = "text-slate-400";
  const badgeClass = "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
  const previewSurface = "border border-white/10 bg-black/10 text-slate-200";

  return (
    <div className="divide-y divide-white/10">
      <section className="pb-8">
        <div className="px-1 py-1">
          <header className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.4em] text-slate-500">Overview</p>
              <h2 className="text-2xl font-semibold tracking-tight">{strategy.name}</h2>
            </div>
            <div className={`text-xs ${mutedColor}`}>Strategy ID · STR {strategy.id}</div>
          </header>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <dl className="space-y-3 text-sm">
              <div>
                <dt className={labelColor}>Owner</dt>
                <dd className="text-base font-medium">{strategy.owner}</dd>
              </div>
              <div>
                <dt className={labelColor}>Created</dt>
                <dd>{strategy.created_at ? formatter.format(new Date(strategy.created_at)) : "-"}</dd>
              </div>
              <div>
                <dt className={labelColor}>Updated</dt>
                <dd>{strategy.updated_at ? formatter.format(new Date(strategy.updated_at)) : "-"}</dd>
              </div>
              <div>
                <dt className={labelColor}>Description</dt>
                <dd className="text-base font-medium text-slate-200">
                  {strategy.description?.trim() ? strategy.description : <span className="text-slate-500">No description</span>}
                </dd>
              </div>
            </dl>

            <div>
              <div>
                <dt className={labelColor}>Tags</dt>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {strategy.tags?.length ? (
                  strategy.tags.map((tag) => (
                    <span
                      key={tag}
                      className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}
                    >
                      {tag}
                    </span>
                  ))
                ) : (
                  <dd className="text-base font-medium text-slate-500">No tags</dd>
                )}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="pt-8">
        <article className="px-1">
          <header className="flex items-center justify-between">
            <h3 className="text-base font-semibold">README.md</h3>
            <span className={`text-xs ${mutedColor}`}>Preview</span>
          </header>
          <div className={`mt-4 rounded-[24px] ${previewSurface} p-6`}>
            <div className="space-y-6 text-sm text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {files.find((file) => file.path.toLowerCase() === "readme.md")?.content}
              </ReactMarkdown>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
