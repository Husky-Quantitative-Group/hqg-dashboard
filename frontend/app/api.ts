import axios from "axios";

export interface Strategy {
  _id: string;
  strategyId: string;
  name: string;
  description?: string;
  owner?: string;
  project: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  metrics?: {
    sharpe?: number;
    sortino?: number;
    maxDrawdown?: number;
    winRate?: number;
  };
}

export type StrategyFile = {
  path: string;
  language: string;
  content: string;
  isEntrypoint?: boolean;
};

export type ArtifactType = "dataset" | "document" | "model" | "config";

export type StrategyArtifact = {
  id: string;
  name: string;
  type: ArtifactType;
  description: string;
  size: string;
  updatedAt: string;
  addedBy: string;
};

export type BacktestResult = {
  name: string;
  id: number;
  strategyVersion: number;
  startedAt: string;
  durationSeconds: number;
  parameterName: string;
  parameterStartDate: string;
  parameterEndDate: string;
  startingEquity: number;
  metrics: {
    netPnl: number;
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
    trades: number;
  };
};

export type WorkspaceStrategy = {
  id: number;
  projectId: number;
  projectName: string;
  name: string;
  owner: string;
  tags: string[];
  description: string;
  createdAt: string;
  updatedAt: string;
  files: StrategyFile[];
  artifacts: StrategyArtifact[];
  readme: string;
};

export type StrategyWorkspaceResponse = {
  strategy: WorkspaceStrategy;
  runs: BacktestResult[];
};

// Real API base configuration
const CORE_API_BASE_URL = import.meta.env.VITE_CORE_API ?? "http://localhost:5000";
const CORE_API_TOKEN = import.meta.env.VITE_API_TOKEN ?? "";

const coreApi = axios.create({
  baseURL: CORE_API_BASE_URL,
  headers: CORE_API_TOKEN ? { "x-api-token": CORE_API_TOKEN } : undefined,
});

// Legacy/mock client (used only by local helpers below)
const apiClient = axios.create({
  baseURL: "http://localhost:5000",
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const cloneFiles = (files: StrategyFile[]): StrategyFile[] => files.map((file) => ({ ...file }));

const cloneArtifacts = (artifacts: StrategyArtifact[]): StrategyArtifact[] => artifacts.map((artifact) => ({ ...artifact }));

const cloneRuns = (runs: BacktestResult[]): BacktestResult[] =>
  runs.map((run) => ({
    ...run,
    metrics: { ...run.metrics },
  }));

const cloneWorkspace = (strategy: WorkspaceStrategy): WorkspaceStrategy => ({
  ...strategy,
  files: cloneFiles(strategy.files),
  artifacts: cloneArtifacts(strategy.artifacts),
});

const createMockRuns = (seedKey: string | number): BacktestResult[] => {
  const now = Date.now();

  return [
    {
      name: `${seedKey}-run-3`,
      id: 3,
      strategyVersion: 12,
      startedAt: new Date(now - 1000 * 60 * 45).toISOString(),
      durationSeconds: 148,
      parameterName: "Run 3",
      parameterStartDate: "Jan 03 2024",
      parameterEndDate: "Jan 30 2024",
      startingEquity: 100_000,
      metrics: {
        netPnl: 12_480,
        sharpe: 1.46,
        winRate: 0.58,
        maxDrawdown: 0.032,
        trades: 142,
      },
    },
    {
      name: `${seedKey}-run-2`,
      id: 2,
      strategyVersion: 11,
      startedAt: new Date(now - 1000 * 60 * 60 * 5).toISOString(),
      durationSeconds: 202,
      parameterName: "Run 2",
      parameterStartDate: "Feb 01 2024",
      parameterEndDate: "Mar 12 2024",
      startingEquity: 250_000,
      metrics: {
        netPnl: 8_450,
        sharpe: 1.18,
        winRate: 0.53,
        maxDrawdown: 0.041,
        trades: 96,
      },
    },
    {
      name: `${seedKey}-run-1`,
      id: 1,
      strategyVersion: 10,
      startedAt: new Date(now - 1000 * 60 * 60 * 26).toISOString(),
      durationSeconds: 121,
      parameterName: "Run 1",
      parameterStartDate: "Nov 18 2023",
      parameterEndDate: "Dec 02 2023",
      startingEquity: 80_000,
      metrics: {
        netPnl: -2_450,
        sharpe: -0.38,
        winRate: 0.34,
        maxDrawdown: 0.066,
        trades: 54,
      },
    },
  ];
};

let mockWorkspaceStrategy: WorkspaceStrategy = {
  id: 1,
  projectId: 1,
  projectName: "Aurora Initiative",
  name: "SPY Benchmark",
  owner: "Brendan Barnett",
  tags: ["mean reversion", "intraday"],
  description:
    "Adaptive intraday scalper that fades stretched order-book skew while respecting regime-specific guardrails.",
  createdAt: "2024-04-12T08:45:00Z",
  updatedAt: "2024-11-18T09:30:00Z",
  files: [
    {
      path: "main.py",
      language: "python",
      isEntrypoint: true,
      content: `from datetime import timedelta
from hqg_algorithms import Strategy, Cadence, Slice, PortfolioView


class BuyAndHoldSpyIef(Strategy):
    def __init__(self):
        self._initialized = False

    def universe(self) -> list[str]:
        return ["SPY", "IEF"]

    def cadence(self) -> Cadence:
        return Cadence(
            bar_size=timedelta(weeks=1)
        )

    def on_data(self, data: Slice, portfolio: PortfolioView) -> dict[str, float] | None:
        if not self._initialized:
            self._initialized = True
            return {"SPY": 0.6, "IEF": 0.4}
        return None
`,
    },
    {
      path: "requirements.txt",
      language: "plaintext",
      content: "hqg_algorithms==0.1.0\n",
    },
    {
      path: "README.md",
      language: "markdown",
      content: `# Alpha Scout

Alpha Scout listens for stretched order-book skew during London and New York sessions.
It scales in using a ladder of passive orders and clips exposure as volatility spikes.

## Playbook
- Monitor imbalance > 15% during liquid sessions
- Fade skew with passive inventory
- Respect hard stop-loss and trailing take-profit via risk envelope

## Notes
Alpha Scout pairs well with volatility dampeners and produces shallow drawdowns when
the clip-size and cooldown are tuned to the venue micro-structure.`,
    },
  ],
  artifacts: [
    {
      id: "artifact-alpha-spec",
      name: "alpha-spec.yml",
      type: "config",
      description: "Entrypoint wiring for scheduler and risk envelope",
      size: "4 KB",
      updatedAt: "2024-11-17T11:00:00Z",
      addedBy: "Morgan Ward",
    },
    {
      id: "artifact-alpha-features",
      name: "alpha-features.parquet",
      type: "dataset",
      description: "Feature set used during imbalance detection",
      size: "18 MB",
      updatedAt: "2024-11-16T05:25:00Z",
      addedBy: "Morgan Ward",
    },
  ],
  readme: `# Alpha Scout

Alpha Scout listens for stretched order-book skew during London and New York sessions.
It scales in using a ladder of passive orders and clips exposure as volatility spikes.

## Playbook
- Monitor imbalance > 15% during liquid sessions
- Fade skew with passive inventory
- Respect hard stop-loss and trailing take-profit via risk envelope

## Notes
Alpha Scout pairs well with volatility dampeners and produces shallow drawdowns when
the clip-size and cooldown are tuned to the venue micro-structure.`,
};

let mockRuns = createMockRuns(mockWorkspaceStrategy.id);

// ----- Real API: Strategies -----
type CoreStrategy = {
  id: string;
  name: string;
  entrypoint?: string;
  current_version?: number;
  created_at?: string;
  updated_at?: string;
  owner?: string;
  project?: string;
  metrics?: {
    sharpe?: number;
    sortino?: number;
    max_drawdown?: number;
    win_rate?: number;
  };
  description?: string;
  tags?: string[];
};

const mapCoreStrategyToUi = (item: CoreStrategy): Strategy => ({
  _id: item.id,
  strategyId: item.id,
  name: item.name,
  description: "",
  owner: item.owner ?? "",
  project: item.project ?? "—",
  tags: item.tags ?? [],
  createdAt: item.created_at ?? new Date().toISOString(),
  updatedAt: item.updated_at ?? new Date().toISOString(),
  metrics: {
    sharpe: item.metrics?.sharpe,
    sortino: item.metrics?.sortino,
    maxDrawdown: item.metrics?.max_drawdown,
    winRate: item.metrics?.win_rate,
  }
});

export const fetchStrategies = async (): Promise<Strategy[]> => {
  const response = await coreApi.get<CoreStrategy[]>("/strategies");
  return response.data.map(mapCoreStrategyToUi);
};

export const fetchStrategyById = async (strategyId: string | number): Promise<Strategy> => {
  const response = await coreApi.get<CoreStrategy>(`/strategies/${strategyId}`);
  return mapCoreStrategyToUi(response.data);
};

export const fetchStrategyArtifacts = async (strategyId: string | number): Promise<string[]> => {
  const response = await coreApi.get<{ artifacts: string[] }>(`/strategies/${strategyId}/artifacts`);
  return response.data.artifacts ?? [];
};

export const fetchStrategyArtifactContent = async (
  strategyId: string | number,
  artifactId: string
): Promise<string> => {
  const response = await coreApi.get<string>(`/strategies/${strategyId}/artifacts/${artifactId}`, {
    responseType: "text",
    transformResponse: [(data) => data], // return raw text
  });

  return response.data;
};

// ----- Real API: Create Strategy -----
export type CreateStrategyRequest = {
  sourceStrategyId: string;
  name: string;
  description?: string;
  tags?: string[];
  owner?: string;
};

export const createStrategy = async (payload: CreateStrategyRequest): Promise<Strategy> => {
  const response = await coreApi.post<CoreStrategy>("/strategies", {
    source_strategy_id: payload.sourceStrategyId,
    name: payload.name,
    description: payload.description ?? "",
    tags: payload.tags ?? [],
    owner: payload.owner ?? "",
  });
  return mapCoreStrategyToUi(response.data);
};

export const fetchStrategyWorkspace = async (strategyId: string | number): Promise<StrategyWorkspaceResponse> => {
  // Pull metadata from the real API, derive files from the artifacts list, keep mock runs for now.
  const [strategy, artifactIds] = await Promise.all([
    fetchStrategyById(strategyId),
    fetchStrategyArtifacts(strategyId),
  ]);

  const readmePath = artifactIds.find((p) => p.toLowerCase().includes("readme"));
  let readmeContent =
    strategy.description && strategy.description.trim()
      ? `# ${strategy.name}\n\n${strategy.description}`
      : "# README\n\nNo description provided.";
  if (readmePath) {
    try {
      const content = await fetchStrategyArtifactContent(strategyId, readmePath);
      if (content) {
        readmeContent = content;
      }
    } catch (error) {
      console.error("Failed to load README content", error);
    }
  }

  const files: StrategyFile[] = artifactIds.map((path) => {
    const isReadme = path.toLowerCase().includes("readme");
    const isEntrypoint = !!strategy.entrypoint && path === strategy.entrypoint;
    return {
      path,
      language: guessLanguage(path),
      content: isReadme ? readmeContent : "",
      isEntrypoint,
    };
  });

  const workspace = {
    ...mockWorkspaceStrategy,
    id: Number(strategy.strategyId) || mockWorkspaceStrategy.id,
    name: strategy.name,
    owner: strategy.owner || "—",
    tags: strategy.tags,
    description: strategy.description || "",
    projectId: 0,
    projectName: "—",
    createdAt: strategy.createdAt,
    updatedAt: strategy.updatedAt,
    files,
    readme: readmeContent || mockWorkspaceStrategy.readme,
  };

  return {
    strategy: cloneWorkspace(workspace),
    runs: cloneRuns(mockRuns),
  };
};

function guessLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".txt")) return "plaintext";
  return "plaintext";
}

export const saveStrategyWorkspaceDraft = async (
  strategyId: number,
  payload: { files: StrategyFile[]; artifacts: StrategyArtifact[] }
): Promise<WorkspaceStrategy> => {
  await delay(900);
  // Strategy id is ignored in the mock implementation.
  mockWorkspaceStrategy = {
    ...mockWorkspaceStrategy,
    files: cloneFiles(payload.files),
    artifacts: cloneArtifacts(payload.artifacts),
    updatedAt: new Date().toISOString(),
  };
  return cloneWorkspace(mockWorkspaceStrategy);
};

export const startStrategyRunExecution = (strategyId: number, existingRunCount: number) => {
  const runName = `${strategyId}-run-${Date.now()}`;
  const nextRunNumber = existingRunCount + 1;
  const parameterName = `Run ${nextRunNumber}`;
  const formatParamDate = (date: Date) =>
    date.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
  const parameterStartDate = formatParamDate(new Date(Date.now() - nextRunNumber * 7 * 24 * 60 * 60 * 1000));
  const parameterEndDate = formatParamDate(new Date());

  const draftRun: BacktestResult = {
    name: runName,
    id: nextRunNumber,
    strategyVersion: 10 + nextRunNumber,
    startedAt: new Date().toISOString(),
    durationSeconds: 0,
    parameterName,
    parameterStartDate,
    parameterEndDate,
    startingEquity: 100_000 + nextRunNumber * 5_000,
    metrics: {
      netPnl: 0,
      sharpe: 0,
      winRate: 0.5,
      maxDrawdown: 0,
      trades: 0,
    },
  };

  const finalize = async (): Promise<BacktestResult> => {
    await delay(2200);
    const outcomePositive = Math.random() > 0.2;
    const pnl = outcomePositive ? 6800 + Math.round(Math.random() * 3200) : -3200;
    const drawdown = outcomePositive ? 0.028 : 0.074;
    const completedRun: BacktestResult = {
      ...draftRun,
      durationSeconds: 155,
      metrics: {
        netPnl: pnl,
        sharpe: outcomePositive ? 1.04 : -0.22,
        winRate: outcomePositive ? 0.61 : 0.29,
        maxDrawdown: drawdown,
        trades: outcomePositive ? 74 : 28,
      },
    };

    mockRuns = [completedRun, ...mockRuns];
    return completedRun;
  };

  return { draftRun, finalize };
};
