import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { useStrategyWorkspace } from "./layout";

export default function StrategyCodeWorkspace() {
  const {
    files,
    selectedFilePath,
    selectFile,
    updateFileContent,
    handleRun,
    handleSave,
    isDirty,
    isRunning,
    isSaving,
  } = useStrategyWorkspace();

  const [editorReady, setEditorReady] = useState(false);
  const codeFiles = useMemo(
    () =>
      files.filter(
        (file) =>
          file.language === "python" ||
          file.path.toLowerCase().endsWith(".txt") ||
          file.path.toLowerCase() === "readme.md"
      ),
    [files]
  );
  const selectedFile = useMemo(
    () => codeFiles.find((file) => file.path === selectedFilePath),
    [codeFiles, selectedFilePath]
  );

  useEffect(() => {
    setEditorReady(true);
  }, []);

  const editorTheme = "vs-dark";

  const fileSidebarSurface = "bg-slate-950/40 border-slate-800";
  const editorSurface = "bg-slate-950/60 border-slate-800";
  const fileRowClass = "border-slate-800/60 bg-slate-900/40";
  const fileActiveColor = "text-white";
  const fileIdleColor = "text-slate-400";
  const dividerBorder = "border-slate-800";
  const filePathColor = "text-white";
  const badgeClass =
    "rounded-full bg-teal-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-teal-200";
  const textBadgeClass =
    "rounded-full bg-indigo-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-200";
  const placeholderClass = "text-slate-500";
  const toolbarLabelColor = "text-slate-400";

  return (
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
      <aside className={`rounded-2xl border ${fileSidebarSurface} p-4`}> 
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-[0.3em] text-slate-500">Files</p>
            <h3 className="text-lg font-semibold">Workspace</h3>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Python entrypoints and supporting plain-text manifests (such as <code>requirements.txt</code>) are editable here.
          Attach datasets or configs from the Artifacts tab.
        </p>

        <div className="mt-6 space-y-2">
          {codeFiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-xs text-slate-500">
              No Python files available. Pull a strategy to begin editing.
            </div>
          ) : (
            codeFiles.map((file) => {
              const isActive = file.path === selectedFilePath;
              return (
                <div key={file.path} className={`flex items-center justify-between gap-2 rounded-xl border ${fileRowClass} px-3 py-2 text-sm`}>
                  <button
                    type="button"
                    onClick={() => selectFile(file.path)}
                    className={`flex-1 text-left font-mono text-xs ${isActive ? fileActiveColor : fileIdleColor}`}
                    aria-current={isActive}
                  >
                    {file.path}
                    <span className="ml-2 inline-flex items-center gap-2">
                      {file.isEntrypoint && <span className={badgeClass}>Entrypoint</span>}
                      {!file.isEntrypoint && file.path.toLowerCase().endsWith(".txt") && (
                        <span className={textBadgeClass}>TXT</span>
                      )}
                    </span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </aside>

      <section className={`flex min-h-[520px] flex-col rounded-2xl border ${editorSurface}`}>
        <div className={`flex flex-wrap items-center justify-between gap-3 border-b ${dividerBorder} px-5 py-4 text-sm`}>
          <div className={`flex flex-wrap items-center gap-2 text-xs ${toolbarLabelColor}`}>
            <span className={`font-mono text-sm ${selectedFile ? filePathColor : placeholderClass}`}>
              {selectedFile?.path ?? "Select a file"}
            </span>
            {selectedFile?.isEntrypoint && <span className={badgeClass}>Entrypoint</span>}
            {!selectedFile?.isEntrypoint &&
              selectedFile?.path.toLowerCase().endsWith(".txt") && (
                <span className={textBadgeClass}>TXT</span>
              )}
          </div>
        </div>

        <div className="flex-1">
          {selectedFile && editorReady ? (
            <Editor
              key={selectedFile.path}
              height="100%"
              theme={editorTheme}
              defaultLanguage={selectedFile.language}
              language={selectedFile.language}
              value={selectedFile.content}
              onChange={(nextValue) => updateFileContent(selectedFile.path, nextValue ?? "")}
              options={{
                minimap: { enabled: false },
                fontSize: 14,
                fontFamily: "JetBrains Mono, ui-monospace, SFMono-Regular, Menlo",
                scrollBeyondLastLine: false,
                smoothScrolling: true,
              }}
            />
          ) : (
            <div className={`flex h-full items-center justify-center text-sm ${placeholderClass}`}>
              Select a file to start editing
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
