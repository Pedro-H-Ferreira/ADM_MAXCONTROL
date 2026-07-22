function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

async function fetchJson(page, url, timeoutMs = 600000) {
  const response = await page.evaluate(
    async ({ targetUrl, requestTimeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const result = await fetch(targetUrl, {
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
        return {
          status: result.status,
          statusText: result.statusText,
          text: await result.text(),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { targetUrl: url, requestTimeoutMs: timeoutMs }
  );

  if (!response || response.status < 200 || response.status >= 300) {
    const summary = normalizeText(response?.text).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `Consulta Fluig ${url} falhou com HTTP ${response?.status || "desconhecido"}${summary ? `: ${summary}` : ""}`
    );
  }

  try {
    return response.text ? JSON.parse(response.text) : {};
  } catch {
    throw new Error(`Consulta Fluig ${url} retornou JSON invalido.`);
  }
}

async function postJson(page, url, body, timeoutMs = 600000) {
  const response = await page.evaluate(
    async ({ targetUrl, requestBody, requestTimeoutMs }) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), requestTimeoutMs);

      try {
        const result = await fetch(targetUrl, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          headers: { accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        return {
          status: result.status,
          statusText: result.statusText,
          text: await result.text(),
        };
      } finally {
        clearTimeout(timeoutId);
      }
    },
    { targetUrl: url, requestBody: body, requestTimeoutMs: timeoutMs }
  );

  if (!response || response.status < 200 || response.status >= 300) {
    const summary = normalizeText(response?.text).replace(/\s+/g, " ").slice(0, 500);
    throw new Error(
      `Consulta Fluig ${url} falhou com HTTP ${response?.status || "desconhecido"}${summary ? `: ${summary}` : ""}`
    );
  }

  try {
    return response.text ? JSON.parse(response.text) : {};
  } catch {
    throw new Error(`Consulta Fluig ${url} retornou JSON invalido.`);
  }
}

function contentItems(payload) {
  const content = payload && typeof payload === "object" ? payload.content : null;
  if (Array.isArray(content)) return content;
  return content && typeof content === "object" ? [content] : [];
}

function currentUserIdentity(payload) {
  const content = payload && typeof payload === "object" ? payload.content : null;
  if (!content || typeof content !== "object") return null;

  const code = normalizeText(content.code);
  if (!code) return null;

  return {
    id: normalizeText(content.id) || null,
    code,
    login: normalizeText(content.login) || null,
    email: normalizeText(content.email) || null,
    fullName: normalizeText(content.fullName) || null,
  };
}

async function fetchCurrentFluigUser(page, timeoutMs = 600000) {
  const payload = await fetchJson(page, "/api/public/2.0/users/getCurrent", timeoutMs);
  const user = currentUserIdentity(payload);
  if (!user) throw new Error("O Fluig nao retornou o codigo do colaborador autenticado.");
  return user;
}

function datasetRows(payload) {
  const content = payload && typeof payload === "object" ? payload.content : null;
  if (Array.isArray(content?.values)) return content.values;
  if (Array.isArray(content)) return content;
  return Array.isArray(payload?.values) ? payload.values : [];
}

async function findColleagues(page, field, value, likeSearch, timeoutMs) {
  const payload = await postJson(page, "/api/public/ecm/dataset/datasets", {
    name: "colleague",
    fields: null,
    constraints: [{ _field: field, _initialValue: value, _finalValue: value, _type: 1, _likeSearch: likeSearch }],
    order: null,
  }, timeoutMs);
  return datasetRows(payload);
}

function colleagueCode(row) {
  return normalizeText(row?.["colleaguePK.colleagueId"] || row?.colleagueId);
}

function pickColleague(rows, email, localPart) {
  const activeRows = rows.filter(
    (row) => colleagueCode(row) && String(row.active || "true").toLowerCase() !== "false"
  );
  return (
    activeRows.find((row) => normalizeText(row.mail).toLowerCase() === email) ||
    activeRows.find((row) => {
      const login = normalizeText(row.login).toLowerCase();
      const mail = normalizeText(row.mail).toLowerCase();
      return login.includes(localPart) || mail.includes(localPart);
    }) ||
    (activeRows.length === 1 ? activeRows[0] : null)
  );
}

async function resolveTargetFluigUser(page, target, timeoutMs = 600000) {
  const explicitCode = normalizeText(target?.code || target?.fluigUserId);
  const email = normalizeText(target?.email).toLowerCase();
  if (explicitCode) {
    return {
      id: normalizeText(target?.id) || null,
      code: explicitCode,
      login: normalizeText(target?.login || target?.fluigLogin) || null,
      email: email || null,
      fullName: normalizeText(target?.fullName || target?.displayName) || null,
    };
  }
  if (!email) throw new Error("Usuario monitorado sem e-mail ou codigo Fluig.");

  const localPart = email.split("@")[0];
  const exactRows = await findColleagues(page, "mail", email, false, timeoutMs);
  let row = pickColleague(exactRows, email, localPart);
  if (!row) {
    const mailRows = await findColleagues(page, "mail", localPart, true, timeoutMs);
    row = pickColleague(mailRows, email, localPart);
  }
  if (!row) {
    const loginRows = await findColleagues(page, "login", localPart, true, timeoutMs);
    row = pickColleague(loginRows, email, localPart);
  }
  const code = colleagueCode(row);
  if (!row || !code) throw new Error(`Usuario ${email} nao encontrado no cadastro de colaboradores do Fluig.`);
  if (String(row.active || "true").toLowerCase() === "false") throw new Error(`Usuario ${email} esta inativo no Fluig.`);
  return {
    id: null,
    code,
    login: normalizeText(row.login) || null,
    email: normalizeText(row.mail) || email,
    fullName: normalizeText(row.colleagueName) || normalizeText(target?.displayName) || null,
  };
}

function workflowEnvelope(payload) {
  const content = payload && typeof payload === "object" ? payload.content : null;
  const items = Array.isArray(content?.items)
    ? content.items
    : Array.isArray(payload?.items)
      ? payload.items
      : Array.isArray(content)
        ? content
        : [];
  return {
    items,
    hasNext: content?.hasNext ?? payload?.hasNext ?? null,
  };
}

function mapFallbackWorkflowTask(item) {
  const actualTask = Array.isArray(item?.actualTasks) ? item.actualTasks[0] : null;
  return {
    ...item,
    processInstanceId: item?.processInstanceId,
    processId: item?.processId,
    processDescription: item?.processDescription,
    requesterId: item?.requesterId || item?.requesterCode,
    requesterName: item?.requesterName,
    movementHour: item?.movementHour || item?.startDate,
    stateDescription: item?.stateDescription || item?.stateName || actualTask?.stateName || actualTask?.stateDescription,
    stateId: item?.stateId ?? actualTask?.stateSequence ?? actualTask?.stateId,
    movementSequence: item?.movementSequence ?? actualTask?.movementSequence,
    colleagueName: item?.colleagueName || actualTask?.assignee?.name || actualTask?.assigneeName,
    deadlineDate: item?.deadlineDate || actualTask?.deadlineDate,
    active: item?.active !== false,
  };
}

async function fetchWorkflowTasksFallback(page, batches, fluigUser, timeoutMs) {
  const processIds = Array.from(
    new Set((batches || []).map((batch) => normalizeText(batch?.processMap?.processId)).filter(Boolean))
  );
  const items = [];
  const errors = [];
  const pageSize = 200;

  for (const processId of processIds) {
    let pageNumber = 1;
    try {
      while (pageNumber <= 50) {
        const params = new URLSearchParams({
          processId,
          assignee: fluigUser.code,
          status: "OPEN",
          page: String(pageNumber),
          pageSize: String(pageSize),
          expand: "actualTasks",
        });
        const payload = await fetchJson(
          page,
          `/api/public/2.0/workflows/requests/tasks?${params.toString()}`,
          timeoutMs
        );
        const envelope = workflowEnvelope(payload);
        items.push(...envelope.items.map(mapFallbackWorkflowTask));
        if (envelope.hasNext === false || envelope.items.length < pageSize) break;
        pageNumber += 1;
      }
    } catch (error) {
      errors.push(error && error.message ? error.message : String(error));
    }
  }

  if (!items.length && errors.length) throw new Error(errors.join(" | "));
  return items;
}

function totalsFromSummary(payload) {
  const totals = Object.fromEntries(
    contentItems(payload)
      .map((item) => [normalizeText(item.type), Number(item.totalTask || 0)])
      .filter(([type]) => Boolean(type))
  );

  return {
    openTasks: Math.max(0, Number(totals.open || 0)),
    myRequests: Math.max(0, Number(totals.requests || 0)),
  };
}

function processModuleIndex(batches) {
  const index = new Map();
  for (const batch of batches || []) {
    const processId = normalizeKey(batch?.processMap?.processId);
    const moduleSlug = normalizeText(batch?.module);
    if (processId && moduleSlug) index.set(processId, moduleSlug);
  }
  return index;
}

function knownRequestModuleIndex(batches) {
  const index = new Map();
  for (const batch of batches || []) {
    const moduleSlug = normalizeText(batch?.module);
    for (const requestId of batch?.requestIds || []) {
      if (requestId && moduleSlug) index.set(String(requestId), moduleSlug);
    }
  }
  return index;
}

function inferModule(item, processModules, knownRequestModules) {
  const requestId = normalizeText(item.processInstanceId);
  const processKey = normalizeKey(item.processId || item.processDescription);
  const exact = processModules.get(processKey);
  if (exact) return exact;
  if (knownRequestModules.has(requestId)) return knownRequestModules.get(requestId);
  if (processKey.includes("central de lancamento")) return "pagamentos";
  if (processKey.includes("compra administrativa")) return "compras";
  if (processKey.includes("ativo fixo") || processKey.includes("transferencia baixas ativo")) return "manutencao";
  return null;
}

function normalizeDate(value) {
  const raw = normalizeText(value);
  if (!raw) return null;
  const sqlDate = raw.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (sqlDate) {
    return `${sqlDate[1]}-${sqlDate[2]}-${sqlDate[3]}T${sqlDate[4]}:${sqlDate[5]}:${sqlDate[6]}-03:00`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function mapCentralTaskItem(item, input) {
  const moduleSlug = inferModule(item, input.processModules, input.knownRequestModules);
  if (!moduleSlug) return null;

  return {
    numeroFluig: normalizeText(item.processInstanceId),
    moduleSlug,
    processId: normalizeText(item.processId) || null,
    processDescription: normalizeText(item.processDescription) || null,
    requesterId: normalizeText(item.requesterId) || null,
    requesterName: normalizeText(item.requesterName) || null,
    openedAt: normalizeDate(item.movementHour),
    etapaAtual: normalizeText(item.stateDescription),
    responsavelAtual: normalizeText(item.colleagueName),
    responsavelCodigo: input.syncType === "open_tasks" ? input.fluigUser.code : "",
    stateSequence: item.stateId == null ? null : Number(item.stateId),
    movementSequence: item.movementSequence == null ? null : Number(item.movementSequence),
    statusProcesso: item.active === false ? "finalizado" : "em_andamento",
    active: item.active !== false,
    slaExpirado: Boolean(item.expired),
    prazoTexto: normalizeText(item.deadlineText || item.deadlineDate),
    dueDate: normalizeDate(item.deadlineDate),
    dataUltimaConsulta: input.syncStartedAt,
    syncFluigUserId: input.fluigUser.code,
    syncTypes: [input.syncType],
    syncOperations: [input.operation],
    syncSource: "fluig_task_central",
  };
}

function mergeCentralItems(items) {
  const byRequest = new Map();

  for (const item of items) {
    if (!item?.numeroFluig || !item?.moduleSlug) continue;
    const key = `${item.moduleSlug}:${item.numeroFluig}`;
    const current = byRequest.get(key);
    if (!current) {
      byRequest.set(key, item);
      continue;
    }

    byRequest.set(key, {
      ...current,
      ...item,
      etapaAtual: item.etapaAtual || current.etapaAtual,
      responsavelAtual: item.responsavelAtual || current.responsavelAtual,
      responsavelCodigo: item.responsavelCodigo || current.responsavelCodigo,
      syncTypes: Array.from(new Set([...(current.syncTypes || []), ...(item.syncTypes || [])])),
      syncOperations: Array.from(new Set([...(current.syncOperations || []), ...(item.syncOperations || [])])),
    });
  }

  return Array.from(byRequest.values());
}

function membershipSummary(items, centralTaskTotals) {
  const modules = new Map();
  for (const item of items) {
    const current = modules.get(item.moduleSlug) || { module: item.moduleSlug, openTasks: 0, myRequests: 0 };
    if (item.syncTypes.includes("open_tasks")) current.openTasks += 1;
    if (item.syncTypes.includes("my_requests") || item.syncTypes.includes("open_tasks")) current.myRequests += 1;
    modules.set(item.moduleSlug, current);
  }

  return {
    global: centralTaskTotals,
    modules: Array.from(modules.values()),
  };
}

async function fetchUserTaskCentral(page, batches, options = {}) {
  const syncStartedAt = new Date().toISOString();
  const fluigUser = options.targetUser
    ? await resolveTargetFluigUser(page, options.targetUser, options.timeoutMs)
    : await fetchCurrentFluigUser(page, options.timeoutMs);

  const encodedUserCode = encodeURIComponent(fluigUser.code);
  const [summaryPayload, requestsPayload] = await Promise.all([
    fetchJson(page, `/api/public/2.0/tasks/getResumedTasks/${encodedUserCode}`, options.timeoutMs),
    fetchJson(page, `/api/public/2.0/tasks/findMyRequests/${encodedUserCode}`, options.timeoutMs),
  ]);
  let tasksPayload;
  try {
    tasksPayload = await fetchJson(
      page,
      `/api/public/2.0/tasks/findWorkflowTasks/${encodedUserCode}`,
      options.timeoutMs
    );
  } catch (error) {
    const fallbackItems = await fetchWorkflowTasksFallback(page, batches, fluigUser, options.timeoutMs).catch(() => {
      throw error;
    });
    if (!fallbackItems.length && totalsFromSummary(summaryPayload).openTasks > 0) throw error;
    tasksPayload = { content: fallbackItems };
  }

  const centralTaskTotals = totalsFromSummary(summaryPayload);
  const processModules = processModuleIndex(batches);
  const knownRequestModules = knownRequestModuleIndex(batches);
  const rawTasks = contentItems(tasksPayload);
  const rawRequests = contentItems(requestsPayload);
  const mappedItems = [
    ...rawTasks.map((item) =>
      mapCentralTaskItem(item, {
        processModules,
        knownRequestModules,
        fluigUser,
        syncStartedAt,
        syncType: "open_tasks",
        operation: "sync_user_open_tasks",
      })
    ),
    ...rawRequests.map((item) =>
      mapCentralTaskItem(item, {
        processModules,
        knownRequestModules,
        fluigUser,
        syncStartedAt,
        syncType: "my_requests",
        operation: "sync_user_open_requests",
      })
    ),
  ].filter(Boolean);
  const items = mergeCentralItems(mappedItems);

  return {
    currentFluigUser: fluigUser,
    centralTaskTotals,
    membership: membershipSummary(items, centralTaskTotals),
    sourceCounts: {
      openTasks: rawTasks.length,
      myRequests: rawRequests.length,
      mapped: mappedItems.length,
      unmapped: rawTasks.length + rawRequests.length - mappedItems.length,
    },
    syncStartedAt,
    processedAt: new Date().toISOString(),
    items,
  };
}

module.exports = {
  fetchCurrentFluigUser,
  fetchUserTaskCentral,
  resolveTargetFluigUser,
  __test: {
    currentUserIdentity,
    datasetRows,
    mapFallbackWorkflowTask,
    pickColleague,
    workflowEnvelope,
    inferModule,
    mapCentralTaskItem,
    membershipSummary,
    mergeCentralItems,
    normalizeDate,
    normalizeKey,
    totalsFromSummary,
  },
};
