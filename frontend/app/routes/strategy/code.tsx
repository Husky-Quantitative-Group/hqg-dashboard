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

function getFileIcon(path: string) {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return "code";
  if (lower.endsWith(".md")) return "description";
  if (lower.endsWith(".json")) return "data_object";
  if (lower.endsWith(".txt")) return "article";
  return "insert_drive_file";
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
    handleSave,
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
  const loadedFileCount = useMemo(
    () => sortedCodeFiles.filter((file) => typeof file.content === "string").length,
    [sortedCodeFiles]
  );
  const strategyCode = useMemo(() => (typeof entrypoint?.content === "string" ? entrypoint.content : ""), [entrypoint?.content]);
  const canEdit = !isWriteForbidden;

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
    <section className="glass-card ghost-border light-catch rounded-xl overflow-hidden border border-outline-variant/20 bg-[#0d0d0d] shadow-none">
      <div className="min-h-[620px] bg-[#0d0d0d]">
        <section className="flex min-w-0 flex-col">
          <div className="flex justify-between items-stretch bg-[#181818] border-b border-white/5 pr-4">
            <div className="flex-1 min-w-0 flex items-center gap-0">
              {sortedCodeFiles.length === 0 ? (
                <div className="inline-flex items-center rounded-t-2xl border border-b-0 border-white/10 bg-[#101a2a] px-3 py-2 text-sm text-slate-400">
                  No files loaded
                </div>
              ) : (
                sortedCodeFiles.map((file, index) => {
                  const isActive = file.path === selectedFilePath;
                  const fileIcon = getFileIcon(file.path);
                  return (
                    <button
                      key={file.path}
                      type="button"
                      onClick={() => selectFile(file.path)}
                      className={`flex items-center gap-2 border-r border-white/10 px-3 py-3 transition ${
                        index > 0 ? "border-l border-white/10 " : ""
                      }${
                        isActive
                          ? "code-editor-tab-active"
                          : "code-editor-tab-inactive hover:bg-[#1e1e1e]"
                      }`}
                      aria-current={isActive}
                    >
                      <span className={`material-symbols-outlined text-[12px] ${isActive ? "text-blue-400" : "text-slate-400"}`}>
                        {fileIcon}
                      </span>
                      <span className="truncate text-xs font-medium">{file.path}</span>
                      {isActive && isDirty ? <span className="h-2 w-2 rounded-full bg-amber-400" /> : null}
                    </button>
                  );
                })
              )}
            </div>

            <div className="ml-auto flex items-center gap-3 py-1.5">
              <button
                type="button"
                onClick={handleTypeCheck}
                disabled={isTypeChecking || isSaving}
                className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-bold transition ${
                  isTypeChecking || isSaving
                    ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500"
                    : "border-outline-variant/30 bg-surface-container-highest/50 text-on-surface hover:bg-surface-bright"
                }`}
              >
                <span className="material-symbols-outlined text-sm">spellcheck</span>
                {isTypeChecking ? "Checking..." : "Type Check"}
              </button>
              <button
                type="button"
                disabled={isSaving || !isDirty}
                className={`inline-flex items-stretch overflow-hidden rounded-lg border text-xs font-bold transition ${
                  isSaving || !isDirty
                    ? "cursor-not-allowed border-white/10 bg-white/5 text-slate-500"
                    : "border-secondary-fixed bg-secondary-fixed text-on-secondary-fixed shadow-[0_0_20px_rgba(199,210,254,0.2)] hover:-translate-y-0.5 hover:brightness-110"
                }`}
                onClick={handleSave}
              >
                <span className="inline-flex items-center gap-2 pl-3 pr-2 py-1.5">
                  <span className="material-symbols-outlined text-sm">save</span>
                  {isSaving ? "Saving..." : "Save Code"}
                </span>
                <span className="inline-flex items-center border-l border-black/15 px-1">
                  <span className="material-symbols-outlined text-xs">expand_more</span>
                </span>
              </button>
            </div>
          </div>

          <div className="flex-1 bg-[#1e1e1e] px-4">
            {isWriteForbidden && (
              <div className="border-b border-white/10 bg-white/[0.03] px-4 py-2 text-xs text-amber-200">
                Read-only mode. You don&apos;t have write permission for this strategy.
              </div>
            )}
            {isLoadingFile ? (
              <div className="flex min-h-[620px] items-center justify-center text-sm text-slate-500">Loading file...</div>
            ) : selectedFile && editorReady ? (
              <div>
                <Editor
                  key={selectedFile.path}
                  height="100vh"
                  theme="vs-dark"
                  defaultLanguage={selectedFile.language}
                  language={selectedFile.language}
                  value={selectedFile.content}
                  saveViewState={false}
                  onMount={(editor) => {
                    editor.setScrollTop(0);
                  }}
                  onChange={(nextValue) => {
                    if (!canEdit) return;
                    updateFileContent(selectedFile.path, nextValue ?? "");
                  }}
                  options={{
                    minimap: { enabled: true },
                    fontSize: 13,
                    lineHeight: 20,
                    lineNumbers: "on",
                    lineNumbersMinChars: 3,
                    fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo",
                    readOnly: !canEdit,
                    scrollBeyondLastLine: false,
                    smoothScrolling: true,
                    wordWrap: "off",
                    automaticLayout: true,
                    padding: { top: 14, bottom: 18 },
                    scrollbar: {
                      vertical: "auto",
                      horizontal: "auto",
                      alwaysConsumeMouseWheel: false,
                    },
                  }}
                />
              </div>
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
