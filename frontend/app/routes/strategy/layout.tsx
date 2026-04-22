import { NavLink, Outlet, useNavigate, useOutletContext, useParams, useLocation } from "react-router-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
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
  latestBacktestLogs: string[];
  setLatestBacktestLogs: (logs: string[]) => void;
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
  loadingFilePath: string | null;
  fileLoadError: string | null;
  isWriteForbidden: boolean;
};

const TABS = [
  { label: "Overview", to: ".", end: true, icon: "dashboard" },
  { label: "Code", to: "code", icon: "code" },
  { label: "Backtest", to: "backtest", icon: "play_circle" },
  { label: "Results", to: "results", icon: "bar_chart" },
  { label: "Monte-Carlo", to: "monte-carlo", icon: "casino" },
  { label: "Grid Search", to: "grid-search", icon: "grid_view" },
];

const RIGHT_TABS = [
  { label: "Permissions", to: "permissions", icon: "lock" },
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
  const location = useLocation();
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
  const [latestBacktestStrategyCode, setLatestBacktestStrategyCode] = useState<string | null>(null);
  const [savedEntrypointContent, setSavedEntrypointContent] = useState<string | null>(null);
  const [lastBacktestParamValues, setLastBacktestParamValues] = useState<Record<string, string>>({});
  const [activeBacktestSource, setActiveBacktestSource] = useState<"live" | "saved" | null>(null);
  const [activeSavedRunId, setActiveSavedRunId] = useState<string | null>(null);
  const [savedBacktestRuns, setSavedBacktestRuns] = useState<BacktestRunItem[]>([]);
  const [isSavedBacktestRunsLoading, setIsSavedBacktestRunsLoading] = useState(false);
  const [latestBacktestLogs, setLatestBacktestLogs] = useState<string[]>([]);

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
      setIsWriteForbidden(true);
      try {
        const payload = await fetchStrategyWorkspace(strategyId);
        if (cancelled) {
          return;
        }
        setLatestBacktestData(null);
        setLatestBacktestLogs([]);
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
        setIsWriteForbidden(!payload.canWrite);

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
      setSavedEntrypointContent(getEntrypointContent(initialFilesRef.current));
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

  const selectRun = useCallback((runId: number) => {
    setSelectedRunId(runId);
  }, []);

  const toastShelf = (
    <div className="pointer-events-none fixed top-6 right-6 z-50 space-y-3" aria-live="polite">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`pointer-events-auto rounded-2xl border px-4 py-3 text-sm shadow-lg ${
            toast.variant === "success"
              ? "border-emerald-500/40 bg-emerald-900 text-emerald-100"
              : toast.variant === "warning"
                ? "border-amber-500/50 bg-amber-900 text-amber-100"
                : "border-slate-500/50 bg-slate-800 text-slate-100"
          }`}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );

  if (!strategy) {
    return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden text-on-surface">
        <section className="glass-card ghost-border light-catch rounded-xl border border-outline-variant/20 bg-surface-container/70 shadow-none">
          <div className="border-b border-outline-variant/20 bg-surface-container-high/70 px-6 py-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-outline-variant/20 bg-surface-container-highest/60">
                <span className="material-symbols-outlined text-on-surface-variant">tactic</span>
              </div>
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-secondary/80">Strategy Workspace</p>
                <h2 className="font-headline text-base font-bold tracking-tight text-on-surface">
                  {isWorkspaceLoading ? "Opening strategy" : "Workspace unavailable"}
                </h2>
              </div>
            </div>
          </div>

          <div className="px-6 py-8">
            <div className="max-w-2xl space-y-5">
              {isWorkspaceLoading ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="h-3 w-32 rounded-full bg-surface-container-highest/70" />
                    <div className="h-8 w-72 rounded-xl bg-surface-container-highest/70" />
                    <div className="h-4 w-full max-w-xl rounded-full bg-surface-container-highest/50" />
                    <div className="h-4 w-4/5 max-w-lg rounded-full bg-surface-container-highest/40"/>
                  </div>
                  <div className="rounded-2xl border border-outline-variant/20 bg-surface-container-high/60 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                    <div className="mb-4 flex items-center justify-between">
                      <div className="space-y-2">
                        <div className="h-3 w-24 rounded-full bg-surface-container-highest/60" />
                        <div className="h-5 w-36 rounded-full bg-surface-container-highest/70" />
                      </div>
                      <div className="rounded-full border border-secondary/20 bg-secondary/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-secondary/85">
                        Loading
                      </div>
                    </div>
                    <div className="strategy-loading-chart">
                      <p className="font-headline text-base text-[5px] tracking-[0.22em] pl-3 text-on-surface/2">Future Gadget Lab</p>
                      <svg viewBox="0 0 640 240" className="h-full w-full" aria-hidden="true" preserveAspectRatio="none">
                        <defs>
                          <linearGradient id="strategyLoadingArea" x1="0%" x2="0%" y1="0%" y2="100%">
                            <stop offset="0%" stopColor="rgba(140,100,205,0.32)" />
                            <stop offset="100%" stopColor="rgba(140,100,205,0)" />
                          </linearGradient>
                          <linearGradient id="strategyLoadingStroke" x1="0%" x2="100%" y1="0%" y2="0%">
                            <stop offset="0%" stopColor="rgba(167,139,250,0.35)" />
                            <stop offset="55%" stopColor="rgba(96,165,250,0.95)" />
                            <stop offset="100%" stopColor="rgba(52,211,153,0.9)" />
                          </linearGradient>
                          <filter id="strategyLoadingGlow" x="-20%" y="-20%" width="140%" height="140%">
                            <feGaussianBlur stdDeviation="4" result="blur" />
                            <feMerge>
                              <feMergeNode in="blur" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                          </filter>
                        </defs>

                        <path
                          d="M0 208 H640 M0 156 H640 M0 104 H640 M0 52 H640 M64 0 V240 M192 0 V240 M320 0 V240 M448 0 V240 M576 0 V240"
                          className="strategy-loading-chart-grid"
                        />
                        <path
                          d="M24 212 L24 188 L92 154 L148 168 L212 120 L276 136 L340 86 L404 100 L470 62 L534 74 L604 26 L616 18 L616 212 Z"
                          fill="url(#strategyLoadingArea)"
                          className="strategy-loading-chart-area"
                        />
                        <path
                          d="M24 188 L92 154 L148 168 L212 120 L276 136 L340 86 L404 100 L470 62 L534 74 L604 26 L616 18"
                          className="strategy-loading-chart-line strategy-loading-chart-line-glow"
                          filter="url(#strategyLoadingGlow)"
                        />
                        <path
                          d="M24 188 L92 154 L148 168 L212 120 L276 136 L340 86 L404 100 L470 62 L534 74 L604 26 L616 18"
                          className="strategy-loading-chart-line"
                        />
                        <circle r="6" className="strategy-loading-chart-dot">
                          <animateMotion dur="2.8s" repeatCount="indefinite" rotate="auto">
                            <mpath href="#strategy-loading-chart-path" />
                          </animateMotion>
                        </circle>
                        <path
                          id="strategy-loading-chart-path"
                          d="M24 188 L92 154 L148 168 L212 120 L276 136 L340 86 L404 100 L470 62 L534 74 L604 26 L616 18"
                          fill="none"
                          stroke="transparent"
                        />
                      </svg>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-3">
                  <h1 className="text-3xl font-bold tracking-tight text-on-surface">Strategy workspace unavailable</h1>
                  <p className="text-sm leading-7 text-on-surface-variant/90">
                    {loadError ?? "Unable to prepare source, results, and execution context."}
                  </p>
                </div>
              )}
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
    latestBacktestLogs,
    setLatestBacktestLogs,
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
    loadingFilePath,
    fileLoadError,
    isWriteForbidden,
  };

  const formatter = new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const getActiveTab = () => {
    const path = location.pathname.split("/").pop() || ".";
    if (path === "overview" || path === ".") return ".";
    return path;
  };

  const isTabActive = (tabTo: string) => {
    const activePath = getActiveTab();
    if (tabTo === ".") {
      return (
        activePath === "." ||
        /\/strategies\/[^/]+(?:\/)?$/.test(location.pathname)
      );
    }
    return activePath === tabTo;
  };

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden text-slate-100">
      <section className="relative flex h-full min-h-0 flex-col overflow-hidden">
        {/* Header Section with Title, Version, and Metadata */}
        <section className="flex flex-col @container px-6 py-2 space-y-2">
          <div className="flex flex-col lg:flex-row justify-between items-start gap-4">
            {/* Left Section: Title, Description */}
            <div className="space-y-2 max-w-3xl">
              <div className="flex items-center gap-2">
                <h2 className="font-extrabold font-headline tracking-tight text-on-surface text-[2.2rem]">
                  {strategy?.name || "Strategy"}
                </h2>
                <div className="flex items-center gap-1">
                  <button className="flex items-center gap-2 text-on-surface text-[13px] font-bold px-4 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-high/80 backdrop-blur-md hover:bg-surface-container-highest transition-all shadow-lg">
                    <span className="text-on-surface-variant font-medium">ver</span>
                    <span className="">
                      {typeof strategy?.current_version === "number"
                        ? strategy.current_version
                        : "1.0.0"}
                    </span>
                    <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                      expand_more
                    </span>
                  </button>
                  <button className="flex items-center justify-center p-1.5 rounded-lg text-on-surface-variant hover:text-on-surface hover:bg-surface-bright/50 transition-all">
                    <span className="material-symbols-outlined text-[20px]">more_vert</span>
                  </button>
                </div>
              </div>
              <p className="text-on-surface/95 text-sm leading-relaxed">
                {strategy?.description?.trim() || "No description provided"}
              </p>
            </div>

            {/* Right Section: Metadata */}
            <div className="flex flex-col items-end gap-3 min-w-[320px]">
              <div className="flex flex-col gap-1 text-right">
                <div className="flex items-center justify-end gap-2 text-on-surface-variant text-xs font-medium">
                  <span className="material-symbols-outlined text-xs">person</span>
                  Owner: <span className="text-on-surface">{strategy?.owner || "Unknown"}</span>
                </div>
                <div className="flex items-center justify-end gap-2 text-on-surface-variant text-xs font-medium">
                  <span className="material-symbols-outlined text-xs">calendar_today</span>
                  Created:{" "}
                  {strategy?.created_at ? formatter.format(new Date(strategy.created_at)) : "-"}
                </div>
                <div className="flex items-center justify-end gap-2 text-secondary text-xs font-medium">
                  <span className="material-symbols-outlined text-xs">update</span>
                  Updated:{" "}
                  {strategy?.updated_at ? formatter.format(new Date(strategy.updated_at)) : "-"}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                {strategy?.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-0.5 rounded-md text-[9px] font-bold bg-blue-400/10 text-blue-400/80 border border-blue-400/20 uppercase tracking-widest backdrop-blur-sm transition-colors hover:bg-blue-400/20 cursor-default"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Horizontal Tabs Navigation */}
          <nav className="flex items-center border-b-[2px] border-outline-variant/40 relative overflow-x-auto no-scrollbar justify-between">
            <div className="flex items-center overflow-x-auto no-scrollbar">
              {TABS.map((tab) => {
                const isActive = isTabActive(tab.to);
                return (
                  <button
                    key={tab.label}
                    onClick={() => {
                      if (tab.to === ".") {
                        navigate(".");
                      } else {
                        navigate(tab.to);
                      }
                    }}
                    className={`text-sm font-medium transition-all flex items-center justify-center shrink-0 py-2.5 gap-1.5 px-[17px] border-b-2 border-transparent ${
                      isActive
                        ? "nav-tab-active text-on-surface font-bold backdrop-blur-md rounded-t-lg z-10"
                        : "text-on-surface/90 hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">{tab.icon}</span>
                    <span className="tab-label">{tab.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center ml-auto border-l border-outline-variant/40">
              {RIGHT_TABS.map((tab) => {
                const isActive = isTabActive(tab.to);
                return (
                  <button
                    key={tab.label}
                    onClick={() => {
                      navigate(tab.to);
                    }}
                    className={`text-sm font-medium transition-all flex items-center justify-center shrink-0 py-2.5 gap-1.5 px-[17px] border-b-2 border-transparent ${
                      isActive
                        ? "nav-tab-active text-on-surface font-bold backdrop-blur-md rounded-t-lg z-10"
                        : "text-on-surface/90 hover:text-on-surface"
                    }`}
                  >
                    <span className="material-symbols-outlined text-xl">{tab.icon}</span>
                    <span className="tab-label">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </section>

        <div className="relative grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)]">
          <div className="relative z-10 min-h-0 min-w-0 overflow-hidden">
            <div className="h-full min-h-0 overflow-y-auto px-6 pt-1 pb-6">
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
