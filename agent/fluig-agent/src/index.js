#!/usr/bin/env node

const http = require("node:http");
const { buildConfig } = require("./config");
const { executeJob } = require("./runner");

const config = buildConfig();
let currentJob = null;
let lastError = null;
let stopping = false;

const allowedStatuses = new Set([
  "queued",
  "agent_claimed",
  "authenticating",
  "opening_fluig",
  "reading_page",
  "filling_form",
  "submitting",
  "waiting_protocol",
  "syncing_result",
  "success",
  "error",
  "cancelled",
  "expired",
]);

function normalizeJobStatus(stage) {
  if (allowedStatuses.has(stage)) return stage;
  if (stage === "login") return "authenticating";
  if (stage === "request" || stage === "consultando" || stage === "consultando_item" || stage === "item_consultado") {
    return "reading_page";
  }
  if (stage === "erro_item") return "reading_page";
  return "reading_page";
}

function assertConfig() {
  if (!config.token) {
    throw new Error(`ADM_AGENT_TOKEN ausente. Configure ${config.configFile}.`);
  }

  if (!config.fluig.baseUrl || !config.fluig.loginPath || !config.fluig.lancamentoPath) {
    throw new Error("Configure FLUIG_BASE_URL, FLUIG_LOGIN_PATH e FLUIG_LANCAMENTO_PATH no agente local.");
  }
}

async function apiFetch(path, payload = {}) {
  const response = await fetch(`${config.apiUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.token}`,
    },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => ({}));

  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Falha HTTP ${response.status} em ${path}`);
  }

  return data;
}

function heartbeatPayload() {
  return {
    localApiUrl: `http://127.0.0.1:${config.localPort}`,
    machineId: config.machineId,
    machineName: config.machineName,
    agentVersion: config.agentVersion,
  };
}

async function sendEvent(jobId, input) {
  await apiFetch(`/api/agent/jobs/${jobId}/event`, {
    eventType: input.eventType || "progress",
    stage: input.stage,
    label: input.label,
    status: input.status,
    payload: input.payload || {},
  });
}

async function sendResult(job, input) {
  await apiFetch(`/api/agent/jobs/${job.id}/result`, {
    status: input.status,
    resultPayload: input.resultPayload || {},
    errorMessage: input.errorMessage || null,
  });
}

async function processJob(job) {
  currentJob = {
    id: job.id,
    operation: job.operation,
    module: job.module,
    status: "agent_claimed",
    label: "Agente local assumiu a tarefa.",
    startedAt: new Date().toISOString(),
  };
  lastError = null;

  try {
    await sendEvent(job.id, {
      stage: "agent_claimed",
      status: "agent_claimed",
      label: "Agente local assumiu a tarefa.",
    });

    const result = await executeJob(config, job, async (event) => {
      const status = normalizeJobStatus(event.stage);
      currentJob = {
        ...currentJob,
        status,
        label: event.label || currentJob.label,
      };
      await sendEvent(job.id, {
        stage: event.stage,
        status,
        label: event.label,
        payload: event.payload,
      }).catch((error) => {
        lastError = error.message;
      });
    });

    currentJob = {
      ...currentJob,
      status: "syncing_result",
      label: "Enviando resultado para o ADM.",
    };
    await sendEvent(job.id, {
      stage: "syncing_result",
      status: "syncing_result",
      label: "Enviando resultado para o ADM.",
    });
    await sendResult(job, {
      status: "success",
      resultPayload: result,
    });
    currentJob = {
      ...currentJob,
      status: "success",
      label: "Tarefa finalizada.",
      finishedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    lastError = message;
    currentJob = {
      ...currentJob,
      status: "error",
      label: message,
      finishedAt: new Date().toISOString(),
    };
    await sendResult(job, {
      status: "error",
      errorMessage: message,
      resultPayload: {
        error: message,
      },
    }).catch(() => {});
  } finally {
    setTimeout(() => {
      currentJob = null;
    }, 15000);
  }
}

async function pollOnce() {
  const data = await apiFetch("/api/agent/jobs/poll", heartbeatPayload());
  if (data.job && !currentJob) {
    await processJob(data.job);
  }
}

async function pollLoop() {
  while (!stopping) {
    try {
      await pollOnce();
    } catch (error) {
      lastError = error && error.message ? error.message : String(error);
    }

    await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
  }
}

function startLocalServer() {
  const server = http.createServer((request, response) => {
    const headers = {
      "Content-Type": "application/json; charset=utf-8",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Private-Network": "true",
    };

    if (request.method === "OPTIONS") {
      response.writeHead(204, headers);
      response.end();
      return;
    }

    if (request.url === "/health" || request.url === "/status") {
      response.writeHead(200, headers);
      response.end(
        JSON.stringify({
          success: true,
          online: true,
          apiUrl: config.apiUrl,
          machineName: config.machineName,
          currentJob,
          lastError,
          checkedAt: new Date().toISOString(),
        })
      );
      return;
    }

    response.writeHead(404, headers);
    response.end(JSON.stringify({ success: false, error: "Not found" }));
  });

  server.listen(config.localPort, "127.0.0.1", () => {
    console.log(`ADM Fluig Agent local em http://127.0.0.1:${config.localPort}`);
  });

  return server;
}

async function main() {
  assertConfig();
  startLocalServer();
  await apiFetch("/api/agent/heartbeat", heartbeatPayload()).catch((error) => {
    lastError = error.message;
  });
  await pollLoop();
}

process.on("SIGINT", () => {
  stopping = true;
});
process.on("SIGTERM", () => {
  stopping = true;
});

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});
