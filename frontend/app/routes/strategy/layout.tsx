import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { fetchStrategyWorkspace, startStrategyRunExecution } from "./workspace";
import type { BacktestResult } from "./workspace";
import { fetchStrategyArtifactContent, uploadStrategyArtifacts, type StrategyFile } from "~/api/strategyArtifacts";
import type { BacktestResponse } from "~/api/backtest";
import { listBacktestRuns, type BacktestRunItem } from "~/api/backtestMetrics";
import { type Strategy } from "~/api/strategies";

type ToastVariant = "info" | "success" | "warning";

type Toast = {
  id: number;
  message: string;
  variant: ToastVariant;
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
  runs: BacktestResult[];
  selectedRunId: number | null;
  selectRun: (runId: number) => void;
  latestBacktestData: BacktestResponse | null;
  setLatestBacktestData: (data: BacktestResponse | null) => void;
  latestBacktestStrategyVersion: number | string | null;
  setLatestBacktestStrategyVersion: (version: number | string | null) => void;
  lastBacktestParamValues: Record<string, string>;
  setLastBacktestParamValues: (values: Record<string, string>) => void;
  activeBacktestSource: "live" | "saved" | null;
  activeSavedRunId: string | null;
  setActiveBacktestSource: (source: "live" | "saved" | null) => void;
  setActiveSavedRunId: (runId: string | null) => void;
  savedBacktestRuns: BacktestRunItem[];
  isSavedBacktestRunsLoading: boolean;
  refreshSavedBacktestRuns: () => Promise<void>;
  addToast: (message: string, variant?: ToastVariant) => void;
  loadingFilePath: string | null;
  fileLoadError: string | null;
  isWriteForbidden: boolean;
};

const TABS = [
  { label: "Overview", to: ".", end: true },
  { label: "Code", to: "code" },
  { label: "Backtest", to: "backtest" },
  { label: "Results", to: "results" },
];

function cloneFiles(items: StrategyFile[]): StrategyFile[] {
  return items.map((file) => ({ ...file }));
}

export default function StrategyLayout() {
  const { strategyId = "1" } = useParams<{ strategyId?: string }>();
  const navigate = useNavigate();
  const [strategy, setStrategy] = useState<Strategy | null>(null);
  const [files, setFiles] = useState<StrategyFile[]>([]);
  const initialFilesRef = useRef<StrategyFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [runs, setRuns] = useState<BacktestResult[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [autosaveMessage, setAutosaveMessage] = useState("All changes saved");
  const [isWriteForbidden, setIsWriteForbidden] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);
  const [loadedFilePaths, setLoadedFilePaths] = useState<string[]>([]);
  const [latestBacktestData, setLatestBacktestData] = useState<BacktestResponse | null>(null);
  const [latestBacktestStrategyVersion, setLatestBacktestStrategyVersion] = useState<number | string | null>(null);
  const [lastBacktestParamValues, setLastBacktestParamValues] = useState<Record<string, string>>({});
  const [activeBacktestSource, setActiveBacktestSource] = useState<"live" | "saved" | null>(null);
  const [activeSavedRunId, setActiveSavedRunId] = useState<string | null>(null);
  const [savedBacktestRuns, setSavedBacktestRuns] = useState<BacktestRunItem[]>([]);
  const [isSavedBacktestRunsLoading, setIsSavedBacktestRunsLoading] = useState(false);

  const refreshSavedBacktestRuns = useCallback(async () => {
    if (!strategy) return;
    setIsSavedBacktestRunsLoading(true);
    try {
      const savedRuns = await listBacktestRuns(strategy.id, { limit: 200 });
      setSavedBacktestRuns(savedRuns.items ?? []);

      const latest = savedRuns.items?.[0];
      const params = latest?.backtest_params;
      if (params) {
        setLastBacktestParamValues({
          name: params.name ?? "",
          startingEquity: params.initial_capital !== undefined ? String(params.initial_capital) : "",
          startDate: params.start_date ?? "",
          endDate: params.end_date ?? "",
        });
      }
    } catch (error) {
      console.error("Failed to load saved backtest runs", error);
    } finally {
      setIsSavedBacktestRunsLoading(false);
    }
  }, [strategy]);

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
      setIsWriteForbidden(true);
      try {
        const payload = await fetchStrategyWorkspace(strategyId);
        if (cancelled) {
          return;
        }
        setLatestBacktestData(null);
        setLatestBacktestStrategyVersion(null);
        setLastBacktestParamValues({});
        setActiveBacktestSource(null);
        setActiveSavedRunId(null);
        setSavedBacktestRuns([]);
        const fileSnapshot = cloneFiles(payload.files);
        setStrategy(payload.strategy);
        setFiles(fileSnapshot);
        initialFilesRef.current = cloneFiles(payload.files);
        setSelectedFilePath(
          payload.files.find((file) => file.isEntrypoint)?.path ?? payload.files[0]?.path ?? null
        );
        setRuns(payload.backtestResults);
        setSelectedRunId(payload.backtestResults[0]?.id ?? null);
        setIsDirty(false);
        setAutosaveMessage("All changes saved");
        setIsWriteForbidden(!payload.canWrite);

        try {
          setIsSavedBacktestRunsLoading(true);
          const savedRuns = await listBacktestRuns(payload.strategy.id, { limit: 200 });
          if (cancelled) {
            return;
          }
          const latest = savedRuns.items?.[0];
          const params = latest?.backtest_params;
          setSavedBacktestRuns(savedRuns.items ?? []);
          if (params) {
            setLastBacktestParamValues({
              name: params.name ?? "",
              startingEquity: params.initial_capital !== undefined ? String(params.initial_capital) : "",
              startDate: params.start_date ?? "",
              endDate: params.end_date ?? "",
            });
          }
        } catch (error) {
          if (!cancelled) {
            console.error("Failed to load saved backtest params", error);
          }
        } finally {
          if (!cancelled) setIsSavedBacktestRunsLoading(false);
        }
      } catch (error) {
        if (cancelled) {
          return;
        }
        console.error("Failed to load strategy workspace", error);
        setLoadError("Failed to load strategy workspace");
        addToast("Unable to load strategy workspace", "warning");
        setIsWriteForbidden(true);
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
      if (isWriteForbidden) {
        return;
      }
      setFiles((prev) => prev.map((file) => (file.path === path ? { ...file, content } : file)));
      markDirty();
    },
    [isWriteForbidden, markDirty]
  );

  // Lazy-load file content when a file is selected and not yet loaded.
  useEffect(() => {
    if (!strategy || !selectedFilePath) {
      return;
    }
    const file = files.find((f) => f.path === selectedFilePath);
    if (!file || file.content || loadedFilePaths.includes(selectedFilePath)) {
      return;
    }

    let cancelled = false;
    setLoadingFilePath(selectedFilePath);
    setFileLoadError(null);

    fetchStrategyArtifactContent(strategy.id, selectedFilePath)
      .then((content) => {
        if (cancelled) return;
        setFiles((prev) => prev.map((f) => (f.path === selectedFilePath ? { ...f, content: content ?? "" } : f)));
        initialFilesRef.current = initialFilesRef.current.some((f) => f.path === selectedFilePath)
          ? initialFilesRef.current.map((f) => (f.path === selectedFilePath ? { ...f, content: content ?? "" } : f))
          : [...initialFilesRef.current, { path: selectedFilePath, content: content ?? "", language: file?.language ?? "plaintext" }];
        setLoadedFilePaths((prev) => (prev.includes(selectedFilePath) ? prev : [...prev, selectedFilePath]));
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Failed to load file content", error);
        setFileLoadError("Failed to load file content");
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingFilePath(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [addToast, files, selectedFilePath, strategy]);

  const handleSave = useCallback(async () => {
    if (isSaving || !strategy || isWriteForbidden) {
      return;
    }

    const changedFiles = files.filter((file) => {
      if (typeof file.content !== "string") return false;
      const baseline = initialFilesRef.current.find((f) => f.path === file.path);
      return !baseline || baseline.content !== file.content;
    });

    if (changedFiles.length === 0) {
      setIsDirty(false);
      setAutosaveMessage("No changes to save");
      addToast("No changes to save", "info");
      return;
    }

    setIsSaving(true);
    setAutosaveMessage("Saving...");
    addToast("Saving workspace", "info");
    try {
      const result = await uploadStrategyArtifacts(strategy.id, changedFiles);
      initialFilesRef.current = cloneFiles(files);
      setIsDirty(false);
      setAutosaveMessage("All changes saved");
      setIsWriteForbidden(false);
      setStrategy((prev) =>
        prev
          ? {
              ...prev,
              current_version: result.version ?? prev.current_version,
              updated_at: new Date().toISOString(),
            }
          : prev
      );
      addToast(result.version ? `Workspace saved (v${result.version})` : "Workspace saved", "success");
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        setAutosaveMessage("You do not have write access");
        setIsWriteForbidden(true);
        addToast("You do not have write access", "warning");
        return;
      }
      console.error("Failed to save workspace", error);
      setAutosaveMessage("Save failed");
      addToast("Save failed", "warning");
    } finally {
      setIsSaving(false);
    }
  }, [addToast, files, isSaving, isWriteForbidden, strategy]);

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

  const handleClose = useCallback(() => {
    if (isDirty) {
      const confirmLeave = window.confirm("You have unsaved changes. Leave without saving?");
      if (!confirmLeave) return;
    }
    navigate("/");
  }, [isDirty, navigate]);

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
    latestBacktestData,
    setLatestBacktestData,
    latestBacktestStrategyVersion,
    setLatestBacktestStrategyVersion,
    lastBacktestParamValues,
    setLastBacktestParamValues,
    activeBacktestSource,
    activeSavedRunId,
    setActiveBacktestSource,
    setActiveSavedRunId,
    savedBacktestRuns,
    isSavedBacktestRunsLoading,
    refreshSavedBacktestRuns,
    addToast,
    loadingFilePath,
    fileLoadError,
    isWriteForbidden,
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
            {strategy.project_id ? (
              <>
                <p className="text-base font-semibold text-white">{strategy.project_name}</p>
                <p className="text-xs text-slate-500">PRJ {strategy.project_id}</p>
              </>
            ) : (
              <p className="text-sm text-slate-500">Not assigned</p>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={isSaving || !isDirty || isWriteForbidden}
              className={`rounded-xl px-4 py-2 text-sm font-semibold text-white transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                isSaving || !isDirty || isWriteForbidden
                  ? "cursor-not-allowed bg-slate-700/60 text-slate-300"
                  : "bg-gradient-to-r from-fuchsia-600 to-indigo-500"
              }`}
              onClick={handleSave}
            >
              Save New Version
            </button>
            <button
              type="button"
              onClick={handleClose}
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
