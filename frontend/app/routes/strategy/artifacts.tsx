import { useMemo, useState } from "react";
import type { FormEvent } from "react";
import { useStrategyWorkspace, type ArtifactType } from "./layout";

const ARTIFACT_TYPES = [
  { label: "Dataset", value: "dataset" },
  { label: "Document", value: "document" },
  { label: "Model", value: "model" },
  { label: "Config", value: "config" },
];

type ArtifactKind = ArtifactType;

export default function StrategyArtifacts() {
  const { artifacts, addArtifactRecord, removeArtifactRecord } = useStrategyWorkspace();
  const [name, setName] = useState("");
  const [type, setType] = useState<ArtifactKind>("dataset");
  const [size, setSize] = useState("1 MB");
  const [description, setDescription] = useState("");

  const formatter = useMemo(
    () =>
      new Intl.DateTimeFormat("en", {
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }),
    []
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim()) {
      return;
    }

    addArtifactRecord({ name: name.trim(), type, size: size.trim() || "—", description: description.trim() });
    setName("");
    setDescription("");
    setSize("1 MB");
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
        <h2 className="text-lg font-semibold">Add artifact</h2>
        <p className="mt-1 text-xs text-slate-500">
          Attach supporting files (datasets, configs, docs). These items are referenced by runs but are not opened inside the
          editor.
        </p>
        <form className="mt-5 space-y-4 text-sm" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Name</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500"
              placeholder="alpha-signals.parquet"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Type</span>
            <select
              value={type}
              onChange={(event) => setType(event.target.value as ArtifactKind)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
            >
              {ARTIFACT_TYPES.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Size</span>
            <input
              value={size}
              onChange={(event) => setSize(event.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              placeholder="4 MB"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs uppercase tracking-wide text-slate-500">Description</span>
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className="min-h-[88px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              placeholder="What does this artifact contain?"
            />
          </label>
          <button
            type="submit"
            className="w-full rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Attach artifact
          </button>
        </form>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/40 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold">Stored artifacts</h2>
            <p className="text-xs text-slate-500">Binary assets linked to this strategy. They are immutable within the editor.</p>
          </div>
        </div>
        <div className="mt-4 space-y-3">
          {artifacts.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-8 text-center text-sm text-slate-500">
              No artifacts yet. Attach datasets, reports, or configs to keep everything in one place.
            </div>
          ) : (
            artifacts.map((artifact) => (
              <article
                key={artifact.id}
                className="rounded-2xl border border-slate-800 bg-slate-950/60 px-4 py-4 text-sm text-slate-200"
              >
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold text-white">{artifact.name}</div>
                    <p className="text-xs text-slate-500">Last updated {formatter.format(new Date(artifact.updatedAt))}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeArtifactRecord(artifact.id)}
                    className="text-xs text-slate-500 hover:text-rose-400"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="rounded-full border border-slate-700 px-2 py-0.5 uppercase tracking-wide text-[10px]">
                    {artifact.type}
                  </span>
                  <span>{artifact.size}</span>
                  <span>• Added by {artifact.addedBy}</span>
                </div>
                <p className="mt-2 text-sm text-slate-300">{artifact.description || "No description"}</p>
              </article>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
