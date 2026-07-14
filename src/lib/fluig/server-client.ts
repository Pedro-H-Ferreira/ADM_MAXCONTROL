import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { getServerEnv } from "@/lib/env";
import type { FluigProcessMap } from "@/lib/fluig/process-map";
import type { FluigModuleSlug } from "@/lib/fluig-data";

const execFileAsync = promisify(execFile);

export type FluigIntegrationMode = "disabled" | "external_api" | "internal_runner";

export type FluigRuntimeConfig = {
  mode: FluigIntegrationMode;
  configured: boolean;
  apiBaseUrl: string | null;
  internalRunnerRoot: string | null;
  missing: string[];
};

export type DirectScriptResult<T = unknown> = {
  success: boolean;
  sourceMode: "internal_runner";
  stdout: string;
  stderr: string;
  outputPath: string | null;
  data: T | null;
};

export type FluigHistoryOutput = {
  generatedAt: string;
  query: Record<string, unknown>;
  inspected: Array<Record<string, unknown>>;
  totalItems: number;
  items: FluigHistoryItem[];
};

export type FluigHistoryItem = {
  moduleSlug?: FluigModuleSlug | null;
  processInstanceId: string;
  processId: string;
  processVersion: string;
  status: string;
  startDate: string | null;
  endDate?: string | null;
  requesterId: string | null;
  requesterName: string | null;
  formFields: Record<string, string>;
  sourceUrl: string;
  raw: Record<string, unknown>;
};

export type FluigStatusOutput = {
  processed: number;
  taskUserId: string;
  processedAt: string;
  items: FluigStatusItem[];
};

export type FluigStatusItem = {
  numeroFluig: string;
  moduleSlug?: FluigModuleSlug | null;
  processId?: string | null;
  processDescription?: string | null;
  requesterId?: string | null;
  requesterName?: string | null;
  openedAt?: string | null;
  vencimentoPagamento?: string | null;
  dueDate?: string | null;
  vencPagNota?: string;
  etapaAtual?: string;
  responsavelAtual?: string;
  stateSequence?: number | null;
  movementSequence?: number | null;
  responsavelCodigo?: string;
  responsavelLogin?: string;
  currentStates?: Array<Record<string, unknown>>;
  statusProcesso?: string;
  active?: boolean;
  slaExpirado?: boolean;
  cancelavel?: boolean;
  prazoTexto?: string;
  dataUltimaConsulta?: string;
  syncFluigUserId?: string;
  syncTypes?: Array<"open_tasks" | "my_requests">;
  syncOperations?: Array<"sync_user_open_tasks" | "sync_user_open_requests">;
  syncSource?: string;
  error?: string;
};

export type FluigOpenOutput = {
  sourceRequestId: string;
  generatedRequestId: string;
  processId: string;
  processVersion: string;
  taskUserId: string;
  selectedState: number;
  selectedColleague: string[];
  cancelAfter: boolean;
  fieldOverrideCount: number;
  attachmentCount: number;
  sendResponse: Record<string, unknown>;
  cancelResponse: Record<string, unknown> | null;
  finalDetails: Record<string, unknown> | null;
  processedAt: string;
};

export type FluigCancelOutput = {
  requestIds: string[];
  cancelComment: string;
  processedAt: string;
  items: Array<Record<string, unknown>>;
};

const internalRunnerRoot = process.cwd();
const internalRunnerMarker = path.join(internalRunnerRoot, "scripts", "fluig", "api", "session.js");
const requiredInternalRunnerEnv = [
  "FLUIG_BASE_URL",
  "FLUIG_LOGIN_PATH",
  "FLUIG_LANCAMENTO_PATH",
  "FLUIG_USERNAME",
  "FLUIG_PASSWORD",
  "LOGIN_USER_SELECTOR",
  "LOGIN_PASSWORD_SELECTOR",
  "LOGIN_SUBMIT_SELECTOR",
  "POST_LOGIN_READY_SELECTOR",
  "LANCAMENTO_FORM_READY_SELECTOR",
  "LANCAMENTO_SUBMIT_SELECTOR",
];

function missingInternalRunnerEnv() {
  return requiredInternalRunnerEnv.filter((key) => !String(process.env[key] || "").trim());
}

export function getFluigRuntimeConfig(): FluigRuntimeConfig {
  const env = getServerEnv();
  const explicitMode = String(env.fluigIntegrationMode || "").trim().toLowerCase();
  const apiBaseUrl = env.fluigApiBaseUrl?.trim() || null;
  const internalRunnerAvailable = fs.existsSync(internalRunnerMarker);
  const mode: FluigIntegrationMode =
    explicitMode === "external_api" || explicitMode === "internal_runner" || explicitMode === "disabled"
      ? explicitMode
      : apiBaseUrl
        ? "external_api"
        : internalRunnerAvailable
          ? "internal_runner"
          : "disabled";

  const missing: string[] = [];
  if (mode === "external_api" && !apiBaseUrl) missing.push("FLUIG_API_BASE_URL");
  if (mode === "internal_runner" && !internalRunnerAvailable) {
    missing.push("scripts/fluig/api/session.js no ADM_MAXCONTROL");
  }
  if (mode === "internal_runner") {
    missing.push(...missingInternalRunnerEnv());
  }

  return {
    mode,
    configured: mode !== "disabled" && missing.length === 0,
    apiBaseUrl,
    internalRunnerRoot: mode === "internal_runner" ? internalRunnerRoot : null,
    missing,
  };
}

function ensureInternalRunner() {
  const config = getFluigRuntimeConfig();

  if (config.mode !== "internal_runner" || !config.configured || !config.internalRunnerRoot) {
    throw new Error(
      `Runner interno do Fluig nao configurado. Configure FLUIG_INTEGRATION_MODE=internal_runner e as credenciais Fluig no ADM. Faltando: ${
        config.missing.join(", ") || "modo internal_runner"
      }`
    );
  }

  return config.internalRunnerRoot;
}

function resolveAdmScript(scriptName: string) {
  return path.join(process.cwd(), "scripts", scriptName);
}

function resolveRunnerScript(runnerRoot: string, scriptName: string) {
  return path.join(runnerRoot, "scripts", "fluig", scriptName);
}

function assertSubpath(parent: string, child: string) {
  const parentResolved = path.resolve(parent).toLowerCase();
  const childResolved = path.resolve(child).toLowerCase();
  if (childResolved !== parentResolved && !childResolved.startsWith(`${parentResolved}${path.sep}`)) {
    throw new Error(`Arquivo de saida fora do runner Fluig: ${child}`);
  }
}

function extractTaggedPath(stdout: string, tag: string) {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${tag} `));

  return line ? line.slice(tag.length).trim() : null;
}

async function readTaggedJson<T>(runnerRoot: string, stdout: string, tag: string) {
  const outputPath = extractTaggedPath(stdout, tag);

  if (!outputPath) {
    return { outputPath: null, data: null };
  }

  assertSubpath(runnerRoot, outputPath);
  const raw = await fs.promises.readFile(outputPath, "utf8");
  return { outputPath, data: JSON.parse(raw) as T };
}

async function runNodeScript<T>({
  runnerRoot,
  scriptPath,
  args,
  resultTag,
  timeoutMs = 600000,
}: {
  runnerRoot: string;
  scriptPath: string;
  args: string[];
  resultTag: string;
  timeoutMs?: number;
}) {
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath, ...args], {
    cwd: runnerRoot,
    env: process.env,
    timeout: timeoutMs,
    windowsHide: true,
    maxBuffer: 20 * 1024 * 1024,
  });
  const parsed = await readTaggedJson<T>(runnerRoot, String(stdout || ""), resultTag);

  return {
    success: true,
    sourceMode: "internal_runner" as const,
    stdout: String(stdout || ""),
    stderr: String(stderr || ""),
    outputPath: parsed.outputPath,
    data: parsed.data,
  };
}

export async function queryFluigHistory(
  processMap: FluigProcessMap,
  input: {
    days?: number;
    start?: string;
    end?: string;
    windows?: Array<{ start: string; end: string }>;
    pageSize?: number;
    maxPages?: number;
  } = {}
): Promise<DirectScriptResult<FluigHistoryOutput>> {
  const runnerRoot = ensureInternalRunner();
  const args = [
    `--runner-root=${runnerRoot}`,
    `--process-id=${processMap.processId}`,
    `--process-version=${processMap.processVersions.join(",")}`,
    `--days=${input.days ?? 90}`,
    `--page-size=${input.pageSize ?? 100}`,
    `--max-pages=${input.maxPages ?? 5}`,
  ];

  const windows = Array.isArray(input.windows)
    ? input.windows
        .map((window) => ({
          start: String(window?.start || "").trim(),
          end: String(window?.end || "").trim(),
        }))
        .filter((window) => window.start && window.end)
    : [];

  if (windows.length > 0) {
    args.push(`--windows-json=${JSON.stringify(windows)}`);
  } else {
    if (input.start) args.push(`--start=${input.start}`);
    if (input.end) args.push(`--end=${input.end}`);
  }

  return runNodeScript<FluigHistoryOutput>({
    runnerRoot,
    scriptPath: resolveAdmScript("fluig-adm-query-history.cjs"),
    args,
    resultTag: "ADM_FLUIG_HISTORY_RESULT",
  });
}

export async function syncFluigStatus(
  requestIds: string[],
  input: { taskUserId?: string } = {}
): Promise<DirectScriptResult<FluigStatusOutput>> {
  const runnerRoot = ensureInternalRunner();
  const args = [...requestIds];

  if (input.taskUserId) {
    args.push(`--task-user-id=${input.taskUserId}`);
  }

  return runNodeScript<FluigStatusOutput>({
    runnerRoot,
    scriptPath: resolveRunnerScript(runnerRoot, "syncFluigStatus.js"),
    args,
    resultTag: "SYNC_FLUIG_STATUS_RESULT",
  });
}

export async function openFluigFromSource(input: {
  processMap: FluigProcessMap;
  sourceRequestId: string;
  fieldOverrides: Record<string, string>;
  attachmentPaths?: Array<{ path: string; name?: string }>;
  targetState?: number | string;
  taskUserId?: string;
  comment?: string;
  cancelAfter?: boolean;
  keepOpen?: boolean;
}): Promise<DirectScriptResult<FluigOpenOutput>> {
  const runnerRoot = ensureInternalRunner();
  const args = [
    `--runner-root=${runnerRoot}`,
    `--source-request-id=${input.sourceRequestId}`,
    `--task-user-id=${input.taskUserId || input.processMap.defaultTaskUserId}`,
  ];

  if (input.targetState) args.push(`--target-state=${input.targetState}`);
  if (input.comment) args.push(`--comment=${input.comment}`);
  if (input.cancelAfter) args.push("--cancel-after");
  if (input.keepOpen) args.push("--keep-open");

  for (const [field, value] of Object.entries(input.fieldOverrides)) {
    args.push(`--set=${field}=${value}`);
  }

  for (const attachment of input.attachmentPaths || []) {
    args.push(`--attachment-path=${attachment.path}`);
    if (attachment.name) args.push(`--attachment-name=${attachment.name}`);
  }

  return runNodeScript<FluigOpenOutput>({
    runnerRoot,
    scriptPath: resolveAdmScript("fluig-adm-open-from-source.cjs"),
    args,
    resultTag: "ADM_FLUIG_OPEN_RESULT",
  });
}

export async function cancelFluigRequests(input: {
  requestIds: string[];
  comment?: string;
}): Promise<DirectScriptResult<FluigCancelOutput>> {
  const runnerRoot = ensureInternalRunner();
  const args = [...input.requestIds];

  if (input.comment) {
    args.push(`--comment=${input.comment}`);
  }

  return runNodeScript<FluigCancelOutput>({
    runnerRoot,
    scriptPath: resolveRunnerScript(runnerRoot, "cancelViaApi.js"),
    args,
    resultTag: "CANCEL_VIA_API_RESULT",
  });
}
