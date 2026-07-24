const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { readCredentials } = require("./credentials");

function scriptEnv(config) {
  const credentials = config.credentials || readCredentials(config);
  const authDir = path.join(config.configDir, "auth");
  const logsDir = path.join(config.configDir, "logs");

  return {
    ...process.env,
    ADM_FLUIG_AGENT_CONFIG_DIR: config.configDir,
    FLUIG_AUTH_DIR: authDir,
    FLUIG_LOGS_DIR: logsDir,
    FLUIG_TRACE_FILE: path.join(logsDir, "session-trace.log"),
    FLUIG_INTEGRATION_MODE: "internal_runner",
    FLUIG_BASE_URL: config.fluig.baseUrl,
    FLUIG_LOGIN_PATH: config.fluig.loginPath,
    FLUIG_LANCAMENTO_PATH: config.fluig.lancamentoPath,
    FLUIG_PROCESS_URL: config.fluig.processUrl,
    FLUIG_TASK_USER_ID: config.fluig.taskUserId,
    HEADLESS: config.fluig.headless,
    SLOW_MO: config.fluig.slowMo,
    LOGIN_USER_SELECTOR: config.fluig.selectors.loginUser,
    LOGIN_PASSWORD_SELECTOR: config.fluig.selectors.loginPassword,
    LOGIN_SUBMIT_SELECTOR: config.fluig.selectors.loginSubmit,
    POST_LOGIN_READY_SELECTOR: config.fluig.selectors.postLoginReady,
    LANCAMENTO_FORM_READY_SELECTOR: config.fluig.selectors.lancamentoFormReady,
    LANCAMENTO_SUBMIT_SELECTOR: config.fluig.selectors.lancamentoSubmit,
    FLUIG_USERNAME: credentials.username,
    FLUIG_PASSWORD: credentials.password,
  };
}

function parseTaggedJson(line, tag) {
  if (!line.startsWith(`${tag} `)) return null;

  try {
    return JSON.parse(line.slice(tag.length).trim());
  } catch {
    return null;
  }
}

function parseTaggedPath(stdout, tag) {
  const line = stdout
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${tag} `));
  return line ? line.slice(tag.length).trim() : null;
}

async function runNodeScript(config, scriptPath, args, handlers = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: config.projectRoot,
      env: scriptEnv(config),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let forceKillTimer = null;
    const timeoutMs = Number(handlers.timeoutMs);
    const timeout = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => {
          if (settled) return;
          timedOut = true;
          child.kill("SIGTERM");
          forceKillTimer = setTimeout(() => child.kill("SIGKILL"), 5000);
          forceKillTimer.unref?.();
        }, timeoutMs)
      : null;
    timeout?.unref?.();

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        handlers.onLine?.(line);
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      for (const line of text.split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
        handlers.onLine?.(line);
      }
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      reject(timedOut
        ? new Error(`Script Fluig excedeu o timeout de ${Math.ceil(timeoutMs / 1000)} segundos.`)
        : error);
    });
    child.on("close", (code) => {
      if (timeout) clearTimeout(timeout);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (settled) return;
      settled = true;
      if (timedOut) {
        reject(new Error(`Script Fluig excedeu o timeout de ${Math.ceil(timeoutMs / 1000)} segundos.`));
        return;
      }
      if (code === 0) {
        resolve({ stdout, stderr });
      } else {
        reject(new Error(stderr || stdout || `Script Fluig finalizou com codigo ${code}`));
      }
    });
  });
}

function readOutputJson(outputPath) {
  if (!outputPath || !fs.existsSync(outputPath)) {
    throw new Error(`Arquivo de resultado nao encontrado: ${outputPath || "vazio"}`);
  }

  return JSON.parse(fs.readFileSync(outputPath, "utf8"));
}

function processVersionsFromJob(job) {
  const versions = job.requestPayload?.processMap?.processVersions || job.requestPayload?.processVersions || [];
  return Array.isArray(versions) ? versions.join(",") : String(versions || "");
}

function processMapsFromPayload(payload) {
  if (!Array.isArray(payload.processMaps)) return [];

  return payload.processMaps
    .map((map) => ({
      module: String(map?.module || "").trim(),
      processId: String(map?.processId || "").trim(),
      processLabel: String(map?.processLabel || "").trim(),
      processVersions: Array.isArray(map?.processVersions)
        ? map.processVersions.map((item) => String(item || "").trim()).filter(Boolean)
        : String(map?.processVersion || "")
            .split(/[,;\s]+/)
            .map((item) => item.trim())
            .filter(Boolean),
      windows: Array.isArray(map?.windows) ? map.windows : undefined,
    }))
    .filter((map) => map.processId && map.processVersions.length);
}

function historyWindowsFromPayload(payload) {
  if (!Array.isArray(payload.windows)) return [];

  return payload.windows
    .map((window) => ({
      start: String(window?.start || "").trim(),
      end: String(window?.end || "").trim(),
    }))
    .filter((window) => window.start && window.end);
}

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function historyItemContainsCnpj(item, cnpj) {
  const fields = item && typeof item === "object" ? item.formFields || {} : {};
  const candidates = [
    fields.codCNPJ,
    fields.cnpj,
    fields.supplierCnpj,
    fields.fornecedorC,
    fields.fornecedor,
    fields.nomeFornecedor,
    fields.razaoSocial,
    JSON.stringify(fields),
  ];

  return candidates.some((value) => digitsOnly(value).includes(cnpj));
}

function compactHistoryItem(item) {
  const raw = item && typeof item.raw === "object" && item.raw ? item.raw : {};
  return {
    moduleSlug: item.moduleSlug || item.module || null,
    processInstanceId: String(item.processInstanceId || ""),
    processId: String(item.processId || ""),
    processVersion: String(item.processVersion || ""),
    status: String(item.status || ""),
    startDate: item.startDate || null,
    endDate: item.endDate || raw.endDate || null,
    requesterId: item.requesterId || null,
    requesterName: item.requesterName || null,
    formFields: item.formFields || {},
    sourceUrl: item.sourceUrl || null,
    raw: {
      processInstanceId: raw.processInstanceId || item.processInstanceId || null,
      processId: raw.processId || item.processId || null,
      processVersion: raw.processVersion || item.processVersion || null,
      status: raw.status || item.status || null,
      startDate: raw.startDate || item.startDate || null,
      endDate: raw.endDate || item.endDate || null,
      requesterId: raw.requesterId || raw.requesterCode || item.requesterId || null,
      requesterName: raw.requesterName || raw.requester || item.requesterName || null,
    },
  };
}

function syncBatchesFromPayload(payload) {
  if (!Array.isArray(payload.batches)) return [];

  return payload.batches
    .map((batch) => ({
      module: String(batch?.module || "").trim(),
      operation: String(batch?.operation || "").trim(),
      syncType: String(batch?.syncType || "").trim(),
      taskUserId: String(batch?.taskUserId || payload.taskUserId || "").trim(),
      discoverRecent: Boolean(batch?.discoverRecent),
      discovery: batch?.discovery && typeof batch.discovery === "object" ? batch.discovery : payload.discovery || {},
      processMap: batch?.processMap && typeof batch.processMap === "object" ? batch.processMap : null,
      requestIds: Array.isArray(batch?.requestIds) ? batch.requestIds.map((item) => String(item || "").trim()).filter(Boolean) : [],
      detailFields: Array.isArray(batch?.detailFields) ? batch.detailFields.map((item) => String(item || "").trim()).filter(Boolean) : [],
      detailConfigHash: String(batch?.detailConfigHash || "").trim(),
    }))
    .filter((batch) => batch.module && batch.syncType && (batch.requestIds.length || batch.discoverRecent));
}

function requestIndexFromBatches(batches) {
  const byRequestId = new Map();

  for (const batch of batches) {
    for (const requestId of batch.requestIds) {
      const current = byRequestId.get(requestId) || {
        module: batch.module,
        operations: new Set(),
        syncTypes: new Set(),
      };
      current.operations.add(batch.operation);
      current.syncTypes.add(batch.syncType);
      byRequestId.set(requestId, current);
    }
  }

  return byRequestId;
}

function annotateBatchStatusItems(result, batches) {
  const byRequestId = requestIndexFromBatches(batches);
  const items = Array.isArray(result.items) ? result.items : [];

  return {
    ...result,
    batchCount: batches.length,
    batched: true,
    items: items.map((item) => {
      const requestId = String(item?.numeroFluig || item?.requestId || "").trim();
      const metadata = byRequestId.get(requestId);

      return {
        ...item,
        moduleSlug: metadata?.module || null,
        syncTypes: metadata ? Array.from(metadata.syncTypes) : [],
        syncOperations: metadata ? Array.from(metadata.operations) : [],
        syncSource: "sync_user_incremental_batch",
      };
    }),
  };
}

function safeFileName(value) {
  const baseName = path.basename(String(value || "anexo.pdf")).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return baseName || "anexo.pdf";
}

function positiveInt(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function decodeAttachmentBase64(value, maxBytes) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Anexo sem dataBase64 valido.");
  }

  const base64 = value.trim();
  const maxBase64Chars = Math.ceil(maxBytes / 3) * 4;
  if (value.length !== base64.length) {
    throw new Error("Anexo contem dataBase64 invalido.");
  }
  if (base64.length > maxBase64Chars) {
    throw new Error(`Anexo excede o limite de ${maxBytes} bytes.`);
  }
  if (base64.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(base64)) {
    throw new Error("Anexo contem dataBase64 invalido.");
  }

  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length || buffer.length > maxBytes || buffer.toString("base64") !== base64) {
    throw new Error(`Anexo dataBase64 invalido ou acima de ${maxBytes} bytes.`);
  }
  return buffer;
}

function writePayloadAttachments(config, job, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return { items: [], root: null };

  const maxFileBytes = positiveInt(process.env.ADM_FLUIG_ATTACHMENT_MAX_BYTES, 15 * 1024 * 1024);
  const maxTotalBytes = positiveInt(process.env.ADM_FLUIG_ATTACHMENTS_MAX_TOTAL_BYTES, 25 * 1024 * 1024);
  const attachmentsRoot = path.join(/* turbopackIgnore: true */ config.projectRoot, ".adm-fluig-agent", "attachments");
  fs.mkdirSync(attachmentsRoot, { recursive: true });
  const jobPrefix = String(job.id || "job").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80) || "job";
  const attachmentRoot = fs.mkdtempSync(path.join(attachmentsRoot, `${jobPrefix}-`));
  let totalBytes = 0;

  try {
    const items = attachments.map((attachment, index) => {
      const name = safeFileName(attachment?.name || `anexo-${index + 1}.pdf`);

      if (attachment?.path != null) {
        throw new Error(`Anexo ${index + 1}: attachments[].path nao e aceito pelo agente.`);
      }

      const buffer = decodeAttachmentBase64(attachment?.dataBase64, maxFileBytes);
      totalBytes += buffer.length;
      if (totalBytes > maxTotalBytes) {
        throw new Error(`Anexos excedem o limite total de ${maxTotalBytes} bytes.`);
      }

      const filePath = path.join(attachmentRoot, `${String(index + 1).padStart(2, "0")}-${name}`);
      fs.writeFileSync(filePath, buffer, { flag: "wx", mode: 0o600 });

      return {
        path: filePath,
        name,
      };
    });
    return { items, root: attachmentRoot };
  } catch (error) {
    fs.rmSync(attachmentRoot, { recursive: true, force: true });
    throw error;
  }
}

async function executeJob(config, job, emitProgress) {
  const root = config.projectRoot;
  const payload = job.requestPayload || {};
  const processMap = payload.processMap || {};

  const onLine = (line) => {
    const historyProgress = parseTaggedJson(line, "ADM_FLUIG_HISTORY_PROGRESS");
    const statusProgress = parseTaggedJson(line, "SYNC_FLUIG_STATUS_PROGRESS");
    const openProgress = parseTaggedJson(line, "ADM_FLUIG_OPEN_PROGRESS");
    const attachProgress = parseTaggedJson(line, "ADM_FLUIG_ATTACH_PROGRESS");
    const progress = historyProgress || statusProgress || openProgress || attachProgress;
    if (progress) {
      emitProgress({
        stage: progress.stage || "reading_page",
        label: progress.label || `Fluig: ${progress.stage || "processando"}`,
        payload: progress,
      });
    }
  };

  if (job.operation === "sync_history" || job.operation === "sync_initial_history") {
    emitProgress({ stage: "authenticating", label: "Autenticando no Fluig." });
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig-adm-query-history.cjs");
    const payloadProcessMaps = processMapsFromPayload(payload);
    const historyArgs = [
      `--runner-root=${root}`,
      `--days=${payload.days || 90}`,
      `--page-size=${payload.pageSize || 100}`,
      `--max-pages=${payload.maxPages || 100}`,
    ];

    if (payloadProcessMaps.length) {
      historyArgs.push(`--process-maps-json=${JSON.stringify(payloadProcessMaps)}`);
    } else {
      historyArgs.push(`--module=${payload.module || processMap.module || job.module}`);
      historyArgs.push(`--process-id=${processMap.processId}`);
      historyArgs.push(`--process-version=${processVersionsFromJob(job)}`);
    }

    const windows = historyWindowsFromPayload(payload);
    if (windows.length > 0) {
      historyArgs.push(`--windows-json=${JSON.stringify(windows)}`);
    } else {
      if (payload.start) historyArgs.push(`--start=${payload.start}`);
      if (payload.end) historyArgs.push(`--end=${payload.end}`);
    }

    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      historyArgs,
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "ADM_FLUIG_HISTORY_RESULT");
    return {
      outputPath,
      data: readOutputJson(outputPath),
    };
  }

  if (job.operation === "supplier_lookup_by_cnpj") {
    const cnpj = digitsOnly(payload.cnpj || payload.supplierCnpj || "");
    if (cnpj.length !== 14) {
      throw new Error("CNPJ valido nao informado para consulta de fornecedor no Fluig.");
    }

    emitProgress({ stage: "authenticating", label: "Autenticando no Fluig para consultar fornecedor." });
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig-adm-query-history.cjs");
    const payloadProcessMaps = processMapsFromPayload(payload);
    if (!payloadProcessMaps.length) {
      throw new Error("Mapeamento dos processos de origem nao informado para consulta de fornecedor.");
    }

    const historyArgs = [
      `--runner-root=${root}`,
      `--days=${payload.days || 730}`,
      `--page-size=${payload.pageSize || 100}`,
      `--max-pages=${payload.maxPages || 100}`,
      `--process-maps-json=${JSON.stringify(payloadProcessMaps)}`,
    ];
    emitProgress({ stage: "reading_page", label: "Consultando historico Fluig e filtrando pelo CNPJ do fornecedor." });
    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      historyArgs,
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "ADM_FLUIG_HISTORY_RESULT");
    const output = readOutputJson(outputPath);
    const items = Array.isArray(output.items) ? output.items : [];
    const matchedItems = items.filter((item) => historyItemContainsCnpj(item, cnpj)).map(compactHistoryItem);

    return {
      outputPath,
      data: {
        generatedAt: new Date().toISOString(),
        query: output.query || {},
        inspected: output.inspected || [],
        totalItems: matchedItems.length,
        lookup: {
          cnpj,
          supplierId: payload.supplierId || null,
          supplierName: payload.supplierName || null,
          scannedItems: items.length,
          matchedItems: matchedItems.length,
          sourceOutputPath: outputPath,
        },
        items: matchedItems,
      },
    };
  }

  if (
    job.operation === "sync_status" ||
    job.operation === "sync_request_by_number" ||
    job.operation === "sync_user_open_tasks" ||
    job.operation === "sync_user_open_requests"
  ) {
    const requestIds = Array.isArray(payload.requestIds) ? payload.requestIds.map(String) : [];
    if (!requestIds.length) {
      throw new Error("Nenhum numero Fluig aberto conhecido para consulta incremental.");
    }
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig", "syncFluigStatus.js");
    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      [
        ...requestIds,
        `--task-user-id=${payload.taskUserId || processMap.defaultTaskUserId || config.fluig.taskUserId}`,
        `--detail-fields-json=${JSON.stringify(Array.isArray(payload.detailFields) ? payload.detailFields : [])}`,
        `--detail-config-hash=${String(payload.detailConfigHash || "")}`,
      ],
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "SYNC_FLUIG_STATUS_RESULT");
    return {
      outputPath,
      data: readOutputJson(outputPath),
    };
  }

  if (job.operation === "sync_user_incremental_batch") {
    const batches = syncBatchesFromPayload(payload);
    if (!batches.length) {
      throw new Error("Nenhuma sincronizacao incremental valida foi informada para o agente.");
    }

    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig", "syncUserIncremental.js");
    const taskUserId = payload.taskUserId || batches.find((batch) => batch.taskUserId)?.taskUserId || config.fluig.taskUserId;
    const payloadDir = path.join(config.configDir, "jobs");
    fs.mkdirSync(payloadDir, { recursive: true });
    const payloadPath = path.join(payloadDir, `${job.id}-incremental-payload.json`);
    fs.writeFileSync(
      payloadPath,
      JSON.stringify(
        {
          taskUserId,
          discovery: payload.discovery || {},
          userMatch: payload.userMatch || {},
          monitoredUsers: Array.isArray(payload.monitoredUsers) ? payload.monitoredUsers : [],
          batches,
          detailState: Array.isArray(payload.detailState) ? payload.detailState : [],
        },
        null,
        2
      ),
      "utf8"
    );

    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      [`--payload-file=${payloadPath}`],
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "SYNC_USER_INCREMENTAL_RESULT");
    return {
      outputPath,
      data: readOutputJson(outputPath),
    };
  }

  if (job.operation === "cancel_request") {
    const requestIds = Array.isArray(payload.requestIds) ? payload.requestIds.map(String) : [];
    if (!requestIds.length) {
      throw new Error("Nenhum numero Fluig informado para cancelamento.");
    }
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig", "cancelViaApi.js");
    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      [...requestIds, `--comment=${payload.comment || "Cancelamento executado via ADM MaxControl."}`],
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "CANCEL_VIA_API_RESULT");
    return {
      outputPath,
      data: readOutputJson(outputPath),
    };
  }

  if (job.operation === "open_from_source") {
    const sourceRequestId = String(payload.sourceRequestId || "").trim();
    if (!sourceRequestId) {
      throw new Error("Modelo Fluig de origem nao informado.");
    }
    emitProgress({ stage: "opening_fluig", label: "Abrindo sessao segura no Fluig." });
    const temporaryAttachments = writePayloadAttachments(config, job, payload.attachments);
    const fieldOverrides = Object.entries(payload.fieldOverrides || {}).flatMap(([field, value]) => [
      `--set=${field}=${value == null ? "" : String(value)}`,
    ]);
    const attachmentArgs = temporaryAttachments.items.flatMap((attachment) => [
      `--attachment-path=${attachment.path}`,
      `--attachment-name=${attachment.name}`,
    ]);
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig-adm-open-from-source.cjs");
    try {
      const { stdout } = await runNodeScript(
        config,
        scriptPath,
        [
          `--runner-root=${root}`,
          `--source-request-id=${sourceRequestId}`,
          `--task-user-id=${payload.taskUserId || processMap.defaultTaskUserId || config.fluig.taskUserId}`,
          ...fieldOverrides,
          ...attachmentArgs,
        ],
        {
          onLine,
          timeoutMs: positiveInt(process.env.ADM_FLUIG_OPEN_TIMEOUT_MS, 15 * 60 * 1000),
        }
      );
      const outputPath = parseTaggedPath(stdout, "ADM_FLUIG_OPEN_RESULT");
      return {
        outputPath,
        data: readOutputJson(outputPath),
      };
    } finally {
      if (temporaryAttachments.root) {
        fs.rmSync(temporaryAttachments.root, { recursive: true, force: true });
      }
    }
  }

  if (job.operation === "attach_to_request") {
    const requestId = String(payload.requestId || "").trim();
    if (!/^\d+$/.test(requestId)) {
      throw new Error("Numero da solicitacao Fluig invalido para anexar ADF.");
    }
    emitProgress({ stage: "opening_fluig", label: `Abrindo solicitacao Fluig ${requestId}.` });
    const temporaryAttachments = writePayloadAttachments(config, job, payload.attachments);
    if (!temporaryAttachments.items.length) {
      throw new Error("Nenhum PDF de ADF foi informado para anexar ao Fluig.");
    }
    const attachmentArgs = temporaryAttachments.items.flatMap((attachment) => [
      `--attachment-path=${attachment.path}`,
      `--attachment-name=${attachment.name}`,
    ]);
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig", "attachToRequest.js");
    try {
      const { stdout } = await runNodeScript(
        config,
        scriptPath,
        [
          `--request-id=${requestId}`,
          `--task-user-id=${payload.taskUserId || processMap.defaultTaskUserId || config.fluig.taskUserId}`,
          ...attachmentArgs,
        ],
        {
          onLine,
          timeoutMs: positiveInt(process.env.ADM_FLUIG_ATTACH_TIMEOUT_MS, 10 * 60 * 1000),
        }
      );
      const outputPath = parseTaggedPath(stdout, "ADM_FLUIG_ATTACH_RESULT");
      return { outputPath, data: readOutputJson(outputPath) };
    } finally {
      if (temporaryAttachments.root) {
        fs.rmSync(temporaryAttachments.root, { recursive: true, force: true });
      }
    }
  }

  if (job.operation === "health_check") {
    emitProgress({ stage: "authenticating", label: "Autenticando com a credencial cadastrada no Fluig." });
    const scriptPath = path.join(/* turbopackIgnore: true */ root, "scripts", "fluig", "healthCheck.js");
    const { stdout } = await runNodeScript(config, scriptPath, [], { onLine });
    const healthResult = stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .map((line) => parseTaggedJson(line, "FLUIG_HEALTH_CHECK_RESULT"))
      .find(Boolean);

    if (!healthResult?.ok || !healthResult.authenticated) {
      throw new Error("O Fluig nao confirmou uma sessao autenticada para este usuario.");
    }

    emitProgress({ stage: "reading_page", label: "Sessao autenticada confirmada pelo Fluig." });
    return {
      data: {
        ...healthResult,
        machineName: config.machineName,
        agentVersion: config.agentVersion,
        localApiUrl: `http://127.0.0.1:${config.localPort}`,
        admApiUrl: config.apiUrl,
        fluigBaseUrlConfigured: Boolean(config.fluig.baseUrl),
        pollIntervalMs: config.pollIntervalMs,
        projectRoot: root,
      },
    };
  }

  throw new Error(`Operacao de job nao suportada: ${job.operation}`);
}

module.exports = {
  executeJob,
  __test: {
    decodeAttachmentBase64,
    runNodeScript,
    writePayloadAttachments,
  },
};
