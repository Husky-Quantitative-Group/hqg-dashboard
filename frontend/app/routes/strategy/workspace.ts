import { fetchStrategyById, type Strategy } from "~/api/strategies";
import {
  fetchStrategyArtifacts,
  fetchStrategyArtifactContent,
  fetchStrategyWriteAccess,
  type StrategyFile,
} from "~/api/strategyArtifacts";

export type StrategyWorkspace = {
  strategy: Strategy;
  files: StrategyFile[];
  backtestResults: BacktestResult[];
  canWrite: boolean;
};

export const fetchStrategyWorkspace = async (strategyId: string | number): Promise<StrategyWorkspace> => {
  // Pull metadata from the real API, derive files from the artifacts list, keep mock runs for now.
  const [strategy, artifactIds, canWrite] = await Promise.all([
    fetchStrategyById(strategyId),
    fetchStrategyArtifacts(strategyId),
    fetchStrategyWriteAccess(strategyId),
  ]);

  const readmePath = artifactIds.find((p) => p.toLowerCase().includes("readme"));
  let readmeContent = `# ${strategy.name}`;
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

  return {
    strategy: strategy,
    files: cloneFiles(files),
    backtestResults: cloneRuns(createMockRuns(1)),
    canWrite,
  };
};

const cloneFiles = (files: StrategyFile[]): StrategyFile[] => files.map((file) => ({ ...file }));

function guessLanguage(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".py")) return "python";
  if (lower.endsWith(".md")) return "markdown";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "yaml";
  if (lower.endsWith(".txt")) return "plaintext";
  return "plaintext";
}

// TO BE CHANGED/MOVED ONCE WE INTEGRATE BACKTESTS (everything below)
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

const cloneRuns = (runs: BacktestResult[]): BacktestResult[] =>
  runs.map((run) => ({
    ...run,
    metrics: { ...run.metrics },
  }));

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

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export const startStrategyRunExecution = (strategyId: string, existingRunCount: number) => {
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

    return completedRun;
  };

  return { draftRun, finalize };
};
