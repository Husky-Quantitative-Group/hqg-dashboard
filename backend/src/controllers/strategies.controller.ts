import YAML from "yaml";

type ProjectMetadata = {
  id?: string;
  name?: string;
  description?: string;
  owner?: string;
};

type StrategyConfigRaw = {
  id?: string;
  name?: string;
  description?: string;
  owner?: string;
  status?: string;
  created_at?: string;
  version?: string;
  entry_point?: string;
  tags?: string[];
};

type StrategySummary = {
  id: string;
  name?: string;
  description?: string;
  owner?: string;
  status?: string;
  createdAt?: string;
  version?: string;
  entryPoint?: string;
  tags: string[];
  project: ProjectMetadata & { slug: string };
  repoPath: string;
};

type GitHubRepoConfig = {
  owner: string;
  repo: string;
  ref: string;
  token: string;
};

class GitHubApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly responseBody?: string
  ) {
    super(message);
    this.name = "GitHubApiError";
  }
}

type GitHubDirectoryItemResponse = {
  name: string;
  path: string;
  type: string;
};

type GitHubFileResponse = {
  name: string;
  path: string;
  type: string;
  encoding?: string;
  content?: string;
};

const TOKEN_ENV_KEYS = [
  "HQG_STRATEGIES_GITHUB_TOKEN",
  "HQG_STRATEGIES_TOKEN",
  "GITHUB_TOKEN",
];

const OWNER_ENV_KEYS = [
  "HQG_STRATEGIES_GITHUB_OWNER",
  "HQG_STRATEGIES_OWNER",
  "GITHUB_REPO_OWNER",
  "GITHUB_OWNER",
];

const REPO_ENV_KEYS = [
  "HQG_STRATEGIES_GITHUB_REPO",
  "HQG_STRATEGIES_REPO",
  "GITHUB_REPO_NAME",
  "GITHUB_REPO",
];

const REF_ENV_KEYS = [
  "HQG_STRATEGIES_GITHUB_REF",
  "HQG_STRATEGIES_REF",
  "GITHUB_REPO_REF",
];

const DEFAULT_REF = "main";

const isGitHubApiError = (error: unknown): error is GitHubApiError => {
  return error instanceof GitHubApiError;
};

const buildContentUrl = (
  config: GitHubRepoConfig,
  resourcePath: string
): URL => {
  const sanitizedPath = resourcePath.replace(/^\/+/, "");
  const { owner, repo, ref } = config;
  const url = new URL(
    `https://api.github.com/repos/${owner}/${repo}/contents/${sanitizedPath}`
  );
  if (ref) {
    url.searchParams.set("ref", ref);
  }

  return url;
};

const fetchGitHubJson = async <T>(
  config: GitHubRepoConfig,
  resourcePath: string
): Promise<T> => {
  const url = buildContentUrl(config, resourcePath);
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "hqg-dashboard-backend",
  };

  if (config.token) {
    headers.Authorization = `Bearer ${config.token}`;
  }

  console.info(
    `[strategies] Fetching GitHub resource: ${url.toString()} (owner=${config.owner}, repo=${config.repo}, ref=${config.ref})`
  );

  const response = await fetch(url, { headers });
  const responseText = await response.text();

  if (!response.ok) {
    console.warn(
      `[strategies] GitHub request failed (${response.status}) for ${resourcePath}: ${responseText}`
    );
    throw new GitHubApiError(
      `GitHub API request failed for ${resourcePath} with status ${response.status}`,
      response.status,
      responseText
    );
  }

  console.info(
    `[strategies] GitHub request succeeded (${response.status}) for ${resourcePath}`
  );

  try {
    return JSON.parse(responseText) as T;
  } catch (error) {
    throw new Error(
      `Unable to parse GitHub API response for ${resourcePath}. ${(error as Error).message}`
    );
  }
};

const getEnvVar = (keys: string[]): string | undefined => {
  return keys
    .map((key) => process.env[key])
    .find((value): value is string => Boolean(value?.trim()));
};

const getGitHubRepoConfig = (): GitHubRepoConfig => {
  const token = getEnvVar(TOKEN_ENV_KEYS);
  if (!token) {
    throw new Error(
      "Missing GitHub token. Set HQG_STRATEGIES_GITHUB_TOKEN (or GITHUB_TOKEN) with repo read access."
    );
  }

  const owner = getEnvVar(OWNER_ENV_KEYS);
  if (!owner) {
    throw new Error(
      "Missing GitHub repository owner. Set HQG_STRATEGIES_GITHUB_OWNER (or GITHUB_REPO_OWNER)."
    );
  }

  const repo = getEnvVar(REPO_ENV_KEYS);
  if (!repo) {
    throw new Error(
      "Missing GitHub repository name. Set HQG_STRATEGIES_GITHUB_REPO (or GITHUB_REPO_NAME)."
    );
  }

  const ref = getEnvVar(REF_ENV_KEYS) ?? DEFAULT_REF;

  console.info(
    `[strategies] Using GitHub repo config owner=${owner}, repo=${repo}, ref=${ref}`
  );

  return { owner, repo, ref, token };
};

type DirectoryEntry = {
  name: string;
  path: string;
  type: "file" | "dir" | "symlink" | string;
};

const listDirectoryContents = async (
  config: GitHubRepoConfig,
  directoryPath: string
): Promise<DirectoryEntry[]> => {
  const data = await fetchGitHubJson<GitHubDirectoryItemResponse[] | GitHubFileResponse>(
    config,
    directoryPath
  );

  if (!Array.isArray(data)) {
    throw new Error(`Expected a directory at ${directoryPath} but found a file.`);
  }

  return data.map((entry) => ({
    name: entry.name,
    path: entry.path,
    type: entry.type,
  }));
};

const fetchYamlFile = async <T>(
  config: GitHubRepoConfig,
  filePath: string
): Promise<T> => {
  const data = await fetchGitHubJson<GitHubFileResponse>(config, filePath);

  if (Array.isArray(data) || data.type !== "file" || !data.content) {
    throw new Error(`Expected a file with content at ${filePath}.`);
  }

  const encoding = (data.encoding ?? "base64") as BufferEncoding;
  const content = Buffer.from(data.content, encoding).toString("utf-8");
  return YAML.parse(content) as T;
};

const readProjectMetadata = async (
  config: GitHubRepoConfig,
  projectSlug: string
): Promise<ProjectMetadata & { slug: string }> => {
  const projectYamlPath = `projects/${projectSlug}/project.yml`;

  try {
    const metadata = await fetchYamlFile<ProjectMetadata>(config, projectYamlPath);
    return { slug: projectSlug, ...metadata };
  } catch (error) {
    console.warn(
      `Warning: unable to read project metadata at ${projectYamlPath}. Error: ${error}`
    );
    return { slug: projectSlug };
  }
};

const readStrategyConfigs = async (
  config: GitHubRepoConfig,
  projectSlug: string,
  project: ProjectMetadata & { slug: string }
): Promise<StrategySummary[]> => {
  const projectDirPath = `projects/${projectSlug}`;

  let directoryEntries: DirectoryEntry[] = [];
  try {
    directoryEntries = await listDirectoryContents(config, projectDirPath);
    console.info(
      `[strategies] Project ${projectSlug}: found ${directoryEntries.length} entries`
    );
  } catch (error) {
    console.warn(
      `Warning: unable to list strategies under ${projectDirPath}. Error: ${error}`
    );
    return [];
  }

  const strategies = await Promise.all(
    directoryEntries
      .filter((entry) => entry.type === "dir")
      .map(async (entry) => {
        const strategyDirPath = entry.path;
        const configPath = `${strategyDirPath}/config.yml`;

        try {
          const configData = await fetchYamlFile<StrategyConfigRaw>(config, configPath);

          const strategyId = configData.id ?? `${project.slug}.${entry.name}`;

          const summary: StrategySummary = {
            id: strategyId,
            tags: configData.tags ?? [],
            project,
            repoPath: strategyDirPath,
          };

          if (configData.name !== undefined) {
            summary.name = configData.name;
          }

          if (configData.description !== undefined) {
            summary.description = configData.description;
          }

          if (configData.owner !== undefined) {
            summary.owner = configData.owner;
          }

          if (configData.status !== undefined) {
            summary.status = configData.status;
          }

          if (configData.created_at !== undefined) {
            summary.createdAt = configData.created_at;
          }

          if (configData.version !== undefined) {
            summary.version = configData.version;
          }

          if (configData.entry_point !== undefined) {
            summary.entryPoint = configData.entry_point;
          }

          return summary;
        } catch (error) {
          if (isGitHubApiError(error) && error.status === 404) {
            return undefined;
          }

          console.warn(
            `Warning: unable to read strategy config at ${configPath}. Error: ${error}`
          );
          return undefined;
        }
      })
  );

  const strategiesForProject = strategies.filter(
    (strategy): strategy is StrategySummary => strategy !== undefined
  );

  console.info(
    `[strategies] Project ${projectSlug}: returning ${strategiesForProject.length} strategies`
  );

  return strategiesForProject;
};

export const getAllStrategies = async (): Promise<StrategySummary[]> => {
  const repoConfig = getGitHubRepoConfig();

  let projectEntries: DirectoryEntry[] = [];
  try {
    projectEntries = await listDirectoryContents(repoConfig, "projects");
    console.info(
      `[strategies] Found ${projectEntries.length} entries under projects/`
    );
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Unable to list projects directory in the strategies repo. Confirm repository settings and branch. ${details}`
    );
  }

  const strategies = await Promise.all(
    projectEntries
      .filter((entry) => entry.type === "dir")
      .map(async (entry) => {
        const projectSlug = entry.name;
        const projectMetadata = await readProjectMetadata(repoConfig, projectSlug);
        return readStrategyConfigs(repoConfig, projectSlug, projectMetadata);
      })
  );

  return strategies.flat();
};

export const getStrategiesErrorMessage = (error: unknown): string => {
  return error instanceof Error ? error.message : "Unknown error retrieving strategies";
};

export type { StrategySummary };
