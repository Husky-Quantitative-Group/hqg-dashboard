import Editor from "@monaco-editor/react";
import { useEffect, useMemo, useState } from "react";
import { useStrategyWorkspace } from "./layout";
import { deleteStrategyArtifact, renameStrategyArtifact, fetchFileRestrictions, DEFAULT_FILE_RESTRICTIONS, type FileRestrictions } from "~/api/strategyArtifacts";

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
    loadingFilePath,
    fileLoadError,
    strategy,
    addToast,
    addFile,
    deleteFile,
    renameFile,
  } = useStrategyWorkspace();

  const [editorReady, setEditorReady] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [showCreateInput, setShowCreateInput] = useState(false);
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isDeletingFile, setIsDeletingFile] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [fileRestrictions, setFileRestrictions] = useState<FileRestrictions>(DEFAULT_FILE_RESTRICTIONS);
  const codeFiles = useMemo(() => files, [files]);
  const selectedFile = useMemo(
    () => codeFiles.find((file) => file.path === selectedFilePath),
    [codeFiles, selectedFilePath]
  );
  const isLoadingFile = loadingFilePath !== null && loadingFilePath === selectedFilePath;

  useEffect(() => {
    setEditorReady(true);
    const loadRestrictions = async () => {
      const restrictions = await fetchFileRestrictions();
      setFileRestrictions(restrictions);
    };
    loadRestrictions();
  }, []);

  const handleCreateFile = async () => {
    if (!newFileName.trim() || !strategy) {
      addToast("Please enter a filename", "warning");
      return;
    }

    let fileName = newFileName.trim();
    // Default to .txt if no extension provided
    if (!fileName.includes(".")) {
      fileName = `${fileName}.txt`;
    }

    const fileExt = fileName.substring(fileName.lastIndexOf("."));
    if (!fileRestrictions.allowedExtensions.includes(fileExt.toLowerCase())) {
      addToast(`File type not allowed. Allowed types: ${fileRestrictions.allowedExtensions.join(", ")}`, "warning");
      return;
    }

    if (files.some((f) => f.path === fileName)) {
      addToast("File already exists", "warning");
      return;
    }

    setIsCreatingFile(true);
    try {
      const { uploadStrategyArtifacts } = await import("~/api/strategyArtifacts");
      const newFile = {
        path: fileName,
        language: fileName.endsWith(".py") ? "python" : fileName.endsWith(".txt") ? "plaintext" : "plaintext",
        content: "",
      };
      await uploadStrategyArtifacts(strategy.id, [newFile]);
      addFile(newFile);
      setNewFileName("");
      setShowCreateInput(false);
      selectFile(fileName);
      addToast(`Created file: ${fileName}`, "success");
    } catch (error) {
      console.error("Failed to create file", error);
      addToast("Failed to create file", "warning");
    } finally {
      setIsCreatingFile(false);
    }
  };

  const handleDeleteFile = async (filePath: string) => {
    if (fileRestrictions.lockedFiles.includes(filePath)) {
      addToast(`Cannot delete locked file: ${filePath}`, "warning");
      return;
    }

    if (!strategy || !confirm(`Delete ${filePath}?`)) {
      return;
    }

    setContextMenu(null);
    setIsDeletingFile(filePath);
    try {
      await deleteStrategyArtifact(strategy.id, filePath);
      deleteFile(filePath);
      addToast(`Deleted file: ${filePath}`, "success");
    } catch (error) {
      console.error("Failed to delete file", error);
      addToast("Failed to delete file", "warning");
    } finally {
      setIsDeletingFile(null);
    }
  };

  const handleRenameFile = async (oldPath: string) => {
    if (fileRestrictions.lockedFiles.includes(oldPath)) {
      addToast(`Cannot rename locked file: ${oldPath}`, "warning");
      setRenamingFile(null);
      setRenameValue("");
      return;
    }

    let newPath = renameValue.trim();
    if (!newPath || !strategy) {
      addToast("Please enter a filename", "warning");
      setRenamingFile(null);
      setRenameValue("");
      return;
    }

    const oldExtIndex = oldPath.lastIndexOf(".");
    const newExtIndex = newPath.lastIndexOf(".");
    const oldExt = oldExtIndex !== -1 ? oldPath.substring(oldExtIndex) : "";
    const newExt = newExtIndex !== -1 ? newPath.substring(newExtIndex) : "";

    if (oldExt && oldExt !== newExt) {
      newPath = newExtIndex !== -1 ? newPath.substring(0, newExtIndex) + oldExt : newPath + oldExt;
      addToast(`File type cannot be changed. Renamed to: ${newPath}`, "info");
    }

    if (newPath === oldPath) {
      setRenamingFile(null);
      setRenameValue("");
      return;
    }

    if (files.some((f) => f.path === newPath)) {
      addToast("File already exists", "warning");
      return;
    }

    setRenamingFile(null);
    try {
      await renameStrategyArtifact(strategy.id, oldPath, newPath);
      renameFile(oldPath, newPath);
      addToast(`Renamed file: ${oldPath} → ${newPath}`, "success");
    } catch (error) {
      console.error("Failed to rename file", error);
      addToast("Failed to rename file", "warning");
    } finally {
      setRenameValue("");
    }
  };

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
    <div className="grid gap-5 lg:grid-cols-[280px_1fr]" onClick={() => contextMenu && setContextMenu(null)}>
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

        <div className="mt-6 space-y-3">
          {!showCreateInput ? (
            <button
              type="button"
              onClick={() => setShowCreateInput(true)}
              className="w-full rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 px-3 py-2 text-sm font-semibold text-white transition hover:from-emerald-500 hover:to-teal-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-500"
            >
              + New File
            </button>
          ) : (
            <div className="space-y-2 rounded-xl border border-slate-700/60 bg-slate-900/20 p-3">
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    handleCreateFile();
                  } else if (e.key === "Escape") {
                    setShowCreateInput(false);
                    setNewFileName("");
                  }
                }}
                placeholder="e.g., strategy.py"
                className="w-full rounded-lg border border-slate-600 bg-slate-800/50 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleCreateFile}
                  disabled={isCreatingFile || !newFileName.trim()}
                  className="flex-1 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 px-2 py-1.5 text-xs font-semibold text-white transition disabled:opacity-50 hover:from-emerald-500 hover:to-teal-500"
                >
                  {isCreatingFile ? "Creating..." : "Create"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setShowCreateInput(false);
                    setNewFileName("");
                  }}
                  className="flex-1 rounded-lg border border-slate-600 px-2 py-1.5 text-xs font-semibold text-slate-300 transition hover:bg-slate-800/50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {codeFiles.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-3 py-6 text-center text-xs text-slate-500">
              No Python files available. Pull a strategy to begin editing.
            </div>
          ) : (
            codeFiles.map((file) => {
              const isActive = file.path === selectedFilePath;
              const isDeleting = isDeletingFile === file.path;
              const isRenaming = renamingFile === file.path;
              return (
                <div key={file.path} className="relative group">
                  {isRenaming ? (
                    <div className="flex items-center gap-2 rounded-xl border border-slate-700 bg-slate-900/40 px-3 py-2">
                      <input
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            handleRenameFile(file.path);
                          } else if (e.key === "Escape") {
                            setRenamingFile(null);
                            setRenameValue("");
                          }
                        }}
                        onBlur={() => {
                          setRenamingFile(null);
                          setRenameValue("");
                        }}
                        placeholder="Enter new filename"
                        className="flex-1 font-mono text-xs bg-transparent border-none outline-none text-white placeholder-slate-500"
                        autoFocus
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          if (!fileRestrictions.lockedFiles.includes(file.path)) {
                            setContextMenu(file.path);
                          }
                        }}
                        onDoubleClick={() => {
                          if (!fileRestrictions.lockedFiles.includes(file.path)) {
                            setRenamingFile(file.path);
                            setRenameValue(file.path);
                          }
                        }}
                        onClick={() => selectFile(file.path)}
                        disabled={isDeleting}
                        className={`w-full flex items-center gap-2 rounded-xl border ${fileRowClass} px-3 py-2 text-sm text-left transition ${isActive ? "bg-slate-800/80" : ""} ${isDeleting ? "opacity-50" : ""} disabled:opacity-50 hover:bg-slate-800/40`}
                        aria-current={isActive}
                      >
                        <span className={`flex-1 font-mono text-xs ${isActive ? fileActiveColor : fileIdleColor}`}>
                          {file.path}
                        </span>
                        <span className="inline-flex items-center gap-2">
                          {fileRestrictions.lockedFiles.includes(file.path) && (
                            <span className="text-xs text-amber-300">🔒</span>
                          )}
                          {file.isEntrypoint && <span className={badgeClass}>Entrypoint</span>}
                          {!file.isEntrypoint && file.path.toLowerCase().endsWith(".txt") && (
                            <span className={textBadgeClass}>TXT</span>
                          )}
                        </span>
                      </button>
                      {contextMenu === file.path && (
                        <div
                          className="absolute top-0 left-full z-50 ml-1 rounded-lg border border-slate-600 bg-slate-800 shadow-lg overflow-hidden min-w-max"
                          onMouseLeave={() => setContextMenu(null)}
                        >
                          <button
                            type="button"
                            onClick={() => handleDeleteFile(file.path)}
                            className="w-full px-4 py-2 text-left text-sm text-red-300 transition hover:bg-red-500/20"
                          >
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
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
          {isLoadingFile ? (
            <div className={`flex h-full items-center justify-center text-sm ${placeholderClass}`}>Loading file...</div>
          ) : selectedFile && editorReady ? (
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
              {fileLoadError ? fileLoadError : "Select a file to start editing"}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
