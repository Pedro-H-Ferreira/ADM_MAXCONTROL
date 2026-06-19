const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { readCredentials } = require("./credentials");

function scriptEnv(config) {
  const credentials = readCredentials(config);

  return {
    ...process.env,
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

    child.on("error", reject);
    child.on("close", (code) => {
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

function safeFileName(value) {
  const baseName = path.basename(String(value || "anexo.pdf")).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return baseName || "anexo.pdf";
}

function writePayloadAttachments(config, job, attachments) {
  if (!Array.isArray(attachments) || !attachments.length) return [];

  const attachmentRoot = path.join(config.projectRoot, ".adm-fluig-agent", "attachments", job.id);
  fs.mkdirSync(attachmentRoot, { recursive: true });

  return attachments
    .map((attachment, index) => {
      const name = safeFileName(attachment?.name || `anexo-${index + 1}.pdf`);

      if (attachment?.path) {
        return {
          path: String(attachment.path),
          name,
        };
      }

      if (!attachment?.dataBase64) {
        return null;
      }

      const filePath = path.join(attachmentRoot, `${String(index + 1).padStart(2, "0")}-${name}`);
      fs.writeFileSync(filePath, Buffer.from(String(attachment.dataBase64), "base64"));

      return {
        path: filePath,
        name,
      };
    })
    .filter(Boolean);
}

async function executeJob(config, job, emitProgress) {
  const root = config.projectRoot;
  const payload = job.requestPayload || {};
  const processMap = payload.processMap || {};

  const onLine = (line) => {
    const historyProgress = parseTaggedJson(line, "ADM_FLUIG_HISTORY_PROGRESS");
    const statusProgress = parseTaggedJson(line, "SYNC_FLUIG_STATUS_PROGRESS");
    const progress = historyProgress || statusProgress;
    if (progress) {
      emitProgress({
        stage: progress.stage || "reading_page",
        label: progress.label || `Fluig: ${progress.stage || "processando"}`,
        payload: progress,
      });
    }
  };

  if (job.operation === "sync_history") {
    emitProgress({ stage: "authenticating", label: "Autenticando no Fluig." });
    const scriptPath = path.join(root, "scripts", "fluig-adm-query-history.cjs");
    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      [
        `--runner-root=${root}`,
        `--process-id=${processMap.processId}`,
        `--process-version=${processVersionsFromJob(job)}`,
        `--days=${payload.days || 90}`,
        `--page-size=${payload.pageSize || 50}`,
        `--max-pages=${payload.maxPages || 3}`,
      ],
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "ADM_FLUIG_HISTORY_RESULT");
    return {
      outputPath,
      data: readOutputJson(outputPath),
    };
  }

  if (job.operation === "sync_status") {
    const requestIds = Array.isArray(payload.requestIds) ? payload.requestIds.map(String) : [];
    if (!requestIds.length) {
      throw new Error("Nenhum numero Fluig informado para consulta de status.");
    }
    const scriptPath = path.join(root, "scripts", "fluig", "syncFluigStatus.js");
    const { stdout } = await runNodeScript(
      config,
      scriptPath,
      [...requestIds, `--task-user-id=${payload.taskUserId || processMap.defaultTaskUserId || config.fluig.taskUserId}`],
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "SYNC_FLUIG_STATUS_RESULT");
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
    const scriptPath = path.join(root, "scripts", "fluig", "cancelViaApi.js");
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
    const attachments = writePayloadAttachments(config, job, payload.attachments);
    const fieldOverrides = Object.entries(payload.fieldOverrides || {}).flatMap(([field, value]) => [
      `--set=${field}=${value == null ? "" : String(value)}`,
    ]);
    const attachmentArgs = attachments.flatMap((attachment) => [
      `--attachment-path=${attachment.path}`,
      `--attachment-name=${attachment.name}`,
    ]);
    const scriptPath = path.join(root, "scripts", "fluig-adm-open-from-source.cjs");
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
      { onLine }
    );
    const outputPath = parseTaggedPath(stdout, "ADM_FLUIG_OPEN_RESULT");
    return {
      outputPath,
      data: readOutputJson(outputPath),
    };
  }

  if (job.operation === "health_check") {
    return {
      data: {
        ok: true,
        projectRoot: root,
        checkedAt: new Date().toISOString(),
      },
    };
  }

  throw new Error(`Operacao de job nao suportada: ${job.operation}`);
}

module.exports = {
  executeJob,
};
