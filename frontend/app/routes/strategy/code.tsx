import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { getBacktestJob, submitBacktest } from "~/api/backtest";
import { useStrategyWorkspace } from "./layout";

function getFileKind(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return { label: "PY", accent: "from-amber-400/90 to-orange-500/70" };
  if (lower.endsWith(".txt")) return { label: "TXT", accent: "from-sky-400/90 to-cyan-500/70" };
  if (lower.endsWith(".md")) return { label: "MD", accent: "from-emerald-400/90 to-teal-500/70" };
  if (lower.endsWith(".json")) return { label: "JSON", accent: "from-violet-400/90 to-fuchsia-500/70" };
  return { label: "FILE", accent: "from-slate-400/90 to-slate-500/70" };
}

function getDisplayLanguage(language?: string) {
  if (!language) return "plaintext";
  return language;
}

export default function StrategyCodeWorkspace() {
  const {
    strategy,
    files,
    entrypoint,
    selectedFilePath,
    selectFile,
    updateFileContent,
    isDirty,
    isSaving,
    loadingFilePath,
    fileLoadError,
    isWriteForbidden,
    addToast,
    lastBacktestParamValues,
  } = useStrategyWorkspace();

  const [editorReady, setEditorReady] = useState(false);
  const [isTypeChecking, setIsTypeChecking] = useState(false);
  const [typeCheckStatus, setTypeCheckStatus] = useState<"idle" | "success" | "error">("idle");
  const [typeCheckMessage, setTypeCheckMessage] = useState<string>("No syntax check run yet");

  const codeFiles = useMemo(() => files, [files]);
  const sortedCodeFiles = useMemo(
    () =>
      [...codeFiles].sort((left, right) =>
        left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" })
      ),
    [codeFiles]
  );
  const selectedFile = useMemo(
    () => sortedCodeFiles.find((file) => file.path === selectedFilePath),
    [sortedCodeFiles, selectedFilePath]
  );
  const selectedKind = useMemo(
    () => getFileKind(selectedFile?.path ?? ""),
    [selectedFile?.path]
  );
  const isLoadingFile = loadingFilePath !== null && loadingFilePath === selectedFilePath;
  const editorLineCount = useMemo(() => {
    const content = selectedFile?.content ?? "";
    return Math.max(1, content.split("\n").length);
  }, [selectedFile?.content]);
  const editorHeight = useMemo(() => {
    const lineHeight = 21;
    const topBottomPadding = 42;
    return Math.max(620, editorLineCount * lineHeight + topBottomPadding);
  }, [editorLineCount]);
  const loadedFileCount = useMemo(
    () => sortedCodeFiles.filter((file) => typeof file.content === "string").length,
    [sortedCodeFiles]
  );
  const strategyCode = useMemo(() => (typeof entrypoint?.content === "string" ? entrypoint.content : ""), [entrypoint?.content]);

  useEffect(() => {
    setEditorReady(true);
  }, []);

  const handleTypeCheck = async () => {
    if (isTypeChecking || isSaving) return;
    if (!strategyCode.trim()) {
      setTypeCheckStatus("error");
      setTypeCheckMessage("Entrypoint is empty");
      addToast("Entrypoint file is empty. Open the file to load its contents first.", "warning");
      return;
    }

    const startDate = (lastBacktestParamValues.startDate ?? "").trim() || "2020-01-03";
    const endDate = (lastBacktestParamValues.endDate ?? "").trim() || "2024-12-31";
    const initialCapital = Number.parseFloat((lastBacktestParamValues.startingEquity ?? "100000").replace(/,/g, ""));

    setIsTypeChecking(true);
    setTypeCheckStatus("idle");
    setTypeCheckMessage("Checking with backtester...");

    try {
      const jobId = await submitBacktest({
        strategy_code: strategyCode,
        start_date: startDate,
        end_date: endDate,
        initial_capital: Number.isFinite(initialCapital) ? initialCapital : 100000,
      });

      for (let attempt = 0; attempt < 30; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const job = await getBacktestJob(jobId);

        if (job.status === "COMPLETED") {
          setTypeCheckStatus("success");
          setTypeCheckMessage("Backtester accepted the strategy code");
          addToast("Type check passed", "success");
          setIsTypeChecking(false);
          return;
        }

        if (job.status === "FAILED" || job.status === "CANCELLED") {
          const message = job.error?.trim() || "Backtester rejected the strategy code";
          setTypeCheckStatus("error");
          setTypeCheckMessage(message);
          addToast("Type check failed", "warning");
          setIsTypeChecking(false);
          return;
        }
      }

      setTypeCheckStatus("error");
      setTypeCheckMessage("Type check timed out");
      addToast("Type check timed out", "warning");
    } catch (error) {
      console.error("Type check failed", error);
      setTypeCheckStatus("error");
      setTypeCheckMessage("Unable to reach backtester");
      addToast("Type check failed", "warning");
    } finally {
      setIsTypeChecking(false);
    }
  };

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/10 bg-[#050b15] shadow-[0_30px_120px_rgba(2,6,23,0.35)]">
      <div className="min-h-[760px] bg-[linear-gradient(180deg,rgba(4,9,18,0.95),rgba(4,8,16,0.98))]">
        <section className="flex min-w-0 flex-col">
          <div className="border-b border-white/10 bg-[#0a1220] px-4 pt-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex min-w-0 flex-1 flex-wrap gap-2">
                {sortedCodeFiles.length === 0 ? (
                  <div className="inline-flex items-center rounded-t-2xl border border-b-0 border-white/10 bg-[#101a2a] px-4 py-3 text-sm text-slate-400">
                    No files loaded
                  </div>
                ) : (
                  sortedCodeFiles.map((file) => {
                    const isActive = file.path === selectedFilePath;
                    const fileKind = getFileKind(file.path);
                    return (
                      <button
                        key={file.path}
                        type="button"
                        onClick={() => selectFile(file.path)}
                        className={`inline-flex max-w-full items-center gap-3 rounded-t-2xl border border-b-0 px-4 py-3 text-left transition ${
                          isActive
                            ? "border-white/10 bg-[#101a2a] text-slate-100 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                            : "border-transparent bg-white/[0.03] text-slate-400 hover:bg-white/[0.06] hover:text-slate-200"
                        }`}
                        aria-current={isActive}
                      >
                        <span
                          className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-gradient-to-br ${fileKind.accent} px-1.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-white`}
                        >
                          {fileKind.label}
                        </span>
                        <span className="truncate text-sm font-medium">{file.path}</span>
                        {isActive && isDirty ? <span className="h-2 w-2 rounded-full bg-amber-400" /> : null}
                      </button>
                    );
                  })
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={handleTypeCheck}
                  disabled={isTypeChecking || isSaving}
                  className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
                    isTypeChecking || isSaving
                      ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500"
                      : "border-cyan-400/25 bg-cyan-500/15 text-cyan-100 hover:bg-cyan-500/20"
                  }`}
                >
                  {isTypeChecking ? "Checking..." : "Type Check"}
                </button>
              </div>
            </div>
          </div>

          <div className="min-w-0 bg-[#060d18]">
            {isLoadingFile ? (
              <div className="flex min-h-[620px] items-center justify-center text-sm text-slate-500">Loading file...</div>
            ) : selectedFile && editorReady ? (
              <Editor
                key={selectedFile.path}
                height={editorHeight}
                theme="vs-dark"
                defaultLanguage={selectedFile.language}
                language={selectedFile.language}
                value={selectedFile.content}
                onChange={(nextValue) => updateFileContent(selectedFile.path, nextValue ?? "")}
                options={{
                  minimap: { enabled: false },
                  fontSize: 14,
                  lineHeight: 21,
                  fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo",
                  scrollBeyondLastLine: false,
                  smoothScrolling: true,
                  wordWrap: "off",
                  automaticLayout: true,
                  padding: { top: 14, bottom: 18 },
                  scrollbar: {
                    vertical: "hidden",
                    horizontal: "auto",
                    alwaysConsumeMouseWheel: false,
                  },
                }}
              />
            ) : (
              <div className="flex min-h-[620px] items-center justify-center text-sm text-slate-500">
                {fileLoadError ? fileLoadError : "Select a file to start editing"}
              </div>
            )}
          </div>

        </section>
      </div>
    </section>
  );
}
