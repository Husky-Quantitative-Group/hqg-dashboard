import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { useStrategyWorkspace } from "./layout";

const CodeRenderer = ({ inline, className, children, ...props }: any) => {
  if (inline) {
    return (
      <code className="rounded bg-slate-900/60 px-1 py-0.5 text-[0.85em] text-fuchsia-200" {...props}>
        {children}
      </code>
    );
  }
  return (
    <pre className="rounded-xl bg-slate-900/80 p-4 text-slate-200">
      <code className={className}>{children}</code>
    </pre>
  );
};

const markdownComponents: Components = {
  code: CodeRenderer,
  h1: ({ children }) => <h1 className="text-2xl font-semibold text-white">{children}</h1>,
  h2: ({ children }) => <h2 className="text-xl font-semibold text-white">{children}</h2>,
  h3: ({ children }) => <h3 className="text-lg font-semibold text-white">{children}</h3>,
  p: ({ children }) => <p className="text-slate-300">{children}</p>,
  ul: ({ children }) => <ul className="ml-5 list-disc text-slate-300">{children}</ul>,
  ol: ({ children }) => <ol className="ml-5 list-decimal text-slate-300">{children}</ol>,
  li: ({ children }) => <li className="mb-1">{children}</li>,
};

export default function StrategyOverview() {
  const { strategy, handleRun, isRunning, files } = useStrategyWorkspace();
  const navigate = useNavigate();

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

  const surface = "border border-slate-800 bg-slate-950/40";
  const labelColor = "text-slate-400";
  const mutedColor = "text-slate-400";
  const badgeClass = "border-fuchsia-500/40 bg-fuchsia-500/10 text-fuchsia-200";
  const quickButtonClass =
    "w-full rounded-xl border border-slate-600/60 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-900";
  const previewSurface = "border border-slate-800/60 bg-slate-950/60 text-slate-200";

  return (
    <div className="space-y-6">
      <section className="grid gap-5 lg:grid-cols-3">
        <div className={`col-span-2 rounded-2xl ${surface} p-6`}>
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
                <dt className={labelColor}>Project</dt>
                <dd className="text-base font-medium">
                  PRJ {strategy.projectId} · {strategy.projectName}
                </dd>
              </div>
              <div>
                <dt className={labelColor}>Created</dt>
                <dd>{formatter.format(new Date(strategy.createdAt))}</dd>
              </div>
              <div>
                <dt className={labelColor}>Updated</dt>
                <dd>{formatter.format(new Date(strategy.updatedAt))}</dd>
              </div>
            </dl>

            <div>
              <div className={`${labelColor} text-sm`}>Tags</div>
              <div className="mt-2 flex flex-wrap gap-2">
                {strategy.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${badgeClass}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className={`rounded-2xl ${surface} p-6`}>
          <h3 className="text-base font-semibold">Quick actions</h3>
          <p className={`mt-1 text-sm ${mutedColor}`}>Jump directly into the workspace or trigger a dry run.</p>
          <div className="mt-5 space-y-3">
            <button type="button" onClick={() => navigate("code")} className={quickButtonClass}>
              Open Code Workspace
            </button>
            <button
              type="button"
              onClick={handleRun}
              disabled={isRunning}
              className={`w-full rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                isRunning
                  ? "cursor-not-allowed opacity-60"
                  : "bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white"
              }`}
            >
              {isRunning ? "Running…" : "Run Strategy"}
            </button>
          </div>
          <p className={`mt-6 text-xs ${mutedColor}`}>
            Autosave keeps drafts synced; runs execute against mocked data so you can iterate safely.
          </p>
        </div>
      </section>

      <section className="grid gap-5">
        <article className={`rounded-2xl ${surface} p-6`}>
          <header className="flex items-center justify-between">
            <h3 className="text-base font-semibold">README.md</h3>
            <span className={`text-xs ${mutedColor}`}>Preview</span>
          </header>
          <div className={`mt-4 max-h-96 overflow-y-auto rounded-xl ${previewSurface} p-4`}>
            <div className="space-y-4 text-sm leading-relaxed text-slate-300">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                {files.find((file) => file.path.toLowerCase() === "readme.md")?.content ?? strategy.readme}
              </ReactMarkdown>
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
