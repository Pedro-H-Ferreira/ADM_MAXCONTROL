import "server-only";

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  claimNextServerFluigJob,
  recordServerFluigJobEvent,
  type FluigJobRecord,
  type FluigJobStatus,
} from "@/lib/db/app-repository";
import { persistFluigJobResult } from "@/app/api/agent/jobs/[jobId]/result/route";
import { readFluigCredentials, recordFluigCredentialTest } from "@/lib/fluig/credentials";

type RunnerProgress = {
  stage?: string;
  label?: string;
  payload?: Record<string, unknown>;
};

type RunnerModule = {
  executeJob: (
    config: Record<string, unknown>,
    job: FluigJobRecord,
    emitProgress: (event: RunnerProgress) => Promise<void>
  ) => Promise<Record<string, unknown>>;
};

let cachedRunnerModule: RunnerModule | null = null;

const workerSymbol = Symbol.for("adm-maxcontrol.fluig-server-worker");
const activeProgressStatuses = new Set<FluigJobStatus>([
  "agent_claimed",
  "authenticating",
  "opening_fluig",
  "reading_page",
  "filling_form",
  "submitting",
  "waiting_protocol",
  "syncing_result",
]);

function positiveInt(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizeProgressStatus(stage: string | undefined): FluigJobStatus {
  if (stage && activeProgressStatuses.has(stage as FluigJobStatus)) return stage as FluigJobStatus;
  if (stage === "login") return "authenticating";
  if (stage === "open" || stage === "request") return "opening_fluig";
  return "reading_page";
}

async function runnerModule(): Promise<RunnerModule> {
  if (cachedRunnerModule) return cachedRunnerModule;
  const modulePath = path.join(
    /* turbopackIgnore: true */ process.cwd(),
    "agent",
    "fluig-agent",
    "src",
    "runner.js"
  );
  const imported = (await import(/* turbopackIgnore: true */ pathToFileURL(modulePath).href)) as {
    default?: RunnerModule;
  } & RunnerModule;
  cachedRunnerModule = imported.default || imported;
  return cachedRunnerModule;
}

function userRuntimeDirectory(userId: string) {
  const configuredRoot = String(process.env.FLUIG_RUNTIME_DATA_DIR || "").trim();
  const root = configuredRoot || path.join(/* turbopackIgnore: true */ process.cwd(), ".adm-fluig-runtime");
  const directory = path.join(/* turbopackIgnore: true */ root, userId.replace(/[^a-f\d-]/gi, "_"));
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return directory;
}

async function executeServerJob(job: FluigJobRecord) {
  try {
    const credentials = await readFluigCredentials(job.requestedByUserId);
    const configDir = userRuntimeDirectory(job.requestedByUserId);
    const config = {
      projectRoot: process.cwd(),
      configDir,
      credentials,
      machineName: "ADM MaxControl VPS",
      agentVersion: "vps-internal-1",
      localPort: 0,
      apiUrl: "internal://adm-maxcontrol",
      fluig: {
        baseUrl: String(process.env.FLUIG_BASE_URL || "").trim(),
        loginPath: String(process.env.FLUIG_LOGIN_PATH || "").trim(),
        lancamentoPath: String(process.env.FLUIG_LANCAMENTO_PATH || "").trim(),
        processUrl: String(process.env.FLUIG_PROCESS_URL || "").trim(),
        taskUserId: String(process.env.FLUIG_TASK_USER_ID || "").trim(),
        headless: String(process.env.HEADLESS || "true").trim(),
        slowMo: String(process.env.SLOW_MO || "0").trim(),
        selectors: {
          loginUser: String(process.env.LOGIN_USER_SELECTOR || "#username").trim(),
          loginPassword: String(process.env.LOGIN_PASSWORD_SELECTOR || "#password").trim(),
          loginSubmit: String(process.env.LOGIN_SUBMIT_SELECTOR || "#login-saml-button").trim(),
          postLoginReady: String(process.env.POST_LOGIN_READY_SELECTOR || "#desktop").trim(),
          lancamentoFormReady: String(process.env.LANCAMENTO_FORM_READY_SELECTOR || "body").trim(),
          lancamentoSubmit: String(process.env.LANCAMENTO_SUBMIT_SELECTOR || 'button[type="submit"]').trim(),
        },
      },
    };

    const result = await (await runnerModule()).executeJob(config, job, async (event) => {
      const status = normalizeProgressStatus(event.stage);
      await recordServerFluigJobEvent({
        jobId: job.id,
        eventType: "progress",
        stage: event.stage || status,
        label: event.label || "Executor Fluig da VPS em andamento.",
        status,
        payload: event.payload || {},
      });
    });

    await recordServerFluigJobEvent({
      jobId: job.id,
      eventType: "syncing_result",
      stage: "syncing_result",
      label: "Gravando o retorno do Fluig no ADM.",
      status: "syncing_result",
    });
    const persistenceResponse = await persistFluigJobResult({
      job,
      body: { status: "success", resultPayload: result },
      executor: { type: "server" },
    });
    if (!persistenceResponse.ok) {
      const payload = (await persistenceResponse.json().catch(() => ({}))) as { error?: string };
      throw new Error(payload.error || "Falha ao validar e persistir o retorno do Fluig.");
    }
    await recordFluigCredentialTest({ userId: job.requestedByUserId, success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await persistFluigJobResult({
      job,
      body: { status: "error", resultPayload: { error: message }, errorMessage: message },
      executor: { type: "server" },
    }).catch(() => undefined);
    await recordFluigCredentialTest({
      userId: job.requestedByUserId,
      success: false,
      errorMessage: message,
    }).catch(() => undefined);
  }
}

async function workerLoop() {
  const pollIntervalMs = positiveInt(process.env.FLUIG_SERVER_WORKER_POLL_MS, 2500);
  while (true) {
    try {
      const job = await claimNextServerFluigJob();
      if (job) {
        await executeServerJob(job);
        continue;
      }
    } catch (error) {
      console.error("[fluig-vps-worker]", error instanceof Error ? error.message : String(error));
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}

export function startFluigServerWorker() {
  const enabled = String(process.env.FLUIG_SERVER_WORKER_ENABLED || "true").trim().toLowerCase() !== "false";
  const internalMode = String(process.env.FLUIG_INTEGRATION_MODE || "internal_runner").trim() === "internal_runner";
  if (!enabled || !internalMode) return;

  const globalState = globalThis as typeof globalThis & Record<symbol, unknown>;
  if (globalState[workerSymbol]) return;
  globalState[workerSymbol] = true;
  void workerLoop();
}
