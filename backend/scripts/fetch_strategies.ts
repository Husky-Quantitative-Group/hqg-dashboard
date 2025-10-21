// This file was pretty much completely AI generated - josef-karpinski - 2025-09-29

import { config as loadEnv } from "dotenv";
import https from "node:https";
import mongoose from "mongoose";

// @ts-ignore - ts-node resolves the .ts path at runtime
import { StrategyModel } from "../src/models/strategy.model.ts";

loadEnv();

const OWNER = "Husky-Quantitative-Group";
const REPO = "hqg-strategies";
const API_VERSION = "2022-11-28";
const USER_AGENT = "hqg-dashboard/fetch-strategies";

type GitHubContentType = "file" | "dir" | "symlink" | "submodule";

type GitHubContent = {
  name: string;
  path: string;
  sha: string;
  size: number;
  type: GitHubContentType;
  url: string;
  html_url: string;
  git_url: string;
  download_url: string | null;
};

type StrategyRecord = {
  project: string;
  strategy: string;
  githubPath: string;
  htmlUrl: string;
};

const token = process.env.HQG_STRATEGIES_GITHUB_TOKEN;
const branchOverride = process.env.HQG_STRATEGIES_BRANCH;
const databaseUrl = process.env.DATABASE_URL ?? "mongodb://localhost:27017/hqg_dashboard";

if (!token) {
  console.error("Missing HQG_STRATEGIES_GITHUB_TOKEN in environment. Aborting.");
  process.exit(1);
}

type GitHubRequestOptions = {
  method?: "GET" | "POST" | "PUT" | "DELETE";
};

function githubRequest<T>(path: string, { method = "GET" }: GitHubRequestOptions = {}): Promise<T> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        hostname: "api.github.com",
        path,
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
          "User-Agent": USER_AGENT,
        },
      },
      (response) => {
        const statusCode = response.statusCode ?? 500;
        let raw = "";

        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          raw += chunk;
        });

        response.on("end", () => {
          if (statusCode < 200 || statusCode >= 300) {
            let message = response.statusMessage || "GitHub API request failed";
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object" && "message" in parsed) {
                message = String(parsed.message);
              }
            } catch {
              if (raw.trim()) {
                message = raw.trim();
              }
            }

            const error = new Error(`GitHub API request failed (${statusCode}): ${message}`);
            (error as Error & { status?: number; responseBody?: string }).status = statusCode;
            (error as Error & { status?: number; responseBody?: string }).responseBody = raw;
            reject(error);
            return;
          }

          try {
            const parsed = raw ? (JSON.parse(raw) as T) : (undefined as T);
            resolve(parsed);
          } catch (error) {
            reject(new Error(`Failed to parse GitHub API response for '${path}': ${(error as Error).message}`));
          }
        });
      }
    );

    request.on("error", (error) => {
      reject(error);
    });

    request.end();
  });
}

function buildContentsPath(path: string, ref: string): string {
  const cleanedPath = path
    .split("/")
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  const suffix = cleanedPath ? `/${cleanedPath}` : "";
  const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : "";

  return `/repos/${OWNER}/${REPO}/contents${suffix}${refParam}`;
}

async function fetchDirectory(path: string, ref: string): Promise<GitHubContent[]> {
  const requestPath = buildContentsPath(path, ref);
  const response = await githubRequest<GitHubContent | GitHubContent[]>(requestPath);

  if (!Array.isArray(response)) {
    throw new Error(`Expected directory listing for '${path}', but received a single item.`);
  }

  return response;
}

async function resolveBranch(): Promise<string> {
  if (branchOverride) {
    return branchOverride;
  }

  try {
    const metadata = await githubRequest<{ default_branch: string }>(`/repos/${OWNER}/${REPO}`);
    if (!metadata?.default_branch) {
      throw new Error("GitHub repository metadata did not include a default_branch value");
    }

    return metadata.default_branch;
  } catch (error) {
    console.error("Unable to determine repository default branch.");
    throw error;
  }
}

async function collectStrategies(ref: string): Promise<StrategyRecord[]> {
  const projects = await fetchDirectory("projects", ref);
  const projectDirectories = projects.filter((entry) => entry.type === "dir");

  const strategies: StrategyRecord[] = [];

  for (const project of projectDirectories) {
    const entries = await fetchDirectory(`projects/${project.name}`, ref);
    const strategyDirectories = entries.filter((entry) => entry.type === "dir");

    for (const strategy of strategyDirectories) {
      strategies.push({
        project: project.name,
        strategy: strategy.name,
        githubPath: strategy.path,
        htmlUrl: strategy.html_url,
      });
    }
  }

  return strategies;
}

async function persistStrategies({ strategies, branch }: { strategies: StrategyRecord[]; branch: string }) {
  const repository = `${OWNER}/${REPO}`;

  await mongoose.connect(databaseUrl);

  try {
    await StrategyModel.deleteMany({ repository, branch });

    if (strategies.length === 0) {
      console.log(`No strategies discovered for ${repository}@${branch}. Removed any existing records.`);
      return;
    }

    const documents = strategies.map((strategy) => {
      const strategyId = `${repository}:${branch}:${strategy.githubPath}`;

      return {
        strategyId,
        name: strategy.strategy,
        description: `Strategy sourced from ${repository} at ${strategy.githubPath}`,
        owner: strategy.project,
        project: strategy.project,
        repository,
        branch,
        githubPath: strategy.githubPath,
        htmlUrl: strategy.htmlUrl,
        tags: [strategy.project, `repo:${repository}`],
      };
    });

    await StrategyModel.insertMany(documents, { ordered: false });

    console.log(`Persisted ${documents.length} strategies to MongoDB (collection: strategies).`);
  } finally {
    await mongoose.disconnect();
  }
}

async function main() {
  try {
    const branch = await resolveBranch();
    const strategies = await collectStrategies(branch);
    console.log(
      JSON.stringify(
        {
          repository: `${OWNER}/${REPO}`,
          branch,
          totalStrategies: strategies.length,
          strategies,
        },
        null,
        2
      )
    );

    await persistStrategies({ strategies, branch });
  } catch (error) {
    console.error("Failed to fetch strategies from GitHub.");
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

void main();
