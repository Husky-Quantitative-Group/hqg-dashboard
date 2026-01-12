import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  fetchStrategyWorkspace,
  saveStrategyWorkspaceDraft,
  startStrategyRunExecution,
  type StrategyArtifact,
  type StrategyFile,
  type BacktestResult,
  type WorkspaceStrategy,
} from "../../api";

type ToastVariant = "info" | "success" | "warning";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
};

export type StrategyWorkspaceContext = {
  strategy: WorkspaceStrategy;
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
  runs: BacktestResult[];
  selectedRunId: number | null;
  selectRun: (runId: number) => void;
  artifacts: StrategyArtifact[];
  addArtifactRecord: (artifact: Omit<StrategyArtifact, "id" | "updatedAt" | "addedBy">) => void;
  removeArtifactRecord: (artifactId: string) => void;
  addToast: (message: string, variant?: ToastVariant) => void;
};

const TABS = [
  { label: "Overview", to: ".", end: true },
  { label: "Code", to: "code" },
  { label: "Artifacts", to: "artifacts" },
  { label: "Backtest", to: "backtest" },
  { label: "Results", to: "results" },
];

function cloneFiles(items: StrategyFile[]): StrategyFile[] {
  return items.map((file) => ({ ...file }));
}

function cloneArtifacts(items: StrategyArtifact[]): StrategyArtifact[] {
  return items.map((artifact) => ({ ...artifact }));
}

export default function StrategyLayout() {
  const { strategyId = "1" } = useParams<{ strategyId?: string }>();
  const navigate = useNavigate();
  const [strategy, setStrategy] = useState<WorkspaceStrategy | null>(null);
  const [files, setFiles] = useState<StrategyFile[]>([]);
  const [artifacts, setArtifacts] = useState<StrategyArtifact[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestResult[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [autosaveMessage, setAutosaveMessage] = useState("All changes saved");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const entrypoint = useMemo(() => files.find((file) => file.isEntrypoint), [files]);

  const addToast = useCallback((message: string, variant: ToastVariant = "info") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, variant }]);
    setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 3400);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const loadWorkspace = async () => {
      setIsWorkspaceLoading(true);
      setLoadError(null);
      try {
        const payload = await fetchStrategyWorkspace(strategyId);
        if (cancelled) {
          return;
        }
        const fileSnapshot = cloneFiles(payload.strategy.files);
        const artifactSnapshot = cloneArtifacts(payload.strategy.artifacts);
        setStrategy(payload.strategy);
        setFiles(fileSnapshot);
        setArtifacts(artifactSnapshot);
        setSelectedFilePath(
          payload.strategy.files.find((file) => file.isEntrypoint)?.path ?? payload.strategy.files[0]?.path ?? null
        );
        setRuns(payload.runs);
        setSelectedRunId(payload.runs[0]?.id ?? null);
        setIsDirty(false);
        setAutosaveMessage("All changes saved");
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load strategy workspace", error);
        setLoadError("Failed to load strategy workspace");
        addToast("Unable to load strategy workspace", "warning");
      } finally {
        if (!cancelled) {
          setIsWorkspaceLoading(false);
        }
      }
    };

    void loadWorkspace();
    return () => {
      cancelled = true;
    };
  }, [addToast, strategyId]);

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

  const handleSave = useCallback(async () => {
    if (isSaving || !isDirty || !strategy) {
      return;
    }
    setIsSaving(true);
    setAutosaveMessage("Saving...");
    addToast("Saving workspace", "info");
    const snapshot = cloneFiles(files);
    const artifactSnapshot = cloneArtifacts(artifacts);
    try {
      const updatedStrategy = await saveStrategyWorkspaceDraft(strategy.id, {
        files: snapshot,
        artifacts: artifactSnapshot,
      });
      setStrategy(updatedStrategy);
      setIsDirty(false);
      setAutosaveMessage("All changes saved");
      addToast("Workspace saved", "success");
    } catch (error) {
      console.error("Failed to save workspace", error);
      setAutosaveMessage("Save failed");
      addToast("Save failed", "warning");
    } finally {
      setIsSaving(false);
    }
  }, [addToast, artifacts, files, isDirty, isSaving, strategy]);

  const handleRun = useCallback(() => {
    if (isRunning || !strategy) {
      return;
    }
    setIsRunning(true);
    const { draftRun, finalize } = startStrategyRunExecution(strategy.id, runs.length);
    setRuns((prev) => [draftRun, ...prev]);
    setSelectedRunId(draftRun.id);
    addToast("Run dispatched", "info");

    finalize()
      .then((completedRun) => {
        setRuns((prev) => prev.map((run) => (run.id === completedRun.id ? completedRun : run)));
        addToast(
          completedRun.metrics.netPnl >= 0 ? "Run completed" : "Run blocked by guardrail",
          completedRun.metrics.netPnl >= 0 ? "success" : "warning"
        );
      })
      .catch((error) => {
        console.error("Run failed to complete", error);
        setRuns((prev) => prev.filter((run) => run.id !== draftRun.id));
        addToast("Run failed to complete", "warning");
      })
      .finally(() => {
        setIsRunning(false);
      });
  }, [addToast, isRunning, runs.length, strategy]);

  const surface = "border border-slate-800/70 bg-slate-950/60";
  const navSurface = "bg-slate-900/60";
  const navBorder = "border-slate-800/50";

  const selectRun = useCallback((runId: number) => {
    setSelectedRunId(runId);
  }, []);

  const toastShelf = (
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
  );

  if (!strategy) {
    return (
      <div className="flex min-h-full flex-col gap-6 text-slate-100">
        <section className={`${surface} rounded-3xl px-6 py-5 shadow-xl`}>
          <p className="text-sm text-slate-400">
            {loadError ?? (isWorkspaceLoading ? "Loading strategy workspace..." : "No strategy data available.")}
          </p>
        </section>
        {toastShelf}
      </div>
    );
  }

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
            {strategy.projectId ? (
              <>
                <p className="text-base font-semibold text-white">{strategy.projectName}</p>
                <p className="text-xs text-slate-500">PRJ {strategy.projectId}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Not assigned</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isSaving || !isDirty}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                isSaving || !isDirty ? "cursor-not-allowed bg-slate-700/60 text-slate-300" : "bg-gradient-to-r from-fuchsia-600 to-indigo-500"
              }`}
            >
              Save New Version
            </button>
            <button
              type="button"
              onClick={() => navigate("/strategies")}
              className="rounded-xl border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:bg-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-300"
            >
              Close
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

      {toastShelf}
    </div>
  );
}

export function useStrategyWorkspace() {
  return useOutletContext<StrategyWorkspaceContext>();
}
