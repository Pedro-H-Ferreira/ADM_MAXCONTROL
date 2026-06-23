/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchDetails, fetchRequest } = require("./api/workflowViewApi");

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

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeIdentity(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function identityCandidates(payload, batch) {
  const userMatch = payload.userMatch || {};
  return [
    payload.taskUserId,
    batch?.taskUserId,
    userMatch.fluigUserId,
    userMatch.fluigUsername,
    userMatch.email,
    userMatch.displayName,
  ]
    .map(normalizeIdentity)
    .filter(Boolean);
}

function matchesAnyIdentity(values, candidates) {
  const normalizedValues = values.map(normalizeIdentity).filter(Boolean);
  if (!normalizedValues.length || !candidates.length) return false;

  return normalizedValues.some((value) =>
    candidates.some((candidate) => value === candidate || value.includes(candidate) || candidate.includes(value))
  );
}

function formatWindowDate(date, endOfDay = false) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}${endOfDay ? "T23:59:59-0300" : "T00:00:00-0300"}`;
}

function discoveryWindow(discovery) {
  const days = Number(discovery?.days || 21);
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (Number.isFinite(days) && days > 0 ? days : 21));
  return {
    initialStartDate: formatWindowDate(start),
    finalStartDate: formatWindowDate(end, true),
  };
}

function processVersions(processMap) {
  if (Array.isArray(processMap?.processVersions)) {
    return processMap.processVersions.map((item) => normalizeText(item)).filter(Boolean);
  }

  return normalizeText(processMap?.processVersion)
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function buildFieldsMap(formFields = []) {
  return Object.fromEntries(
    formFields.map((item) => [String(item.field || item.name || "").trim(), item.value == null ? "" : String(item.value)])
  );
}

async function fetchJson(page, url, timeoutMs) {
  return page.evaluate(
    async ({ targetUrl, requestTimeoutMs }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      try {
        const response = await fetch(targetUrl, {
          signal: controller.signal,
          credentials: "include",
          headers: { accept: "application/json" },
        });
        const text = await response.text();
        if (!response.ok) {
          return {
            __httpError: true,
            status: response.status,
            statusText: response.statusText,
            body: text,
          };
        }
        return text ? JSON.parse(text) : {};
      } finally {
        clearTimeout(timer);
      }
    },
    { targetUrl: url, requestTimeoutMs: timeoutMs }
  );
}

function assertResponse(response, context) {
  if (response && response.__httpError) {
    throw new Error(`Falha HTTP ${response.status} ao consultar ${context}: ${response.statusText || response.body || ""}`);
  }

  return response;
}

async function discoverRecentRequests(page, batch, discovery) {
  const processMap = batch.processMap || {};
  const versions = processVersions(processMap);
  const processId = normalizeText(processMap.processId);

  if (!batch.discoverRecent || !processId || !versions.length) return [];

  const pageSize = Number(batch.discovery?.pageSize || discovery?.pageSize || 50);
  const maxPages = Number(batch.discovery?.maxPages || discovery?.maxPages || 2);
  const timeoutMs = Number(batch.discovery?.timeoutMs || discovery?.timeoutMs || 30000);
  const window = discoveryWindow(batch.discovery || discovery);
  const items = [];

  emitProgress({
    stage: "discovering",
    label: `Descobrindo solicitacoes recentes de ${processMap.processLabel || batch.module}.`,
    module: batch.module,
    processId,
  });

  for (const processVersion of versions) {
    for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
      const params = new URLSearchParams();
      params.append("initialStartDate", window.initialStartDate);
      params.append("finalStartDate", window.finalStartDate);
      params.append("page", String(pageNumber));
      params.append("pageSize", String(pageSize));
      params.append("order", "-processInstanceId");
      params.append("expand", "formFields");

      const endpoint = `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions/${encodeURIComponent(
        processVersion
      )}/requests?${params.toString()}`;
      const response = assertResponse(await fetchJson(page, endpoint, timeoutMs), endpoint);
      const requests = Array.isArray(response.items) ? response.items : [];

      for (const request of requests) {
        items.push({
          module: batch.module,
          processInstanceId: String(request.processInstanceId || ""),
          requesterId: request.requesterId || request.requesterCode || null,
          requesterName: request.requesterName || request.requester || null,
          status: String(request.status || ""),
          startDate: request.startDate || null,
          formFields: buildFieldsMap(Array.isArray(request.formFields) ? request.formFields : []),
        });
      }

      if (!response.hasNext || requests.length === 0) break;
    }
  }

  return items;
}

function addRequestEntry(index, requestId, entry) {
  if (!requestId) return;
  const current = index.get(requestId) || {
    module: entry.module,
    entries: [],
  };
  current.entries.push(entry);
  index.set(requestId, current);
}

function buildRequestIndex(payload, discoveredByBatch) {
  const index = new Map();

  for (const batch of payload.batches || []) {
    for (const requestId of batch.requestIds || []) {
      addRequestEntry(index, String(requestId), {
        module: batch.module,
        operation: batch.operation,
        syncType: batch.syncType,
        source: "known",
      });
    }
  }

  for (const [batchIndex, discoveredItems] of discoveredByBatch.entries()) {
    const batch = payload.batches[batchIndex];
    const candidates = identityCandidates(payload, batch);
    for (const item of discoveredItems) {
      const requestId = String(item.processInstanceId || "").trim();
      if (!requestId) continue;

      if (batch.syncType === "my_requests") {
        const isRequester = matchesAnyIdentity([item.requesterId, item.requesterName], candidates);
        if (!isRequester) continue;
      }

      addRequestEntry(index, requestId, {
        module: batch.module,
        operation: batch.operation,
        syncType: batch.syncType,
        source: "discovery",
      });
    }
  }

  return index;
}

function normalizeDateOnly(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const ptBr = raw.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (ptBr) return `${ptBr[3]}-${ptBr[2]}-${ptBr[1]}`;

  return null;
}

async function fetchPaymentDueDate(page, requestId) {
  try {
    const request = await fetchRequest(page, requestId);
    const fields = buildFieldsMap(request?.formFields || []);
    return {
      raw: fields.vencPagNota || "",
      normalized: normalizeDateOnly(fields.vencPagNota),
    };
  } catch (error) {
    return {
      raw: "",
      normalized: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function statusMatchesOpenTask(item, payload, metadata) {
  const candidates = identityCandidates(payload, {
    taskUserId: payload.taskUserId,
  });
  return matchesAnyIdentity(
    [
      item.responsavelCodigo,
      item.responsavelLogin,
      item.responsavelAtual,
      ...(Array.isArray(item.currentStates)
        ? item.currentStates.flatMap((state) => [state.colleagueId, state.colleagueLogin, state.colleagueName])
        : []),
    ],
    candidates
  ) || metadata.entries.some((entry) => entry.source === "known" && entry.syncType === "open_tasks");
}

function filterMetadataForStatus(item, payload, metadata) {
  const entries = metadata.entries.filter((entry) => {
    if (entry.syncType !== "open_tasks") return true;
    if (entry.source !== "discovery") return true;
    return statusMatchesOpenTask(item, payload, metadata);
  });

  if (!entries.length) return null;

  return {
    module: metadata.module,
    entries,
    syncTypes: Array.from(new Set(entries.map((entry) => entry.syncType))),
    operations: Array.from(new Set(entries.map((entry) => entry.operation))),
  };
}

async function fetchStatusItem(page, requestId, taskUserId) {
  const details = await fetchDetails(page, requestId, taskUserId);
  const paymentDueDate = await fetchPaymentDueDate(page, requestId);
  const content = details?.content || {};
  const currentState = Array.isArray(content.currentStates) ? content.currentStates[0] : null;
  const etapaAtual = String(content.stateDescription || currentState?.stateDescription || "");

  return {
    numeroFluig: String(requestId),
    vencimentoPagamento: paymentDueDate.normalized,
    vencPagNota: paymentDueDate.raw,
    vencimentoPagamentoErro: paymentDueDate.error || null,
    etapaAtual,
    responsavelAtual: String(content.colleagueName || currentState?.colleagueName || ""),
    stateSequence: content.stateSequence ?? currentState?.stateSequence ?? null,
    movementSequence: content.movementSequence ?? currentState?.movementSequence ?? null,
    responsavelCodigo: String(currentState?.colleagueId || ""),
    responsavelLogin: String(currentState?.colleagueLogin || ""),
    currentStates: Array.isArray(content.currentStates)
      ? content.currentStates.map((state) => ({
          stateSequence: state.stateSequence ?? null,
          stateDescription: String(state.stateDescription || ""),
          colleagueId: String(state.colleagueId || ""),
          colleagueName: String(state.colleagueName || ""),
          colleagueLogin: String(state.colleagueLogin || ""),
          movementSequence: state.movementSequence ?? null,
          deadlineText: String(state.deadlineText || ""),
          canceled: Boolean(state.canceled),
        }))
      : [],
    statusProcesso: content.active === false ? "finalizado" : content.expired ? "expirado" : "em_andamento",
    active: content.active !== false,
    slaExpirado: Boolean(content.expired),
    cancelavel: Boolean(content.cancelable),
    prazoTexto: String(content.dateExpires || currentState?.deadlineText || ""),
    dataUltimaConsulta: new Date().toISOString(),
  };
}

async function main() {
  const payload = readPayload();
  const batches = Array.isArray(payload.batches) ? payload.batches : [];
  if (!batches.length) {
    throw new Error("Payload incremental sem lotes.");
  }

  emitProgress({
    stage: "login",
    label: "Abrindo uma unica sessao Fluig para descobrir e consultar solicitacoes do usuario.",
    current: 0,
    total: batches.length,
  });
  const session = await loginWithBrowser({ headless: true });

  try {
    const { page } = session;
    const discoveredByBatch = new Map();

    for (const [index, batch] of batches.entries()) {
      const discovered = await discoverRecentRequests(page, batch, payload.discovery || {});
      discoveredByBatch.set(index, discovered);
    }

    const requestIndex = buildRequestIndex(payload, discoveredByBatch);
    const requestIds = Array.from(requestIndex.keys());
    const items = [];

    emitProgress({
      stage: "consultando",
      label: `Sessao pronta. Consultando ${requestIds.length} solicitacao(oes) no Fluig.`,
      current: 0,
      total: requestIds.length,
    });

    for (const [index, requestId] of requestIds.entries()) {
      emitProgress({
        stage: "consultando_item",
        label: `Consultando Fluig ${requestId}`,
        current: index,
        total: requestIds.length,
        numeroFluig: String(requestId),
      });

      try {
        const item = await fetchStatusItem(page, requestId, payload.taskUserId || config.fluig.taskUserId);
        const metadata = filterMetadataForStatus(item, payload, requestIndex.get(requestId));
        if (!metadata) continue;

        items.push({
          ...item,
          moduleSlug: metadata.module,
          syncTypes: metadata.syncTypes,
          syncOperations: metadata.operations,
          syncSource: "sync_user_incremental_batch",
        });

        emitProgress({
          stage: "item_consultado",
          label: `Fluig ${requestId} consultado: ${item.etapaAtual || "sem etapa retornada"}`,
          current: index + 1,
          total: requestIds.length,
          numeroFluig: String(requestId),
          status: item.etapaAtual || "sem etapa retornada",
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const metadata = requestIndex.get(requestId);
        items.push({
          numeroFluig: String(requestId),
          moduleSlug: metadata?.module || null,
          syncTypes: metadata ? Array.from(new Set(metadata.entries.map((entry) => entry.syncType))) : [],
          syncOperations: metadata ? Array.from(new Set(metadata.entries.map((entry) => entry.operation))) : [],
          syncSource: "sync_user_incremental_batch",
          error: message,
          dataUltimaConsulta: new Date().toISOString(),
        });
      }
    }

    const output = {
      processed: requestIds.length,
      taskUserId: payload.taskUserId || config.fluig.taskUserId,
      batchCount: batches.length,
      batched: true,
      discovery: {
        enabled: batches.some((batch) => batch.discoverRecent),
        totalDiscovered: Array.from(discoveredByBatch.values()).reduce((sum, entries) => sum + entries.length, 0),
        modules: batches.map((batch, index) => ({
          module: batch.module,
          syncType: batch.syncType,
          knownRequestIds: Array.isArray(batch.requestIds) ? batch.requestIds.length : 0,
          discovered: (discoveredByBatch.get(index) || []).length,
        })),
      },
      items,
      processedAt: new Date().toISOString(),
    };

    const outputPath = path.join(config.logsDir, `sync-user-incremental-${nowStamp()}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log(`SYNC_USER_INCREMENTAL_RESULT ${outputPath}`);
    console.log(JSON.stringify({ processed: output.processed, items: output.items.length }, null, 2));
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error("SYNC_USER_INCREMENTAL_ERROR");
  console.error(error.message);
  process.exitCode = 1;
});
