import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { createStrategy, fetchStrategies, type Strategy } from "../api/strategies";

const STRATEGY_NAME_MAX_CHARS = 60;
const DESCRIPTION_MAX_CHARS = 75;
const README_MAX_CHARS = 10_000;
const TAGS_MAX_COUNT = 5;
const TAG_MAX_CHARS = 15;

const validateTags = (values: string[]): string | null => {
  if (values.length > TAGS_MAX_COUNT) {
    return `You can add up to ${TAGS_MAX_COUNT} tags.`;
  }

  const seen = new Set<string>();
  for (const rawTag of values) {
    const tag = rawTag.trim();
    if (!tag) {
      return "Tags cannot be empty.";
    }
    if (tag.length > TAG_MAX_CHARS) {
      return `Each tag must be ${TAG_MAX_CHARS} characters or fewer.`;
    }

    const key = tag.toLowerCase();
    if (seen.has(key)) {
      return "Duplicate tags are not allowed.";
    }
    seen.add(key);
  }

  return null;
};

type TemplateOption = {
  id: string;
  name: string;
};

export default function CreateStrategy() {
  const navigate = useNavigate();
  const [strategies, setStrategies] = useState<Strategy[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [strategyName, setStrategyName] = useState("");
  const [description, setDescription] = useState("");
  const [readmeContent, setReadmeContent] = useState("");
  const [hasEditedReadme, setHasEditedReadme] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [tagInputError, setTagInputError] = useState<string | null>(null);
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

  const trimmedStrategyName = strategyName.trim();
  const strategyNameLength = trimmedStrategyName.length;
  const selectedTemplateTags = selectedTemplate?.tags ?? [];
  const strategyNameError =
    strategyNameLength > STRATEGY_NAME_MAX_CHARS
      ? `Strategy name must be ${STRATEGY_NAME_MAX_CHARS} characters or fewer.`
      : null;
  const descriptionLength = description.length;
  const readmeLength = readmeContent.length;
  const descriptionError =
    descriptionLength > DESCRIPTION_MAX_CHARS
      ? `Description must be ${DESCRIPTION_MAX_CHARS} characters or fewer.`
      : null;
  const readmeError =
    readmeLength > README_MAX_CHARS
      ? `README must be ${README_MAX_CHARS} characters or fewer.`
      : null;
  const tagsError = useMemo(() => validateTags(tags), [tags]);
  const activeTagError = tagInputError ?? tagsError;
  const isFormValid = !!selectedTemplate && !!trimmedStrategyName && !strategyNameError && !descriptionError && !readmeError && !tagsError;

  useEffect(() => {
    if (hasEditedReadme) return;
    setReadmeContent(trimmedStrategyName ? `# ${trimmedStrategyName}` : "");
  }, [hasEditedReadme, trimmedStrategyName]);

  const handleAddTag = () => {
    setTagInputError(null);
    const value = tagInput.trim();
    if (!value) {
      setTagInputError("Tag cannot be empty.");
      return;
    }
    if (tags.length >= TAGS_MAX_COUNT) {
      setTagInputError(`You can add up to ${TAGS_MAX_COUNT} tags.`);
      return;
    }
    if (value.length > TAG_MAX_CHARS) {
      setTagInputError(`Tag must be ${TAG_MAX_CHARS} characters or fewer.`);
      return;
    }
    if (tags.some((t) => t.toLowerCase() === value.toLowerCase())) {
      setTagInputError("Duplicate tags are not allowed.");
      return;
    }
    setTags((prev) => [...prev, value]);
    setTagInput("");
  };

  const handleRemoveTag = (value: string) => {
    setTagInputError(null);
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
        name: trimmedStrategyName,
        description,
        readmeContent,
        tags: tags.map((tag) => tag.trim()),
      });
      setSuccessMessage(`Created strategy ${newStrategy.name} (ID ${newStrategy.id})`);
      navigate(`/strategies/${newStrategy.id}`);
    } catch (error) {
      console.error("Failed to create strategy", error);
        typeof error === "object" &&
        error !== null &&
        "response" in error &&
        typeof (error as { response?: { data?: { message?: unknown } } }).response?.data?.message === "string"
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="px-6 pb-20 max-w-full mx-auto space-y-6 pt-4">
      <header className="space-y-2 mb-6">
        <h1 className="font-extrabold font-headline tracking-tight text-on-surface text-4xl">Create Strategy</h1>
        <p className="text-on-surface-variant text-sm font-medium">Branch from an existing strategy and customize its metadata.</p>
      </header>

      <section className="glass-card ghost-border light-catch rounded-xl overflow-hidden w-full flex flex-col p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">Template</p>
            <h2 className="text-lg font-semibold text-on-surface">Select Template Strategy</h2>
          </div>
          <span className="text-xs text-on-surface-variant font-medium">{isLoading ? "Loading..." : `${strategies.length} available`}</span>
        </div>

        <div className="grid gap-4 sm:grid-cols-[1fr_1.1fr]">
          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">Template Strategy</span>
            <select
              disabled={isLoading || !templateOptions.length}
              value={selectedTemplateId}
              onChange={(e) => setSelectedTemplateId(e.target.value)}
              className="rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 px-3 py-2 text-sm text-on-surface hover:bg-surface-container-highest transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-secondary/50"
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

          <div className="rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 p-4">
            <p className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">Template Preview</p>
            {selectedTemplate ? (
              <div className="mt-2 space-y-2 text-sm text-on-surface">
                <div className="font-semibold text-on-surface">{selectedTemplate.name}</div>
                <div className="text-on-surface-variant text-xs">
                  Owner: {selectedTemplate.owner_display ?? selectedTemplate.owner ?? "—"} · Updated:{" "}
                  {selectedTemplate.updated_at ? new Date(selectedTemplate.updated_at).toLocaleString("en-US", {
                    year: "numeric",
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                    timeZoneName: "short",
                  }) : "-"}
                </div>
                <div className="text-on-surface-variant text-xs line-clamp-3">
                  {selectedTemplate.description || "No description provided."}
                </div>
                <div className="flex flex-wrap gap-1 pt-1">
                  {selectedTemplateTags.map((tag) => (
                    <span key={tag} className="rounded-md border border-outline-variant/30 px-2 py-0.5 text-[10px] text-on-surface-variant bg-white/5">
                      {tag}
                    </span>
                  ))}
                  {selectedTemplateTags.length === 0 && <span className="text-on-surface-variant text-xs">No tags</span>}
                </div>
              </div>
            ) : (
              <p className="mt-2 text-sm text-on-surface-variant">Choose a template strategy to preview its details.</p>
            )}
          </div>
        </div>
      </section>

      <section className="glass-card ghost-border light-catch rounded-xl overflow-hidden w-full flex flex-col p-6 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">Metadata</p>
          <h2 className="text-lg font-semibold text-on-surface">Define New Strategy</h2>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <label className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">New Strategy Name</span>
              <span
                className={`text-xs font-medium ${strategyNameLength > STRATEGY_NAME_MAX_CHARS ? "text-error" : "text-on-surface-variant"}`}
              >
                {strategyNameLength}/{STRATEGY_NAME_MAX_CHARS}
              </span>
            </div>
            <input
              value={strategyName}
              onChange={(e) => setStrategyName(e.target.value)}
              className="rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/60 hover:bg-surface-container-highest transition-colors focus:outline-none focus:ring-2 focus:ring-secondary/50"
              placeholder="My branched strategy"
            />
            {strategyNameError && <p className="text-sm text-error">{strategyNameError}</p>}
          </label>

          <label className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">Description</span>
              <span
                className={`text-xs font-medium ${descriptionLength > DESCRIPTION_MAX_CHARS ? "text-error" : "text-on-surface-variant"}`}
              >
                {descriptionLength}/{DESCRIPTION_MAX_CHARS}
              </span>
            </div>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/60 hover:bg-surface-container-highest transition-colors focus:outline-none focus:ring-2 focus:ring-secondary/50"
              placeholder="Short strategy summary for cards and listings"
            />
            {descriptionError && <p className="text-sm text-error">{descriptionError}</p>}
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">README (markdown)</span>
            <textarea
              value={readmeContent}
              onChange={(e) => {
                setHasEditedReadme(true);
                setReadmeContent(e.target.value);
              }}
              className="min-h-[140px] rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/60 hover:bg-surface-container-highest transition-colors focus:outline-none focus:ring-2 focus:ring-secondary/50"
              placeholder="# My strategy"
            />
            <div className={`text-xs font-medium ${readmeLength > README_MAX_CHARS ? "text-error" : "text-on-surface-variant"}`}>
              {readmeLength}/{README_MAX_CHARS}
            </div>
            {readmeError && <p className="text-sm text-error">{readmeError}</p>}
          </label>

          <label className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase tracking-wider font-bold text-on-surface-variant">Tags</span>
                <span className={`text-xs font-medium ${tags.length > TAGS_MAX_COUNT ? "text-error" : "text-on-surface-variant"}`}>
                  {tags.length}/{TAGS_MAX_COUNT}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-md border border-outline-variant/30 px-2 py-1 text-xs text-on-surface bg-white/5 hover:bg-white/10 transition-colors"
                  >
                    {tag}
                    <button type="button" onClick={() => handleRemoveTag(tag)} aria-label={`Remove ${tag}`} className="hover:text-secondary transition-colors">
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={tagInput}
                  onChange={(e) => {
                    setTagInput(e.target.value);
                    if (tagInputError) setTagInputError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleAddTag();
                    }
                  }}
                  disabled={tags.length >= TAGS_MAX_COUNT}
                  className="flex-1 rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 px-3 py-2 text-sm text-on-surface placeholder-on-surface-variant/60 hover:bg-surface-container-highest transition-colors disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-secondary/50"
                  placeholder={`Add tag (max ${TAG_MAX_CHARS} chars)`}
                />
                <button
                  type="button"
                  onClick={handleAddTag}
                  disabled={tags.length >= TAGS_MAX_COUNT}
                  className="rounded-lg bg-secondary/20 hover:bg-secondary/30 border border-secondary/30 px-3 py-2 text-sm font-semibold text-secondary-fixed-dim transition-colors disabled:opacity-60"
                >
                  Add
                </button>
              </div>
              {activeTagError && <p className="text-sm text-error">{activeTagError}</p>}
          </label>

          {errorMessage && <p className="text-sm text-error font-medium">{errorMessage}</p>}
          {successMessage && <p className="text-sm text-emerald-400 font-medium">{successMessage}</p>}

          <div className="flex gap-3 pt-2">
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className={`rounded-lg font-semibold text-xs uppercase tracking-wider px-6 py-2 transition-all duration-200 ${
                !isFormValid || isSubmitting
                  ? "bg-on-surface-variant/30 text-on-surface-variant/50 cursor-not-allowed"
                  : "bg-gradient-to-r from-primary to-secondary text-on-primary hover:opacity-90 shadow-lg shadow-primary/30"
              }`}
            >
              {isSubmitting ? "Creating..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => navigate("/strategies")}
              className="rounded-lg border border-outline-variant/30 bg-surface-container-highest/50 text-on-surface hover:bg-surface-container-highest transition-colors font-semibold text-xs uppercase tracking-wider px-6 py-2"
            >
              Cancel
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
