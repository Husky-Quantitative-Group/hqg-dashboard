import axios from "axios";

export interface Strategy {
  _id: string;
  strategyId: string;
  name: string;
  description?: string;
  owner?: string;
  project: string;
  repository: string;
  branch: string;
  githubPath: string;
  htmlUrl: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
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

export type StrategyRun = {
  id: string;
  label: string;
  status: "passed" | "failed" | "running";
  startedAt: string;
  durationSeconds: number;
  summary: string;
  metrics: {
    netPnl: number;
    sharpe: number;
    winRate: number;
    maxDrawdown: number;
    trades: number;
  };
  logs: string[];
  equityCurve: number[];
  drawdown: number[];
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
  runs: StrategyRun[];
};

const apiClient = axios.create({
  baseURL: "http://localhost:5000",
});

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const cloneFiles = (files: StrategyFile[]): StrategyFile[] => files.map((file) => ({ ...file }));

const cloneArtifacts = (artifacts: StrategyArtifact[]): StrategyArtifact[] => artifacts.map((artifact) => ({ ...artifact }));

const cloneRuns = (runs: StrategyRun[]): StrategyRun[] => runs.map((run) => ({
  ...run,
  metrics: { ...run.metrics },
  logs: [...run.logs],
  equityCurve: [...run.equityCurve],
  drawdown: [...run.drawdown],
}));

const cloneWorkspace = (strategy: WorkspaceStrategy): WorkspaceStrategy => ({
  ...strategy,
  files: cloneFiles(strategy.files),
  artifacts: cloneArtifacts(strategy.artifacts),
});

const createEquitySeries = (seed: number): number[] => {
  const base = 100_000 + seed * 800;
  const series: number[] = [];
  let cursor = base;

  for (let i = 0; i < 24; i += 1) {
    const wave = Math.sin(seed * 0.8 + i / 2.5) * 900;
    const drift = i * 320;
    cursor += drift * 0.3 + wave;
    series.push(Math.round(cursor));
  }

  return series;
};

const createDrawdownSeries = (series: number[]): number[] => {
  if (series.length === 0) {
    return [];
  }
  let peak = series[0];
  return series.map((value) => {
    peak = Math.max(peak, value);
    const drawdown = ((value - peak) / peak) * 100;
    return Number(drawdown.toFixed(2));
  });
};

const createMockRuns = (seedKey: string | number): StrategyRun[] => {
  const seedBase = seedKey.toString().length;
  const eqA = createEquitySeries(seedBase + 2);
  const eqB = createEquitySeries(seedBase + 6);
  const eqC = createEquitySeries(seedBase + 10);

  return [
    {
      id: `${seedKey}-run-a`,
      label: "LDN Sweep",
      status: "passed",
      startedAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
      durationSeconds: 148,
      summary: "Captured morning imbalance across majors",
      metrics: {
        netPnl: 12480,
        sharpe: 1.46,
        winRate: 0.58,
        maxDrawdown: 0.032,
        trades: 142,
      },
      logs: [
        "Bootstrapping workspace...",
        "Fetched book snapshots (24 instruments)",
        "Filled 68% of passive orders",
        "PnL locked, exiting gracefully",
      ],
      equityCurve: eqA,
      drawdown: createDrawdownSeries(eqA),
    },
    {
      id: `${seedKey}-run-b`,
      label: "NY Follow",
      status: "passed",
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 5).toISOString(),
      durationSeconds: 202,
      summary: "Extended rally fade with volatility targeting",
      metrics: {
        netPnl: 8450,
        sharpe: 1.18,
        winRate: 0.53,
        maxDrawdown: 0.041,
        trades: 96,
      },
      logs: [
        "Using cached features",
        "Volatility bucket raised to 2.1",
        "Submitted 4 ladder orders",
        "Hedged residual delta",
      ],
      equityCurve: eqB,
      drawdown: createDrawdownSeries(eqB),
    },
    {
      id: `${seedKey}-run-c`,
      label: "Asia Prep",
      status: "failed",
      startedAt: new Date(Date.now() - 1000 * 60 * 60 * 26).toISOString(),
      durationSeconds: 121,
      summary: "Stopped after liquidity guardrail tripped",
      metrics: {
        netPnl: -2450,
        sharpe: -0.38,
        winRate: 0.34,
        maxDrawdown: 0.066,
        trades: 54,
      },
      logs: [
        "Warm storage miss → rebuilding cache",
        "Spread tightened by 34%",
        "Guardrail tripped: liquidity <= 2",
        "Run halted by supervisor",
      ],
      equityCurve: eqC,
      drawdown: createDrawdownSeries(eqC),
    },
  ];
};

let mockWorkspaceStrategy: WorkspaceStrategy = {
  id: 1,
  projectId: 1,
  projectName: "Aurora Initiative",
  name: "Alpha Scout",
  owner: "Morgan Ward",
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

export const fetchStrategies = async (): Promise<Strategy[]> => {
  const response = await apiClient.get<Strategy[]>("/api/strategies");
  return response.data;
};

export const fetchStrategyWorkspace = async (strategyId: string | number): Promise<StrategyWorkspaceResponse> => {
  await delay(300);
  // For now we only have one mock strategy, so the id is ignored.
  return {
    strategy: cloneWorkspace(mockWorkspaceStrategy),
    runs: cloneRuns(mockRuns),
  };
};

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
  const runId = `${strategyId}-run-${Date.now()}`;
  const seed = strategyId + existingRunCount;
  const equityCurve = createEquitySeries(seed + 3);

  const draftRun: StrategyRun = {
    id: runId,
    label: "Manual run",
    status: "running",
    startedAt: new Date().toISOString(),
    durationSeconds: 0,
    summary: "Triggered from workspace",
    metrics: {
      netPnl: 0,
      sharpe: 0,
      winRate: 0.5,
      maxDrawdown: 0,
      trades: 0,
    },
    logs: ["Submitting job to runner..."],
    equityCurve,
    drawdown: createDrawdownSeries(equityCurve),
  };

  const finalize = async (): Promise<StrategyRun> => {
    await delay(2200);
    const outcome: "passed" | "failed" = Math.random() > 0.2 ? "passed" : "failed";
    const pnl = outcome === "passed" ? 6800 + Math.round(Math.random() * 3200) : -3200;
    const drawdown = outcome === "passed" ? 0.028 : 0.074;
    const completedRun: StrategyRun = {
      ...draftRun,
      status: outcome,
      durationSeconds: 155,
      summary: outcome === "passed" ? "Orders filled and hedged via workspace" : "Guardrail blocked exposure",
      metrics: {
        netPnl: pnl,
        sharpe: outcome === "passed" ? 1.04 : -0.22,
        winRate: outcome === "passed" ? 0.61 : 0.29,
        maxDrawdown: drawdown,
        trades: outcome === "passed" ? 74 : 28,
      },
      logs:
        outcome === "passed"
          ? ["Job started", "Built 3 feature batches", "Filled 92% of ladder", "PnL persisted to vault"]
          : ["Job started", "Volatility guardrail exceeded", "Run halted"],
    };

    mockRuns = [completedRun, ...mockRuns];
    return completedRun;
  };

  return { draftRun, finalize };
};
