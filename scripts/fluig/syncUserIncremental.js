/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchUserTaskCentral } = require("./api/userTaskApi");
const { fetchAttachments, fetchDetails, fetchHistories, fetchRequest } = require("./api/workflowViewApi");
const { normalizeAttachments, normalizeFormFields, normalizeHistory } = require("./requestDetails").__test;

function parseArg(flag, fallback = "") {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? String(arg.slice(prefix.length)).trim() : fallback;
}

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readPayload() {
  const payloadFile = parseArg("payload-file");
  if (!payloadFile) {
    throw new Error("Informe --payload-file com os lotes de sincronizacao incremental.");
  }

  return JSON.parse(fs.readFileSync(payloadFile, "utf8"));
}

function emitProgress(payload) {
  console.log(`SYNC_FLUIG_STATUS_PROGRESS ${JSON.stringify({ at: new Date().toISOString(), ...payload })}`);
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function sourceUrl(requestId, taskUserId) {
  const url = new URL("/portal/p/1/pageworkflowview", config.urls.base);
  url.searchParams.set("app_ecm_workflowview_detailsProcessInstanceID", requestId);
  if (taskUserId) url.searchParams.set("taskUserId", taskUserId);
  return url.toString();
}

function detailConfigByModule(batches) {
  const output = new Map();
  for (const batch of batches) {
    const moduleSlug = cleanText(batch?.module);
    if (!moduleSlug) continue;
    const current = output.get(moduleSlug) || { fields: new Set(), hash: "", taskUserId: "" };
    for (const field of batch?.detailFields || []) current.fields.add(cleanText(field));
    current.hash = cleanText(batch?.detailConfigHash) || current.hash;
    current.taskUserId = cleanText(batch?.taskUserId) || current.taskUserId;
    output.set(moduleSlug, current);
  }
  return output;
}

function detailStateIndex(rows) {
  return new Map((rows || []).map((row) => [`${cleanText(row?.module)}:${cleanText(row?.requestId)}`, row]));
}

function needsDetailRefresh(item, configRow, state) {
  if (!state?.syncedAt) return true;
  if (cleanText(state.configHash) !== cleanText(configRow?.hash)) return true;
  const currentMovement = item.movementSequence == null ? null : Number(item.movementSequence);
  const previousMovement = state.movementSequence == null ? null : Number(state.movementSequence);
  if (currentMovement != null && currentMovement !== previousMovement) return true;
  const syncedAt = Date.parse(cleanText(state.syncedAt));
  return !Number.isFinite(syncedAt) || Date.now() - syncedAt > 24 * 60 * 60 * 1000;
}

async function fetchDetailSnapshot(page, item, configRow) {
  const requestId = cleanText(item.numeroFluig);
  const taskUserId = cleanText(configRow?.taskUserId);
  const [request, attachmentsResult, historiesResult] = await Promise.all([
    fetchRequest(page, requestId),
    fetchAttachments(page, requestId).catch((error) => ({ items: [], error: error.message })),
    fetchHistories(page, requestId).catch((error) => ({ items: [], error: error.message })),
  ]);
  let historyPayload = historiesResult;
  let fallbackWarning = null;
  if (historiesResult?.error) {
    historyPayload = await fetchDetails(page, requestId, taskUserId).catch((error) => {
      fallbackWarning = error.message;
      return { content: [] };
    });
  }
  const allFields = normalizeFormFields(request);
  const allowedFields = configRow?.fields || new Set();
  const formFields = Object.fromEntries(
    Object.entries(allFields).filter(([name]) => allowedFields.has(name))
  );
  return {
    requestId,
    taskUserId: taskUserId || null,
    sourceUrl: sourceUrl(requestId, taskUserId),
    fetchedAt: new Date().toISOString(),
    formFields,
    attachments: normalizeAttachments(attachmentsResult),
    history: normalizeHistory(historyPayload),
    warnings: [attachmentsResult?.error, historiesResult?.error, fallbackWarning].filter(Boolean),
  };
}

async function mapWithConcurrency(items, concurrency, callback) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function enrichCentralItems(page, items, batches, detailState) {
  const configs = detailConfigByModule(batches);
  const states = detailStateIndex(detailState);
  const pending = items.filter((item) => {
    const configRow = configs.get(cleanText(item.moduleSlug));
    return configRow && needsDetailRefresh(item, configRow, states.get(`${item.moduleSlug}:${item.numeroFluig}`));
  });
  let completed = 0;
  await mapWithConcurrency(pending, 6, async (item) => {
    const configRow = configs.get(cleanText(item.moduleSlug));
    try {
      item.detailSnapshot = await fetchDetailSnapshot(page, item, configRow);
      item.detailConfigHash = configRow?.hash || "";
      item.detailSyncError = null;
    } catch (error) {
      item.detailSyncError = error && error.message ? error.message : String(error);
    }
    completed += 1;
    if (completed === pending.length || completed % 10 === 0) {
      emitProgress({
        stage: "sincronizando_detalhes",
        label: `Gravando formulario, historico e anexos: ${completed}/${pending.length}.`,
        current: completed,
        total: pending.length,
      });
    }
  });
  return { items, refreshed: pending.length, reused: items.length - pending.length };
}

async function main() {
  const payload = readPayload();
  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  if (!batches.length) {
    throw new Error("Payload incremental sem lotes.");
  }

  emitProgress({
    stage: "login",
    label: "Abrindo uma sessao Fluig para consultar a Central de Tarefas do usuario.",
    current: 0,
    total: 3,
  });
  const session = await loginWithBrowser({ headless: true });

  try {
    emitProgress({
      stage: "consultando_central_tarefas",
      label: "Consultando tarefas pendentes e solicitacoes abertas diretamente no Fluig.",
      current: 1,
      total: 3,
    });
    const central = await fetchUserTaskCentral(session.page, batches, { timeoutMs: 600000 });
    const enriched = await enrichCentralItems(session.page, central.items, batches, payload.detailState || []);
    const output = {
      processed: central.items.length,
      taskUserId: central.currentFluigUser.code,
      batchCount: batches.length,
      batched: true,
      directTaskCentral: true,
      ...central,
      items: enriched.items,
      detailSync: { refreshed: enriched.refreshed, reused: enriched.reused },
    };

    emitProgress({
      stage: "central_tarefas_consultada",
      label: `Fluig retornou ${central.centralTaskTotals.openTasks} tarefa(s) e ${central.centralTaskTotals.myRequests} solicitacao(oes).`,
      current: 3,
      total: 3,
    });

    const outputPath = path.join(config.logsDir, `sync-user-incremental-${nowStamp()}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log(`SYNC_USER_INCREMENTAL_RESULT ${outputPath}`);
    console.log(
      JSON.stringify(
        {
          processed: output.processed,
          items: output.items.length,
          openTasks: output.centralTaskTotals.openTasks,
          myRequests: output.centralTaskTotals.myRequests,
          unmapped: output.sourceCounts.unmapped,
        },
        null,
        2
      )
    );
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error("SYNC_USER_INCREMENTAL_ERROR");
  console.error(error.message);
  process.exitCode = 1;
});
