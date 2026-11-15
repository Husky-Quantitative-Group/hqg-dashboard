import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useStrategyWorkspace } from "./layout";
import { strategyMarkdownComponents } from "./markdownComponents";

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
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={strategyMarkdownComponents}>
              {readmeContent}
            </ReactMarkdown>
          </article>
        </div>
      </section>
    </div>
  );
}
