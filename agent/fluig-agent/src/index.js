#!/usr/bin/env node

const http = require("node:http");
const { buildConfig } = require("./config");
const { executeJob } = require("./runner");

const config = buildConfig();
const historyChunkMaxItems = positiveInt(process.env.ADM_FLUIG_HISTORY_CHUNK_ITEMS, 25);
const historyChunkMaxBytes = positiveInt(process.env.ADM_FLUIG_HISTORY_CHUNK_BYTES, 650000);
const historyFieldMaxChars = positiveInt(process.env.ADM_FLUIG_HISTORY_FIELD_MAX_CHARS, 6000);
const historyAggressiveFieldMaxChars = positiveInt(process.env.ADM_FLUIG_HISTORY_AGGRESSIVE_FIELD_MAX_CHARS, 1000);
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

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
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

async function sendHistoryChunk(job, input) {
  return apiFetch(`/api/agent/jobs/${job.id}/chunk`, historyChunkPayload(input));
}

function historyItemsFromResult(result) {
  const dataItems = result && result.data && Array.isArray(result.data.items) ? result.data.items : null;
  return dataItems || (Array.isArray(result && result.items) ? result.items : []);
}

function truncateValue(value, maxChars) {
  if (value == null) return "";
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  const text = serialized == null ? String(value) : serialized;
  return text.length > maxChars ? `${text.slice(0, maxChars)}... [truncado]` : text;
}

function compactFormFields(fields, maxChars) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};

  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, truncateValue(value, maxChars)])
  );
}

function compactRawPayload(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw || null;

  const keepKeys = [
    "processInstanceId",
    "processId",
    "processVersion",
    "status",
    "startDate",
    "requesterId",
    "requesterName",
    "requesterCode",
    "active",
    "stateDescription",
  ];

  return Object.fromEntries(keepKeys.filter((key) => raw[key] !== undefined).map((key) => [key, raw[key]]));
}

function compactHistoryItem(item, aggressive = false) {
  const maxChars = aggressive ? historyAggressiveFieldMaxChars : historyFieldMaxChars;

  return {
    ...item,
    formFields: compactFormFields(item && item.formFields, maxChars),
    raw: aggressive ? null : compactRawPayload(item && item.raw),
  };
}

function historyChunkPayload(input) {
  return {
    chunkIndex: input.chunkIndex,
    totalChunks: input.totalChunks,
    totalItems: input.totalItems,
    resultPayload: {
      data: {
        items: input.items,
      },
    },
  };
}

function payloadBytes(payload) {
  return Buffer.byteLength(JSON.stringify(payload), "utf8");
}

function historyChunkBytes(items) {
  return payloadBytes(historyChunkPayload({ chunkIndex: 0, totalChunks: 999, totalItems: items.length, items }));
}

function buildHistoryChunks(items) {
  const chunks = [];
  let current = [];

  for (const item of items) {
    let compactItem = compactHistoryItem(item);
    if (historyChunkBytes([compactItem]) > historyChunkMaxBytes) {
      compactItem = compactHistoryItem(item, true);
    }

    const next = [...current, compactItem];
    const nextTooLarge = historyChunkBytes(next) > historyChunkMaxBytes;
    const nextTooMany = next.length > historyChunkMaxItems;

    if (current.length && (nextTooLarge || nextTooMany)) {
      chunks.push(current);
      current = [compactItem];
    } else {
      current = next;
    }
  }

  if (current.length) {
    chunks.push(current);
  }

  return chunks;
}

function compactHistoryResult(result, input) {
  const data = result && result.data && typeof result.data === "object" ? result.data : {};
  const { items: _items, ...compactData } = data;
  const { items: _topItems, ...compactResult } = result || {};

  return {
    ...compactResult,
    data: {
      ...compactData,
      itemsChunked: true,
      itemCount: input.itemCount,
      chunkCount: input.chunkCount,
      maxChunkItems: historyChunkMaxItems,
      maxChunkBytes: historyChunkMaxBytes,
    },
    itemsChunked: true,
    itemCount: input.itemCount,
    chunkCount: input.chunkCount,
    maxChunkItems: historyChunkMaxItems,
    maxChunkBytes: historyChunkMaxBytes,
  };
}

async function sendChunkedHistoryResult(job, result) {
  const items = historyItemsFromResult(result);
  if (!items.length) {
    return compactHistoryResult(result, { itemCount: 0, chunkCount: 0 });
  }

  const chunks = buildHistoryChunks(items);
  const totalChunks = chunks.length;

  for (const [chunkIndex, chunk] of chunks.entries()) {
    currentJob = {
      ...currentJob,
      status: "syncing_result",
      label: `Gravando lote ${chunkIndex + 1}/${totalChunks} no ADM (${payloadBytes(historyChunkPayload({
        chunkIndex,
        totalChunks,
        totalItems: items.length,
        items: chunk,
      }))} bytes).`,
    };
    await sendHistoryChunk(job, {
      chunkIndex,
      totalChunks,
      totalItems: items.length,
      items: chunk,
    });
  }

  return compactHistoryResult(result, { itemCount: items.length, chunkCount: totalChunks });
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

    let result = await executeJob(config, job, async (event) => {
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

    if (job.operation === "sync_history" || job.operation === "sync_initial_history") {
      result = await sendChunkedHistoryResult(job, result);
    }

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

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  __test: {
    buildHistoryChunks,
    compactHistoryResult,
    historyChunkPayload,
    payloadBytes,
  },
};
