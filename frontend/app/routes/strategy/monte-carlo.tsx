import { useStrategyWorkspace } from "./layout";

export default function StrategyMonteCarlo() {
  const { strategy } = useStrategyWorkspace();

  return (
    <div className="min-h-[60vh] rounded-3xl border border-outline-variant/20 bg-surface-container-highest/60 p-10 text-on-surface">
      <div className="space-y-4 text-center">
        <p className="text-sm font-semibold uppercase tracking-[0.3em] text-secondary">Monte-Carlo</p>
        <h1 className="text-3xl font-headline font-bold">{strategy?.name || "Strategy"}</h1>
        <p className="max-w-2xl mx-auto text-sm text-on-surface/80">
          This page is coming soon. Monte-Carlo analysis will be available here once the feature is ready.
        </p>
      </div>
    </div>
  );
}
