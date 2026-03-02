import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createStrategy, fetchStrategies, type Strategy } from "../api/strategies";
import { useUser } from "../context/UserConext";

type TemplateOption = {
  id: string;
  name: string;
};

export default function CreateStrategy() {
  const navigate = useNavigate();
  const { user } = useUser();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [strategyName, setStrategyName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchStrategies();
        if (!cancelled) {
          setStrategies(data);
          if (data.length) {
            setSelectedTemplateId("1");
          }
        }
      } catch (error) {
        console.error("Failed to load strategies", error);
        if (!cancelled) {
          setErrorMessage("Unable to load strategies");
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const templateOptions: TemplateOption[] = useMemo(
    () => strategies.map((s) => ({ id: s.id, name: s.name })),
    [strategies]
  );

  const selectedTemplate = useMemo(
    () => strategies.find((s) => s.id === selectedTemplateId) ?? null,
    [selectedTemplateId, strategies]
  );

  const selectedTemplateTags = selectedTemplate?.tags ?? [];
  const isFormValid = selectedTemplate && strategyName.trim();

  const handleAddTag = () => {
    const value = tagInput.trim();
    if (!value) return;
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTagInput("");
      return;
    }
    setTags((prev) => [...prev, value]);
    setTagInput("");
  };

  const handleRemoveTag = (value: string) => {
    setTags((prev) => prev.filter((tag) => tag.toLowerCase() !== value.toLowerCase()));
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!isFormValid || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const newStrategy = await createStrategy({
        sourceStrategyId: selectedTemplateId,
        name: strategyName.trim(),
        description,
        tags,
      });
      setSuccessMessage(`Created strategy ${newStrategy.name} (ID ${newStrategy.id})`);
      navigate(`/strategies/${newStrategy.id}`);
    } catch (error) {
      console.error("Failed to create strategy", error);
      setErrorMessage("Failed to create strategy");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 text-slate-100">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Create Strategy</h1>
        <p className="text-slate-400">Branch from an existing strategy and customize its metadata.</p>
      </header>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 shadow-lg space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">Template</p>
            <h2 className="text-lg font-semibold">Select Template Strategy</h2>
          </div>
          <span className="text-xs text-slate-500">{isLoading ? "Loading..." : `${strategies.length} available`}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_1.1fr]">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">Template Strategy</span>
            <select
              disabled={isLoading || !templateOptions.length}
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100 disabled:opacity-60"
            >
              {templateOptions.length === 0 ? (
                <option value="">No strategies available</option>
              ) : (
                templateOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Template Preview</p>
            {selectedTemplate ? (
              <div className="mt-2 space-y-2 text-sm text-slate-200">
                <div className="font-semibold text-white">{selectedTemplate.name}</div>
                <div className="text-slate-400 text-xs">
                  Owner: {selectedTemplate.owner_display ?? selectedTemplate.owner ?? "—"} · Updated:{" "}
                  {selectedTemplate.updated_at ? new Date(selectedTemplate.updated_at).toLocaleString() : "-"}
                </div>
                <div className="text-slate-300 text-xs line-clamp-3">
                  {selectedTemplate.description || "No description provided."}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {selectedTemplateTags.map((tag) => (
                    <span key={tag} className="rounded-full border border-slate-700 px-2 py-0.5 text-[11px] text-slate-200">
                      {tag}
                    </span>
                  ))}
                  {selectedTemplateTags.length === 0 && <span className="text-slate-500 text-xs">No tags</span>}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-slate-500">Choose a template strategy to preview its details.</p>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-slate-800 bg-slate-950/50 p-6 shadow-lg space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">Metadata</p>
          <h2 className="text-lg font-semibold">Define New Strategy</h2>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">New Strategy Name</span>
            <input
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className="rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              placeholder="My branched strategy"
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wide text-slate-500">README (markdown)</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="min-h-[140px] rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
              placeholder="Describe the strategy..."
            />
          </label>

          <label className="flex flex-col gap-2">
              <span className="text-xs uppercase tracking-wide text-slate-500">Tags</span>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full border border-slate-700 px-2 py-1 text-xs"
                  >
                    {tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove ${tag}`}>
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  className="flex-1 rounded-xl border border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-100"
                  placeholder="Add tag"
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-semibold text-white"
                >
                  Add
                </button>
              </div>
          </label>

          {errorMessage && <p className="text-sm text-rose-400">{errorMessage}</p>}
          {successMessage && <p className="text-sm text-emerald-400">{successMessage}</p>}

          <div className="flex gap-3">
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="rounded-xl bg-gradient-to-r from-indigo-500 to-fuchsia-600 px-5 py-2 text-sm font-semibold text-white disabled:opacity-60"
            >
              {isSubmitting ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/")}
              className="rounded-xl border border-slate-700 px-5 py-2 text-sm font-semibold text-slate-100"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
