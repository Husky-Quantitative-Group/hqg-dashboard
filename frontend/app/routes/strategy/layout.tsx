import { NavLink, Outlet, useOutletContext } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";

type ToastVariant = "info" | "success" | "warning";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

export type StrategyFile = {
  path: string;
  language: string;
  content: string;
  isEntrypoint?: boolean;
};

export type ArtifactType = "dataset" | "document" | "model" | "config";

export type StrategyArtifact = {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  size: string;
  updatedAt: string;
  addedBy: string;
};

export type Strategy = {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  owner: string;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  files: StrategyFile[];
  artifacts: StrategyArtifact[];
  readme: string;
};

export type StrategyRun = {
  id: string;
  label: string;
  status: "passed" | "failed" | "running";
  startedAt: string;
  durationSeconds: number;
  summary: string;
  metrics: {
    netPnl: number;
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
    trades: number;
  };
  logs: string[];
  equityCurve: number[];
  drawdown: number[];
};

export type StrategyWorkspaceContext = {
  strategy: Strategy;
  files: StrategyFile[];
  entrypoint?: StrategyFile;
  selectedFilePath: string | null;
  selectFile: (path: string) => void;
  updateFileContent: (path: string, content: string) => void;
  isRunning: boolean;
  isSaving: boolean;
  isDirty: boolean;
  handleRun: () => void;
  handleSave: () => void;
  runs: StrategyRun[];
  selectedRunId: string | null;
  selectRun: (runId: string) => void;
  artifacts: StrategyArtifact[];
  addArtifactRecord: (artifact: Omit<StrategyArtifact, "id" | "updatedAt" | "addedBy">) => void;
  removeArtifactRecord: (artifactId: string) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
};

const MOCK_STRATEGY: Strategy = {
  id: 1,
  projectId: 1,
  projectName: "Aurora Initiative",
  name: "Alpha Scout",
  owner: "Morgan Ward",
  tags: ["mean reversion", "intraday"],
  description:
    "Adaptive intraday scalper that fades stretched order-book skew while respecting regime-specific guardrails.",
  createdAt: "2024-04-12T08:45:00Z",
  updatedAt: "2024-11-18T09:30:00Z",
  files: [
    {
      path: "main.py",
      language: "python",
      isEntrypoint: true,
      content: `from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class BuyAndHoldSpyIef(Strategy):
    def __init__(self):
        self._initialized = False

    def universe(self) -> list[str]:
        return ["SPY", "IEF"]

    def cadence(self) -> Cadence:
        return Cadence(
            bar_size=timedelta(weeks=1)
        )

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        if not self._initialized:
            self._initialized = True
            return {"SPY": 0.6, "IEF": 0.4}
        return None
`,
    },
    {
      path: "requirements.txt",
      language: "plaintext",
      content: "hqg_algorithms==0.1.0\n",
    },
    {
      path: "README.md",
      language: "markdown",
      content: `# Alpha Scout

Alpha Scout listens for stretched order-book skew during London and New York sessions.
It scales in using a ladder of passive orders and clips exposure as volatility spikes.

## Playbook
- Monitor imbalance > 15% during liquid sessions
- Fade skew with passive inventory
- Respect hard stop-loss and trailing take-profit via risk envelope

## Notes
Alpha Scout pairs well with volatility dampeners and produces shallow drawdowns when
the clip-size and cooldown are tuned to the venue micro-structure.`,
    },
  ],
  artifacts: [
    {
      id: "artifact-alpha-spec",
      name: "alpha-spec.yml",
      type: "config",
      description: "Entrypoint wiring for scheduler and risk envelope",
      size: "4 KB",
      updatedAt: "2024-11-17T11:00:00Z",
      addedBy: "Morgan Ward",
    },
    {
      id: "artifact-alpha-features",
      name: "alpha-features.parquet",
      type: "dataset",
      description: "Feature set used during imbalance detection",
      size: "18 MB",
      updatedAt: "2024-11-16T05:25:00Z",
      addedBy: "Morgan Ward",
    },
  ],
  readme: `# Alpha Scout

Alpha Scout listens for stretched order-book skew during London and New York sessions.
It scales in using a ladder of passive orders and clips exposure as volatility spikes.

## Playbook
- Monitor imbalance > 15% during liquid sessions
- Fade skew with passive inventory
- Respect hard stop-loss and trailing take-profit via risk envelope

## Notes
Alpha Scout pairs well with volatility dampeners and produces shallow drawdowns when
the clip-size and cooldown are tuned to the venue micro-structure.`,
};

const TABS = [
  { label: "Overview", to: ".", end: true },
  { label: "Code", to: "code" },
  { label: "Artifacts", to: "artifacts" },
  { label: "Results", to: "results" },
];

function cloneFiles(items: StrategyFile[]): StrategyFile[] {
  return items.map((file) => ({ ...file }));
}

function cloneArtifacts(items: StrategyArtifact[]): StrategyArtifact[] {
  return items.map((artifact) => ({ ...artifact }));
}

function createEquitySeries(seed: number): number[] {
  const base = 100_000 + seed * 800;
  const series: number[] = [];
  let cursor = base;

  for (let i = 0; i < 24; i += 1) {
    const wave = Math.sin(seed * 0.8 + i / 2.5) * 900;
    const drift = i * 320;
    cursor += drift * 0.3 + wave;
    series.push(Math.round(cursor));
  }

  return series;
}

function createDrawdownSeries(series: number[]): number[] {
  if (series.length === 0) {
    return [];
  }
  let peak = series[0];
  return series.map((value) => {
    peak = Math.max(peak, value);
    const drawdown = ((value - peak) / peak) * 100;
    return Number(drawdown.toFixed(2));
  });
}

function createMockRuns(seedKey: string | number): StrategyRun[] {
  const seedBase = seedKey.toString().length;
  const eqA = createEquitySeries(seedBase + 2);
  const eqB = createEquitySeries(seedBase + 6);
  const eqC = createEquitySeries(seedBase + 10);

  return [
    {
      id: `${seedKey}-run-a`,
      label: "LDN Sweep",
      status: "passed",
      startedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      durationSeconds: 148,
      summary: "Captured morning imbalance across majors",
      metrics: {
        netPnl: 12480,
        sharpe: 1.46,
        winRate: 0.58,
        maxDrawdown: 0.032,
        trades: 142,
      },
      logs: [
        "Bootstrapping workspace...",
        "Fetched book snapshots (24 instruments)",
        "Filled 68% of passive orders",
        "PnL locked, exiting gracefully",
      ],
      equityCurve: eqA,
      drawdown: createDrawdownSeries(eqA),
    },
    {
      id: `${seedKey}-run-b`,
      label: "NY Follow",
      status: "passed",
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      durationSeconds: 202,
      summary: "Extended rally fade with volatility targeting",
      metrics: {
        netPnl: 8450,
        sharpe: 1.18,
        winRate: 0.53,
        maxDrawdown: 0.041,
        trades: 96,
      },
      logs: [
        "Using cached features",
        "Volatility bucket raised to 2.1",
        "Submitted 4 ladder orders",
        "Hedged residual delta",
      ],
      equityCurve: eqB,
      drawdown: createDrawdownSeries(eqB),
    },
    {
      id: `${seedKey}-run-c`,
      label: "Asia Prep",
      status: "failed",
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      durationSeconds: 121,
      summary: "Stopped after liquidity guardrail tripped",
      metrics: {
        netPnl: -2450,
        sharpe: -0.38,
        winRate: 0.34,
        maxDrawdown: 0.066,
        trades: 54,
      },
      logs: [
        "Warm storage miss → rebuilding cache",
        "Spread tightened by 34%",
        "Guardrail tripped: liquidity <= 2",
        "Run halted by supervisor",
      ],
      equityCurve: eqC,
      drawdown: createDrawdownSeries(eqC),
    },
  ];
}

type ShortcutHandlers = {
  onSave: () => void;
  onRun: () => void;
};

function useKeyboardShortcuts({ onSave, onRun }: ShortcutHandlers) {
  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "s") {
        event.preventDefault();
        onSave();
      } else if (key === "r") {
        event.preventDefault();
        onRun();
      }
    };

    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [onSave, onRun]);
}

export default function StrategyLayout() {
  const strategy = MOCK_STRATEGY;
  const [files, setFiles] = useState<StrategyFile[]>(() => cloneFiles(strategy.files));
  const [lastSavedFiles, setLastSavedFiles] = useState<StrategyFile[]>(() => cloneFiles(strategy.files));
  const [artifacts, setArtifacts] = useState<StrategyArtifact[]>(() => cloneArtifacts(strategy.artifacts));
  const [lastSavedArtifacts, setLastSavedArtifacts] = useState<StrategyArtifact[]>(() => cloneArtifacts(strategy.artifacts));
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    strategy.files.find((file) => file.isEntrypoint)?.path ?? strategy.files[0]?.path ?? null
  );
  const initialRuns = useMemo(() => createMockRuns(strategy.id), [strategy.id]);
  const [runs, setRuns] = useState<StrategyRun[]>(initialRuns);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(initialRuns[0]?.id ?? null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [autosaveMessage, setAutosaveMessage] = useState("All changes saved");
  const [toasts, setToasts] = useState<Toast[]>([]);

  const entrypoint = useMemo(() => files.find((file) => file.isEntrypoint), [files]);

  const addToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3400);
  }, []);

  const markDirty = useCallback(() => {
    setIsDirty(true);
    setAutosaveMessage("Unsaved changes");
  }, []);

  const selectFile = useCallback((path: string) => {
    setSelectedFilePath(path);
  }, []);

  const updateFileContent = useCallback(
    (path: string, content: string) => {
      setFiles((prev) => prev.map((file) => (file.path === path ? { ...file, content } : file)));
      markDirty();
    },
    [markDirty]
  );

  const addArtifactRecord = useCallback(
    (artifact: Omit<StrategyArtifact, "id" | "updatedAt" | "addedBy">) => {
      const record: StrategyArtifact = {
        ...artifact,
        id: `artifact-${Date.now()}`,
        updatedAt: new Date().toISOString(),
        addedBy: "You",
      };
      setArtifacts((prev) => [record, ...prev]);
      markDirty();
      addToast(`Attached ${artifact.name}`, "success");
    },
    [addToast, markDirty]
  );

  const removeArtifactRecord = useCallback(
    (artifactId: string) => {
      setArtifacts((prev) => prev.filter((artifact) => artifact.id !== artifactId));
      markDirty();
      addToast("Artifact removed", "warning");
    },
    [addToast, markDirty]
  );

  const handleSave = useCallback(() => {
    if (isSaving || !isDirty) {
      return;
    }
    setIsSaving(true);
    setAutosaveMessage("Saving...");
    addToast("Saving workspace", "info");
    const snapshot = cloneFiles(files);
    const artifactSnapshot = cloneArtifacts(artifacts);
    setTimeout(() => {
      setLastSavedFiles(snapshot);
      setLastSavedArtifacts(artifactSnapshot);
      setIsSaving(false);
      setIsDirty(false);
      setAutosaveMessage("All changes saved");
      addToast("Workspace saved", "success");
    }, 900);
  }, [addToast, artifacts, files, isDirty, isSaving]);

  const handleRun = useCallback(() => {
    if (isRunning) {
      return;
    }
    setIsRunning(true);
    const runId = `${strategy.id}-run-${Date.now()}`;
    const seed = strategy.id + runs.length;
    const equityCurve = createEquitySeries(seed + 3);
    const draftRun: StrategyRun = {
      id: runId,
      label: "Manual run",
      status: "running",
      startedAt: new Date().toISOString(),
      durationSeconds: 0,
      summary: "Triggered from workspace",
      metrics: {
        netPnl: 0,
        sharpe: 0,
        winRate: 0.5,
        maxDrawdown: 0,
        trades: 0,
      },
      logs: ["Submitting job to runner..."],
      equityCurve,
      drawdown: createDrawdownSeries(equityCurve),
    };

    setRuns((prev) => [draftRun, ...prev]);
    setSelectedRunId(runId);
    addToast("Run dispatched", "info");

    setTimeout(() => {
      const outcome: "passed" | "failed" = Math.random() > 0.2 ? "passed" : "failed";
      const pnl = outcome === "passed" ? 6800 + Math.round(Math.random() * 3200) : -3200;
      const drawdown = outcome === "passed" ? 0.028 : 0.074;
      setRuns((prev) =>
        prev.map((run) =>
          run.id === runId
            ? {
                ...run,
                status: outcome,
                durationSeconds: 155,
                summary:
                  outcome === "passed"
                    ? "Orders filled and hedged via workspace"
                    : "Guardrail blocked exposure",
                metrics: {
                  netPnl: pnl,
                  sharpe: outcome === "passed" ? 1.04 : -0.22,
                  winRate: outcome === "passed" ? 0.61 : 0.29,
                  maxDrawdown: drawdown,
                  trades: outcome === "passed" ? 74 : 28,
                },
                logs:
                  outcome === "passed"
                    ? [
                        "Job started",
                        "Built 3 feature batches",
                        "Filled 92% of ladder",
                        "PnL persisted to vault",
                      ]
                    : [
                        "Job started",
                        "Volatility guardrail exceeded",
                        "Run halted",
                      ],
              }
            : run
        )
      );
      setIsRunning(false);
      addToast(
        outcome === "passed" ? "Run completed" : "Run blocked by guardrail",
        outcome === "passed" ? "success" : "warning"
      );
    }, 2200);
  }, [addToast, isRunning, runs.length, strategy.id]);

  useKeyboardShortcuts({ onSave: handleSave, onRun: handleRun });

  const surface = "border border-slate-800/70 bg-slate-950/60";
  const navSurface = "bg-slate-900/60";
  const navBorder = "border-slate-800/50";

  const selectRun = useCallback(
    (runId: string) => {
      setSelectedRunId(runId);
    },
    [setSelectedRunId]
  );

  const contextValue: StrategyWorkspaceContext = {
    strategy,
    files,
    entrypoint,
    selectedFilePath,
    selectFile,
    updateFileContent,
    isRunning,
    isSaving,
    isDirty,
    handleRun,
    handleSave,
    runs,
    selectedRunId,
    selectRun,
    artifacts,
    addArtifactRecord,
    removeArtifactRecord,
    addToast,
  };

  return (
    <div className="flex min-h-full flex-col gap-6 text-slate-100">
      <section className={`${surface} rounded-3xl px-6 py-5 shadow-xl`}> 
        <div className="flex flex-wrap items-center gap-5">
          <div className="flex-1 min-w-[220px]">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Strategy</p>
            <h1 className="text-3xl font-semibold tracking-tight">{strategy.name}</h1>
            <p className="mt-1 text-sm text-slate-400">Owned by {strategy.owner}</p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Project</p>
            <p className="text-base font-semibold text-white">{strategy.projectName}</p>
            <p className="text-xs text-slate-500">PRJ {strategy.projectId}</p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                handleSave();
                handleRun();
              }}
              disabled={isSaving || isRunning || !isDirty}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                isSaving || isRunning || !isDirty
                  ? "cursor-not-allowed opacity-60"
                  : "bg-gradient-to-r from-fuchsia-600 to-indigo-500"
              }`}
            >
              {isRunning ? "Running…" : "Save & Run"}
            </button>
            <button
              type="button"
              onClick={() => {
                handleSave();
                window.history.back();
              }}
              disabled={isSaving || !isDirty}
              className={`rounded-xl border px-4 py-2 text-sm font-semibold transition ${
                isSaving || !isDirty ? "cursor-not-allowed opacity-60" : "border-slate-600 hover:bg-slate-900"
              }`}
            >
              Save & Close
            </button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-slate-400">
          <span className="ml-auto text-xs font-medium text-emerald-400">
            {autosaveMessage}
          </span>
        </div>
      </section>

      <section className={`${surface} rounded-3xl shadow-xl`}> 
        <div className={`${navSurface} rounded-t-3xl border-b ${navBorder} px-4`}> 
          <nav className="flex items-center gap-3">
            {TABS.map((tab) => (
              <NavLink
                key={tab.label}
                to={tab.to}
                end={tab.end}
                className={({ isActive }) =>
                  `relative px-4 py-4 text-sm font-semibold transition ${
                    isActive ? "text-white" : "text-slate-400 hover:text-slate-200"
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    {tab.label}
                    <span
                      className={`absolute inset-x-3 -bottom-1 h-1 rounded-full transition ${
                        isActive ? "bg-gradient-to-r from-fuchsia-500 to-indigo-500" : "bg-transparent"
                      }`}
                    />
                  </>
                )}
              </NavLink>
            ))}
          </nav>
        </div>
        <div className="px-6 py-6">
          <Outlet context={contextValue} />
        </div>
      </section>

      <div className="pointer-events-none fixed right-6 top-6 z-50 space-y-3" aria-live="polite">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg ${
              toast.variant === "success"
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-100"
                : toast.variant === "warning"
                  ? "border-amber-500/40 bg-amber-500/15 text-amber-200"
                  : "border-slate-500/40 bg-slate-800/80 text-slate-100"
            }`}
          >
            {toast.message}
          </div>
        ))}
      </div>
    </div>
  );
}

export function useStrategyWorkspace() {
  return useOutletContext<StrategyWorkspaceContext>();
}
