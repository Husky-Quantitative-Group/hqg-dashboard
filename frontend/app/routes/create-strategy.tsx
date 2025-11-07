import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

type BaseStrategy = {
  id: string;
  name: string;
  summary: string;
  project: string;
  tags: string[];
  lastUpdated: string;
  type: "template" | "strategy";
  entrypoint: string;
};

type Project = {
  id: string;
  name: string;
  slug: string;
  description: string;
  strategies: string[];
};

type CreateStrategyPayload = {
  baseStrategyId: string;
  projectName: string;
  projectSlug: string;
  strategyName: string;
  strategySlug: string;
  description: string;
  tags: string[];
  universe: string[];
  includeRequirements: boolean;
  copyMode: CopyMode;
};

type CreateStrategyResult = {
  repoPath: string;
  githubUrl: string;
  cloneCommand: string;
};

type CopyMode = "full" | "main";

const BASE_STRATEGY_SEED: BaseStrategy[] = [
  {
    id: "mean-reversion-template",
    name: "Mean Reversion Template",
    summary: "Starter template with signal + execution stubs",
    project: "core-templates",
    tags: ["equities", "template", "mean reversion"],
    lastUpdated: "2 days ago",
    type: "template",
    entrypoint: "main.py",
  },
  {
    id: "pairs-trading-v3",
    name: "Pairs Trading v3",
    summary: "Fully working implementation with Kalman filter",
    project: "market-neutral",
    tags: ["equities", "market neutral", "stat arb"],
    lastUpdated: "6 days ago",
    type: "strategy",
    entrypoint: "pairs_trading.py",
  },
  {
    id: "vol-breakout-lite",
    name: "Vol Breakout Lite",
    summary: "Lightweight momentum system for CME futures",
    project: "global-futures",
    tags: ["futures", "momentum"],
    lastUpdated: "12 days ago",
    type: "strategy",
    entrypoint: "vol_breakout.py",
  },
  {
    id: "crypto-basis-template",
    name: "Crypto Basis Template",
    summary: "Template for funding-basis arbitrage trades",
    project: "digital-assets",
    tags: ["crypto", "basis", "template"],
    lastUpdated: "3 weeks ago",
    type: "template",
    entrypoint: "entrypoint.py",
  },
];

const PROJECT_SEED: Project[] = [
  {
    id: "global-macro",
    name: "Global Macro Lab",
    slug: "global-macro",
    description: "FX, rates, and futures discretionary systems",
    strategies: ["carry-alpha", "vol-breakout-lite"],
  },
  {
    id: "digital-assets",
    name: "Digital Assets Pod",
    slug: "digital-assets",
    description: "Systematic crypto strategies",
    strategies: ["crypto-basis-template", "btc-momo"],
  },
  {
    id: "market-neutral",
    name: "Market Neutral",
    slug: "market-neutral",
    description: "Long/short equity and stat-arb",
    strategies: ["pairs-trading-v3"],
  },
];

const TAG_CATALOG = [
  "momentum",
  "carry",
  "fx",
  "options",
  "futures",
  "crypto",
  "market neutral",
  "stat arb",
  "machine learning",
  "volatility",
  "event driven",
];

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function mockFetchBaseStrategies(): Promise<BaseStrategy[]> {
  await delay(300);
  return BASE_STRATEGY_SEED;
}

async function mockFetchProjects(): Promise<Project[]> {
  await delay(200);
  return PROJECT_SEED;
}

async function mockCreateStrategy(
  payload: CreateStrategyPayload
): Promise<CreateStrategyResult> {
  await delay(1000);

  return {
    repoPath: `hqg-strategies/projects/${payload.projectSlug}/${payload.strategySlug}`,
    githubUrl: `https://github.com/hqg/${payload.projectSlug}/${payload.strategySlug}`,
    cloneCommand: `git clone git@github.com:hqg/${payload.projectSlug}/${payload.strategySlug}.git`,
  };
}

const slugify = (value: string) =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const formatProjectName = (slug: string) =>
  slug
    .split("-")
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");

function useCreateStrategyData() {
  const [baseStrategies, setBaseStrategies] = useState<BaseStrategy[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    setIsLoading(true);

    Promise.all([mockFetchBaseStrategies(), mockFetchProjects()])
      .then(([bases, projectList]) => {
        if (!isMounted) return;
        setBaseStrategies(bases);
        setProjects(projectList);
      })
      .finally(() => {
        if (isMounted) {
          setIsLoading(false);
        }
      });

    return () => {
      isMounted = false;
    };
  }, []);

  return { baseStrategies, projects, isLoading };
}

function useTags() {
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const availableTags = useMemo(
    () =>
      TAG_CATALOG.filter(
        (tag) =>
          !selectedTags.some(
            (chosen) => chosen.toLowerCase() === tag.toLowerCase()
          )
      ),
    [selectedTags]
  );

  const filteredSuggestions = useMemo(() => {
    const normalized = tagInput.trim().toLowerCase();

    if (!normalized) {
      return availableTags.slice(0, 6);
    }

    return availableTags
      .filter((tag) => tag.toLowerCase().includes(normalized))
      .slice(0, 6);
  }, [availableTags, tagInput]);

  const addTag = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;

    const exists = selectedTags.some(
      (tag) => tag.toLowerCase() === cleaned.toLowerCase()
    );
    if (exists) {
      setTagInput("");
      return;
    }

    setSelectedTags((prev) => [...prev, cleaned]);
    setTagInput("");
  };

  const removeTag = (value: string) => {
    setSelectedTags((prev) =>
      prev.filter((tag) => tag.toLowerCase() !== value.toLowerCase())
    );
  };

  return {
    selectedTags,
    tagInput,
    setTagInput,
    filteredSuggestions,
    addTag,
    removeTag,
  };
}

function useChipField(initial: string[] = []) {
  const [chips, setChips] = useState(initial);
  const [inputValue, setInputValue] = useState("");

  const addChip = (value: string) => {
    const cleaned = value.trim();
    if (!cleaned) return;

    setChips((prev) => {
      const exists = prev.some(
        (chip) => chip.toLowerCase() === cleaned.toLowerCase()
      );
      if (exists) {
        return prev;
      }
      return [...prev, cleaned];
    });
    setInputValue("");
  };

  const removeChip = (value: string) => {
    setChips((prev) =>
      prev.filter((chip) => chip.toLowerCase() !== value.toLowerCase())
    );
  };

  return { chips, inputValue, setInputValue, addChip, removeChip };
}

function StrategySuccessCard({
  result,
  onDismiss,
}: {
  result: CreateStrategyResult | null;
  onDismiss: () => void;
}) {
  if (!result) return null;

  return (
    <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-5 text-sm text-slate-100">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-base font-semibold text-emerald-300">
            Strategy created successfully
          </p>
          <p className="text-slate-300">{result.repoPath}</p>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="rounded-full border border-emerald-400/60 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-emerald-200 transition hover:bg-emerald-400/10"
        >
          Dismiss
        </button>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="text-xs uppercase text-slate-500">Open in GitHub</div>
          <a
            href={result.githubUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block break-all text-sm text-emerald-200 hover:underline"
          >
            {result.githubUrl}
          </a>
        </div>
        <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4">
          <div className="text-xs uppercase text-slate-500">Clone locally</div>
          <code className="mt-1 block break-all text-sm text-emerald-100">
            {result.cloneCommand}
          </code>
        </div>
      </div>
    </div>
  );
}

export default function CreateStrategy() {
  const navigate = useNavigate();
  const { baseStrategies, projects, isLoading } = useCreateStrategyData();

  const [selectedBaseProject, setSelectedBaseProject] = useState("");
  const [selectedBase, setSelectedBase] = useState("");
  const [projectMode, setProjectMode] = useState<"existing" | "new">(
    "existing"
  );
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [newProjectName, setNewProjectName] = useState("");
  const [strategyName, setStrategyName] = useState("");
  const [description, setDescription] = useState("");
  const {
    chips: universe,
    inputValue: universeInput,
    setInputValue: setUniverseInput,
    addChip: addUniverse,
    removeChip: removeUniverse,
  } = useChipField();
  const {
    selectedTags,
    tagInput,
    setTagInput,
    filteredSuggestions,
    addTag,
    removeTag,
  } = useTags();
  const [includeRequirements, setIncludeRequirements] = useState(true);
  const [copyMode, setCopyMode] = useState<CopyMode>("full");
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<CreateStrategyResult | null>(null);

  const baseProjectOptions = useMemo(() => {
    const unique = new Map<string, { id: string; label: string }>();
    baseStrategies.forEach((strategy) => {
      if (!unique.has(strategy.project)) {
        unique.set(strategy.project, {
          id: strategy.project,
          label: formatProjectName(strategy.project),
        });
      }
    });
    return Array.from(unique.values());
  }, [baseStrategies]);

  const availableBaseStrategies = useMemo(() => {
    if (!selectedBaseProject) {
      return baseStrategies;
    }
    return baseStrategies.filter(
      (strategy) => strategy.project === selectedBaseProject
    );
  }, [baseStrategies, selectedBaseProject]);

  const selectedBaseStrategy =
    baseStrategies.find((strategy) => strategy.id === selectedBase) ?? null;
  const entrypointLabel = selectedBaseStrategy?.entrypoint ?? "entrypoint.py";

  useEffect(() => {
    if (baseProjectOptions.length && !selectedBaseProject) {
      setSelectedBaseProject(baseProjectOptions[0].id);
    }
  }, [baseProjectOptions, selectedBaseProject]);

  useEffect(() => {
    if (!availableBaseStrategies.length) {
      if (selectedBase) {
        setSelectedBase("");
      }
      return;
    }

    const exists = availableBaseStrategies.some(
      (strategy) => strategy.id === selectedBase
    );

    if (!exists) {
      setSelectedBase(availableBaseStrategies[0].id);
    }
  }, [availableBaseStrategies, selectedBase]);

  useEffect(() => {
    if (projects.length && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  const currentProject =
    projectMode === "existing"
      ? projects.find((p) => p.id === selectedProjectId)
      : null;

  const projectName =
    projectMode === "existing"
      ? currentProject?.name ?? ""
      : newProjectName.trim();
  const projectSlug =
    projectMode === "existing"
      ? currentProject?.slug ?? ""
      : slugify(newProjectName) || "new-project";

  const normalizedStrategy = strategyName.trim();
  const strategySlug = slugify(strategyName) || "new-strategy";

  const isUniqueStrategyName = useMemo(() => {
    if (!normalizedStrategy) return true;
    if (projectMode === "new") return true;
    if (!currentProject) return true;
    return !currentProject.strategies.some(
      (name) => name.toLowerCase() === normalizedStrategy.toLowerCase()
    );
  }, [currentProject, normalizedStrategy, projectMode]);

  const strategyNameError = !normalizedStrategy
    ? "Strategy name is required."
    : !isUniqueStrategyName
    ? "A strategy with this name already exists in the selected project."
    : "";

  const projectError =
    projectMode === "existing"
      ? !selectedProjectId
        ? "Select a project."
        : ""
      : !newProjectName.trim()
      ? "Provide a name for the new project."
      : "";

  const baseError = !selectedBase ? "Pick a base strategy." : "";

  const isFormValid =
    !strategyNameError && !projectError && !baseError && !!projectSlug;

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    markTouched("base");
    markTouched("project");
    markTouched("strategyName");

    if (!isFormValid || isSubmitting) return;

    setIsSubmitting(true);
    setErrorMessage(null);

    const payload: CreateStrategyPayload = {
      baseStrategyId: selectedBase,
      projectName,
      projectSlug,
      strategyName: normalizedStrategy,
      strategySlug,
      description: description.trim(),
      tags: selectedTags,
      universe,
      includeRequirements,
      copyMode,
    };

    try {
      const response = await mockCreateStrategy(payload);
      setResult(response);
    } catch (err) {
      console.error(err);
      setErrorMessage("Unable to create strategy. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancel = () => {
    navigate("/strategies");
  };

  const handleTagKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (tagInput.trim()) {
        addTag(tagInput);
      }
    } else if (event.key === "Backspace" && !tagInput && selectedTags.length) {
      removeTag(selectedTags[selectedTags.length - 1]);
    }
  };

  const handleUniverseKeyDown = (
    event: React.KeyboardEvent<HTMLInputElement>
  ) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      if (universeInput.trim()) {
        addUniverse(universeInput);
      }
    } else if (event.key === "Backspace" && !universeInput && universe.length) {
      removeUniverse(universe[universe.length - 1]);
    }
  };

  const handleUniverseBlur = () => {
    if (universeInput.trim()) {
      addUniverse(universeInput);
    }
  };

  return (
    <div className="min-h-screen px-6 py-10 text-white lg:px-10">
      <div className="mx-auto max-w-4xl space-y-8">
        <header className="space-y-2">
          <p className="text-sm uppercase tracking-[0.2em] text-slate-500">
            Strategy Workspace
          </p>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white">
                Create a new strategy
              </h1>
              <p className="mt-2 max-w-2xl text-sm text-slate-400">
                Select a base implementation, decide where it should live, and
                capture metadata so collaborators can discover it quickly.
              </p>
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancel}
                className="rounded-full border border-slate-700 px-5 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
              >
                Cancel
              </button>
              <button
                type="submit"
                form="create-strategy-form"
                disabled={!isFormValid || isSubmitting}
                className="rounded-full bg-gradient-to-r from-[#CB3CFF] to-indigo-500 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-[#CB3CFF]/30 transition disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSubmitting ? "Creating..." : "Create strategy"}
              </button>
            </div>
          </div>
        </header>

        <StrategySuccessCard result={result} onDismiss={() => setResult(null)} />

        {errorMessage && (
          <div className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-4 text-sm text-rose-100">
            {errorMessage}
          </div>
        )}

        <form
          id="create-strategy-form"
          onSubmit={handleSubmit}
          className="space-y-6"
        >
          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
            <div>
              <p className="text-sm uppercase tracking-wide text-slate-500">
                Base strategy
              </p>
              <h2 className="text-xl font-semibold text-white">
                Start from an existing project
              </h2>
              <p className="text-sm text-slate-400">
                Pick a project to browse its templates or live strategies, then
                choose what to clone.
              </p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label
                  htmlFor="base-project"
                  className="text-xs uppercase tracking-wide text-slate-400"
                >
                  Template project
                </label>
                <select
                  id="base-project"
                  value={selectedBaseProject}
                  onChange={(event) => {
                    setSelectedBaseProject(event.target.value);
                    markTouched("base");
                  }}
                  onBlur={() => markTouched("base")}
                  disabled={!baseProjectOptions.length}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-white focus:border-[#CB3CFF] focus:ring-2 focus:ring-[#CB3CFF]/30 disabled:opacity-50"
                >
                  {!baseProjectOptions.length && (
                    <option value="">Loading projects...</option>
                  )}
                  {baseProjectOptions.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label
                  htmlFor="base-strategy"
                  className="text-xs uppercase tracking-wide text-slate-400"
                >
                  Strategy template
                </label>
                <select
                  id="base-strategy"
                  value={selectedBase}
                  onChange={(event) => {
                    setSelectedBase(event.target.value);
                    markTouched("base");
                  }}
                  onBlur={() => markTouched("base")}
                  disabled={!availableBaseStrategies.length}
                  className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-white focus:border-[#CB3CFF] focus:ring-2 focus:ring-[#CB3CFF]/30 disabled:opacity-50"
                >
                  {!availableBaseStrategies.length && (
                    <option value="">No strategies available</option>
                  )}
                  {availableBaseStrategies.map((strategy) => (
                    <option key={strategy.id} value={strategy.id}>
                      {strategy.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {selectedBaseStrategy && (
              <div className="rounded-2xl border border-slate-800 bg-slate-950/40 p-4">
                <div className="flex flex-wrap items-center gap-3 text-xs uppercase tracking-wide">
                  <span
                    className={[
                      "rounded-full px-2.5 py-0.5 font-semibold",
                      selectedBaseStrategy.type === "template"
                        ? "bg-slate-800 text-slate-200"
                        : "bg-[#CB3CFF]/10 text-[#CB3CFF]",
                    ].join(" ")}
                  >
                    {selectedBaseStrategy.type === "template"
                      ? "Template"
                      : "Strategy"}
                  </span>
                  <span className="text-slate-500">
                    Updated {selectedBaseStrategy.lastUpdated}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-semibold text-white">
                  {selectedBaseStrategy.name}
                </h3>
                <p className="mt-1 text-sm text-slate-400">
                  {selectedBaseStrategy.summary}
                </p>
                <div className="mt-3 text-xs font-medium text-slate-300">
                  Entrypoint ·{" "}
                  <span className="text-white">
                    {selectedBaseStrategy.entrypoint}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedBaseStrategy.tags.map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full bg-slate-800/80 px-2 py-0.5 text-xs text-slate-300"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div className="space-y-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">
                Copy scope
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                <label
                  className={[
                    "cursor-pointer rounded-2xl border p-4 transition",
                    copyMode === "full"
                      ? "border-[#CB3CFF] bg-slate-950/60"
                      : "border-slate-800 bg-slate-950/30 hover:border-slate-700",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="copy-mode"
                      value="full"
                      checked={copyMode === "full"}
                      onChange={() => setCopyMode("full")}
                      className="h-4 w-4 border-slate-600 text-[#CB3CFF] focus:ring-[#CB3CFF]"
                    />
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Copy entire directory
                      </p>
                      <p className="text-xs text-slate-400">
                        Duplicates notebooks, utils, configs, and assets from the base strategy.
                      </p>
                    </div>
                  </div>
                </label>

                <label
                  className={[
                    "cursor-pointer rounded-2xl border p-4 transition",
                    copyMode === "main"
                      ? "border-[#CB3CFF] bg-slate-950/60"
                      : "border-slate-800 bg-slate-950/30 hover:border-slate-700",
                  ].join(" ")}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="radio"
                      name="copy-mode"
                      value="main"
                      checked={copyMode === "main"}
                      onChange={() => setCopyMode("main")}
                      className="h-4 w-4 border-slate-600 text-[#CB3CFF] focus:ring-[#CB3CFF]"
                    />
                    <div>
                      <p className="text-sm font-semibold text-white">
                        Copy only {entrypointLabel}
                      </p>
                      <p className="text-xs text-slate-400">
                        Starts from a clean folder and pulls just {entrypointLabel}.
                      </p>
                    </div>
                  </div>
                </label>
              </div>
            </div>

            {baseError && touched.base && (
              <p className="text-sm text-rose-400">{baseError}</p>
            )}
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-sm uppercase tracking-wide text-slate-500">
                  Placement
                </p>
                <h2 className="text-xl font-semibold text-white">
                  Choose the destination project
                </h2>
                <p className="text-sm text-slate-400">
                  Drop the cloned strategy into an existing project or create a
                  new workspace on the fly.
                </p>
              </div>
              <button
                type="button"
                onClick={() =>
                  setProjectMode((mode) => (mode === "existing" ? "new" : "existing"))
                }
                className="rounded-full border border-slate-700 px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-slate-200 transition hover:border-slate-500"
              >
                {projectMode === "existing" ? "+ New Project" : "Use Existing"}
              </button>
            </div>

            <div className="space-y-3">
              {projectMode === "existing" ? (
                <div>
                  <label
                    htmlFor="project-select"
                    className="text-xs uppercase tracking-wide text-slate-400"
                  >
                    Project
                  </label>
                  <select
                    id="project-select"
                    value={selectedProjectId}
                    onChange={(e) => {
                      setSelectedProjectId(e.target.value);
                      markTouched("project");
                    }}
                    onBlur={() => markTouched("project")}
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-white focus:border-[#CB3CFF] focus:ring-2 focus:ring-[#CB3CFF]/30"
                  >
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>
                        {project.name} · {project.slug}
                      </option>
                    ))}
                  </select>
                  {currentProject && (
                    <p className="mt-2 text-sm text-slate-400">
                      {currentProject.description}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label
                    htmlFor="new-project-name"
                    className="text-xs uppercase tracking-wide text-slate-400"
                  >
                    New project name
                  </label>
                  <input
                    id="new-project-name"
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    onBlur={() => markTouched("project")}
                    placeholder="e.g. vol-arb-lab"
                    className="mt-2 w-full rounded-xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-[#CB3CFF] focus:ring-2 focus:ring-[#CB3CFF]/30"
                  />
                  <p className="mt-2 text-sm text-slate-400">
                    Folder will be created at{" "}
                    <span className="text-slate-100">
                      hqg-strategies/projects/{projectSlug || "new-project"}
                    </span>
                  </p>
                </div>
              )}

              {projectError && touched.project && (
                <p className="text-sm text-rose-400">{projectError}</p>
              )}
            </div>
          </section>

          <section className="rounded-2xl border border-slate-800 bg-slate-900/60 p-6 space-y-6">
            <div>
              <p className="text-sm uppercase tracking-wide text-slate-500">
                Metadata
              </p>
              <h2 className="text-xl font-semibold text-white">
                Describe the new strategy
              </h2>
              <p className="text-sm text-slate-400">
                Name, describe, and tag the strategy so others can find it
                later.
              </p>
            </div>

            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <label
                  htmlFor="strategy-name"
                  className="text-xs uppercase tracking-wide text-slate-400"
                >
                  Strategy name
                </label>
                <input
                  id="strategy-name"
                  value={strategyName}
                  onChange={(e) => setStrategyName(e.target.value)}
                  onBlur={() => markTouched("strategyName")}
                  placeholder="e.g. G10 Momentum Sweep"
                  className={[
                    "mt-2 w-full rounded-xl border px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-[#CB3CFF] focus:ring-2 focus:ring-[#CB3CFF]/30",
                    touched.strategyName && strategyNameError
                      ? "border-rose-500"
                      : "border-slate-800 bg-slate-950/30",
                  ].join(" ")}
                />
                <p className="mt-2 text-xs text-slate-400">
                  Strategy names must be unique within a project.
                  {!isUniqueStrategyName && (
                    <span className="ml-1 text-rose-300">
                      This name already exists.
                    </span>
                  )}
                </p>
                {touched.strategyName && strategyNameError && (
                  <p className="mt-1 text-sm text-rose-400">
                    {strategyNameError}
                  </p>
                )}
              </div>

              <div>
                <label
                  htmlFor="universe-input"
                  className="text-xs uppercase tracking-wide text-slate-400"
                >
                  Universe
                </label>
                <div className="mt-2 rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
                  <div className="flex flex-wrap gap-2">
                    {universe.map((symbol) => (
                      <span
                        key={symbol}
                        className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1 text-xs text-slate-200"
                      >
                        {symbol}
                        <button
                          type="button"
                          onClick={() => removeUniverse(symbol)}
                          className="text-slate-400 transition hover:text-white"
                          aria-label={`Remove ${symbol}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    <input
                      id="universe-input"
                      value={universeInput}
                      onChange={(e) => setUniverseInput(e.target.value)}
                      onBlur={handleUniverseBlur}
                      onKeyDown={handleUniverseKeyDown}
                      placeholder={
                        universe.length ? "Add symbol..." : "Add universe symbols..."
                      }
                      className="flex-1 min-w-[150px] border-none bg-transparent px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                    />
                  </div>
                  <p className="mt-2 text-xs text-slate-500">
                    Press enter or comma to add tickers, venues, or baskets.
                  </p>
                </div>
              </div>
            </div>

            <div>
              <label
                htmlFor="description"
                className="text-xs uppercase tracking-wide text-slate-400"
              >
                Description
              </label>
              <textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What problem does this strategy solve? Outline the thesis, signal, and risk framework."
                rows={4}
                className="mt-2 w-full rounded-2xl border border-slate-800 bg-slate-950/30 px-4 py-3 text-sm text-white placeholder:text-slate-500 focus:border-[#CB3CFF] focus:ring-2 focus:ring-[#CB3CFF]/30"
              />
            </div>

            <div>
              <label className="text-xs uppercase tracking-wide text-slate-400">
                Tags
              </label>
              <div className="mt-2 rounded-2xl border border-slate-800 bg-slate-950/30 p-3">
                <div className="flex flex-wrap gap-2">
                  {selectedTags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center gap-2 rounded-full bg-slate-800/80 px-3 py-1 text-xs text-slate-200"
                    >
                      {tag}
                      <button
                        type="button"
                        onClick={() => removeTag(tag)}
                        className="text-slate-400 transition hover:text-white"
                        aria-label={`Remove ${tag}`}
                      >
                        ×
                      </button>
                    </span>
                  ))}
                  <input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={handleTagKeyDown}
                    placeholder={
                      selectedTags.length ? "Add tag..." : "Search tags..."
                    }
                    className="flex-1 min-w-[150px] border-none bg-transparent px-2 py-1 text-sm text-white placeholder:text-slate-500 focus:outline-none"
                  />
                </div>
                {filteredSuggestions.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {filteredSuggestions.map((suggestion) => (
                      <button
                        type="button"
                        key={suggestion}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          addTag(suggestion);
                        }}
                        className="rounded-full border border-slate-700 px-3 py-1 text-xs text-slate-300 transition hover:border-[#CB3CFF] hover:text-white"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-950/30 px-4 py-3">
              <div>
                <p className="text-sm font-medium text-white">
                  Create requirements.txt
                </p>
                <p className="text-xs text-slate-400">
                  Generates an empty file inside the new strategy folder.
                </p>
              </div>
              <label className="inline-flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={includeRequirements}
                  onChange={(e) => setIncludeRequirements(e.target.checked)}
                  className="h-5 w-5 rounded border border-slate-600 bg-slate-900 checked:border-[#CB3CFF] checked:bg-[#CB3CFF]"
                />
                <span className="text-sm text-slate-200">
                  {includeRequirements ? "Enabled" : "Disabled"}
                </span>
              </label>
            </div>
          </section>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={handleCancel}
              className="rounded-full border border-slate-700 px-5 py-2 text-sm font-medium text-slate-300 transition hover:border-slate-500 hover:text-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFormValid || isSubmitting}
              className="rounded-full bg-gradient-to-r from-[#CB3CFF] to-indigo-500 px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-[#CB3CFF]/30 transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Creating..." : "Create strategy"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
