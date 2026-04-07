import { NavLink, Outlet, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChartCandlestick, FileCode2, LayoutDashboard, LineChart } from "lucide-react";
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
  latestBacktestStrategyCode: string | null;
  setLatestBacktestStrategyCode: (code: string | null) => void;
  savedEntrypointContent: string | null;
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
  addFile: (file: StrategyFile) => void;
  loadingFilePath: string | null;
  fileLoadError: string | null;
};

const TABS = [
  { label: "Overview", to: ".", end: true, icon: LayoutDashboard },
  { label: "Code", to: "code", icon: FileCode2 },
  { label: "Backtest", to: "backtest", icon: ChartCandlestick },
  { label: "Results", to: "results", icon: LineChart },
];

function cloneFiles(items: StrategyFile[]): StrategyFile[] {
  return items.map((file) => ({ ...file }));
}

function getEntrypointContent(items: StrategyFile[]): string | null {
  const entrypoint = items.find((file) => file.isEntrypoint);
  return typeof entrypoint?.content === "string" ? entrypoint.content : null;
}

function normalizeBacktestDate(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed.split("T")[0]?.trim() ?? "";
}

function normalizeBacktestStartingEquity(value: unknown): string {
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return "";
    const parsed = Number.parseFloat(trimmed.replace(/,/g, ""));
    return Number.isFinite(parsed) ? String(parsed) : "";
  }
  return "";
}

function toLastBacktestParamValues(latestRun?: BacktestRunItem): Record<string, string> {
  const params = latestRun?.backtest_params;
  if (!params) return {};

  const startDate = normalizeBacktestDate(params.start_date);
  const endDate = normalizeBacktestDate(params.end_date);
  const startingEquity = normalizeBacktestStartingEquity(params.initial_capital);

  const values: Record<string, string> = {};
  if (startingEquity) values.startingEquity = startingEquity;
  if (startDate) values.startDate = startDate;
  if (endDate) values.endDate = endDate;
  return values;
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
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [isWorkspaceLoading, setIsWorkspaceLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadingFilePath, setLoadingFilePath] = useState<string | null>(null);
  const [fileLoadError, setFileLoadError] = useState<string | null>(null);
  const [loadedFilePaths, setLoadedFilePaths] = useState<string[]>([]);
  const [latestBacktestData, setLatestBacktestData] = useState<BacktestResponse | null>(null);
  const [latestBacktestStrategyVersion, setLatestBacktestStrategyVersion] = useState<number | string | null>(null);
  const [latestBacktestStrategyCode, setLatestBacktestStrategyCode] = useState<string | null>(null);
  const [savedEntrypointContent, setSavedEntrypointContent] = useState<string | null>(null);
  const [lastBacktestParamValues, setLastBacktestParamValues] = useState<Record<string, string>>({});
  const [activeBacktestSource, setActiveBacktestSource] = useState<"live" | "saved" | null>(null);
  const [activeSavedRunId, setActiveSavedRunId] = useState<string | null>(null);
  const [savedBacktestRuns, setSavedBacktestRuns] = useState<BacktestRunItem[]>([]);
  const [isSavedBacktestRunsLoading, setIsSavedBacktestRunsLoading] = useState(false);
  const [isDockExpanded, setIsDockExpanded] = useState(false);

  const refreshSavedBacktestRuns = useCallback(async () => {
    if (!strategy) return;
    setIsSavedBacktestRunsLoading(true);
    try {
      const savedRuns = await listBacktestRuns(strategy.id, { limit: 200 });
      setSavedBacktestRuns(savedRuns.items ?? []);

      const latest = savedRuns.items?.[0];
      setLastBacktestParamValues(toLastBacktestParamValues(latest));
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
      try {
        const payload = await fetchStrategyWorkspace(strategyId);
        if (cancelled) {
          return;
        }
        setLatestBacktestData(null);
        setLatestBacktestStrategyVersion(null);
        setLatestBacktestStrategyCode(null);
        setSavedEntrypointContent(getEntrypointContent(payload.files));
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

        try {
          setIsSavedBacktestRunsLoading(true);
          const savedRuns = await listBacktestRuns(payload.strategy.id, { limit: 200 });
          if (cancelled) {
            return;
          }
          const latest = savedRuns.items?.[0];
          setSavedBacktestRuns(savedRuns.items ?? []);
          setLastBacktestParamValues(toLastBacktestParamValues(latest));
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

  const addFile = useCallback((file: StrategyFile) => {
    setFiles((prev) => [...prev, file]);
  }, []);

  const updateFileContent = useCallback(
    (path: string, content: string) => {
      setFiles((prev) => prev.map((file) => (file.path === path ? { ...file, content } : file)));
      markDirty();
    },
    [markDirty]
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
          : [
              ...initialFilesRef.current,
              {
                path: selectedFilePath,
                content: content ?? "",
                language: file?.language ?? "plaintext",
                isEntrypoint: file?.isEntrypoint,
              },
            ];
        setSavedEntrypointContent(getEntrypointContent(initialFilesRef.current));
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
    if (isSaving || !strategy) {
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
      setSavedEntrypointContent(getEntrypointContent(initialFilesRef.current));
      setIsDirty(false);
      setAutosaveMessage("All changes saved");
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
      console.error("Failed to save workspace", error);
      setAutosaveMessage("Save failed");
      addToast("Save failed", "warning");
    } finally {
      setIsSaving(false);
    }
  }, [addToast, files, isSaving, strategy]);

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
      <div className="flex h-full min-h-0 flex-col overflow-hidden text-slate-100">
        <section className="relative h-full overflow-hidden rounded-[40px] border border-white/10 bg-[#040912] shadow-[0_40px_160px_rgba(2,6,23,0.75)]">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(14,165,233,0.16),transparent_28%),radial-gradient(circle_at_80%_20%,rgba(168,85,247,0.16),transparent_24%),radial-gradient(circle_at_bottom_right,rgba(34,197,94,0.12),transparent_24%)]" />
          <div className="absolute inset-0 opacity-20 [background-image:linear-gradient(rgba(148,163,184,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.08)_1px,transparent_1px)] [background-size:28px_28px]" />

          <div className="relative border-b border-white/10 bg-black/25 px-6 py-4 backdrop-blur-xl">
            <div className="flex items-center gap-3">
              <button type="button" className="h-3.5 w-3.5 rounded-full bg-rose-500/80" aria-label="Close workspace" />
              <span className="h-3.5 w-3.5 rounded-full bg-amber-400/80" />
              <span className="h-3.5 w-3.5 rounded-full bg-emerald-500/80" />
              <span className="ml-3 text-xs font-medium uppercase tracking-[0.32em] text-slate-400">Strategy Workspace</span>
            </div>
          </div>

          <div className="relative h-full overflow-y-auto px-8 py-12">
            <div className="max-w-xl space-y-3">
              <p className="text-xs font-medium uppercase tracking-[0.38em] text-cyan-300/80">Booting Session</p>
              <h1 className="text-3xl font-semibold tracking-tight text-white">
                {isWorkspaceLoading ? "Loading strategy workspace..." : "Strategy workspace unavailable"}
              </h1>
              <p className="text-sm leading-7 text-slate-400">
                {loadError ?? "Preparing source, results, and execution context."}
              </p>
            </div>
          </div>
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
    latestBacktestStrategyCode,
    setLatestBacktestStrategyCode,
    savedEntrypointContent,
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
    addFile,
    loadingFilePath,
    fileLoadError,
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-slate-100">
      <section className="relative flex h-full min-h-0 flex-col overflow-hidden rounded-[42px] border border-white/10 bg-[#030814] shadow-[0_44px_180px_rgba(2,6,23,0.82)]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_12%_12%,rgba(56,189,248,0.16),transparent_24%),radial-gradient(circle_at_86%_16%,rgba(217,70,239,0.18),transparent_22%),radial-gradient(circle_at_52%_100%,rgba(34,197,94,0.1),transparent_28%)]" />
        <div className="absolute inset-0 opacity-[0.16] [background-image:linear-gradient(rgba(148,163,184,0.1)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.1)_1px,transparent_1px)] [background-size:30px_30px]" />
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-300/60 to-transparent" />

        <header className="relative border-b border-white/10 bg-[linear-gradient(180deg,rgba(10,14,24,0.96),rgba(7,11,20,0.88))] px-6 py-4 backdrop-blur-xl">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-[280px] items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleClose}
                  className="h-3.5 w-3.5 rounded-full bg-rose-500 shadow-[0_0_20px_rgba(244,63,94,0.45)] transition hover:scale-110 hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300"
                  aria-label="Return to home"
                  title="Return to home"
                />
                <span className="h-3.5 w-3.5 rounded-full bg-amber-400/90 shadow-[0_0_18px_rgba(251,191,36,0.28)]" />
                <span className="h-3.5 w-3.5 rounded-full bg-emerald-500/90 shadow-[0_0_18px_rgba(34,197,94,0.28)]" />
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-3">
                  <h1 className="truncate text-[1.15rem] font-semibold tracking-[0.01em] text-white">{strategy.name}</h1>
                  {isDirty ? <span className="h-2.5 w-2.5 rounded-full bg-amber-400 shadow-[0_0_14px_rgba(251,191,36,0.5)]" title="Unsaved changes" /> : null}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.28em] text-slate-400">
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">Strategy {strategy.id}</span>
                  <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-slate-200">Version {strategy.current_version ?? "Draft"}</span>
                </div>
              </div>
            </div>

            <div className="flex flex-col items-end gap-2">
              <button
                type="button"
                disabled={isSaving || !isDirty}
                className={`rounded-2xl border px-4 py-2.5 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${
                  isSaving || !isDirty
                    ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500 focus-visible:outline-slate-700"
                    : "border-cyan-400/30 bg-[linear-gradient(135deg,rgba(14,165,233,0.85),rgba(59,130,246,0.85))] text-white shadow-[0_10px_30px_rgba(14,165,233,0.25)] hover:-translate-y-0.5 hover:brightness-110 focus-visible:outline-cyan-300"
                }`}
                onClick={handleSave}
              >
                {isSaving ? "Saving..." : "Save Code"}
              </button>
              <span className="text-[11px] uppercase tracking-[0.28em] text-slate-500">{autosaveMessage}</span>
            </div>
          </div>
        </header>

        <div
          className={`relative grid min-h-0 flex-1 transition-[grid-template-columns] duration-300 ${
            isDockExpanded ? "grid-cols-[220px_minmax(0,1fr)]" : "grid-cols-[72px_minmax(0,1fr)]"
          }`}
        >
          <aside
            className="relative z-30 min-h-0 overflow-visible border-r border-white/10 bg-[linear-gradient(180deg,rgba(11,16,25,0.98),rgba(8,13,22,1))]"
            onMouseEnter={() => setIsDockExpanded(true)}
            onMouseLeave={() => setIsDockExpanded(false)}
          >
            <div className="absolute inset-y-0 right-0 w-px bg-white/8" />
            <nav
              className={`relative flex h-full min-h-0 flex-col items-start gap-1 py-3 transition-all duration-300 ${
                isDockExpanded ? "w-[220px]" : "w-[72px]"
              }`}
            >
              {TABS.map((tab) => (
                <NavLink
                  key={tab.label}
                  to={tab.to}
                  end={tab.end}
                  className={({ isActive }) =>
                    `group relative z-40 flex h-14 w-full items-center overflow-hidden transition-all duration-300 ${
                      isActive
                        ? "bg-white/[0.04] text-white"
                        : "text-slate-400 hover:bg-white/[0.04] hover:text-white"
                    } ${
                      isDockExpanded ? "pr-3" : ""
                    }`
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={`absolute left-0 top-0 h-full w-0.5 bg-[#2f81f7] transition-opacity duration-150 ${
                          isActive ? "opacity-100" : "opacity-0"
                        }`}
                      />
                      <span className="flex h-full w-[72px] shrink-0 items-center justify-center">
                        <tab.icon
                          aria-hidden="true"
                          className="h-6 w-6 shrink-0"
                          strokeWidth={1.9}
                        />
                      </span>
                      <span
                        className={`pointer-events-none overflow-hidden whitespace-nowrap text-sm font-medium tracking-[0.01em] text-white transition-[max-width,opacity] duration-200 ${
                          isDockExpanded ? "max-w-[120px] opacity-100" : "max-w-0 opacity-0"
                        }`}
                      >
                        {tab.label}
                      </span>
                    </>
                  )}
                </NavLink>
                ))}
              </nav>
          </aside>

          <div className="relative z-10 min-h-0 min-w-0 overflow-hidden bg-[linear-gradient(180deg,rgba(7,11,20,0.52),rgba(4,8,16,0.88))]">
            <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
            <div className="h-full min-h-0 overflow-y-auto px-6 py-6">
              <Outlet context={contextValue} />
            </div>
          </div>
        </div>
      </section>

      {toastShelf}
    </div>
  );
}

export function useStrategyWorkspace() {
  return useOutletContext<StrategyWorkspaceContext>();
}
