/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

function parseArg(flag, fallback = "") {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? String(arg.slice(prefix.length)).trim() : fallback;
}

function parseBooleanFlag(flag) {
  return process.argv.includes(`--${flag}`);
}

function requireRunnerRoot() {
  const runnerRoot = parseArg("runner-root", path.resolve(__dirname, ".."));
  if (!runnerRoot) {
    throw new Error("Informe --runner-root ou execute pelo projeto ADM_MAXCONTROL.");
  }

  const resolved = path.resolve(runnerRoot);
  if (!fs.existsSync(path.join(resolved, "scripts", "fluig", "api", "session.js"))) {
    throw new Error(`Runner Fluig invalido: ${resolved}`);
  }

  return resolved;
}

function parseFieldOverrides() {
  return process.argv
    .filter((arg) => arg.startsWith("--set="))
    .map((arg) => arg.replace("--set=", ""))
    .map((pair) => {
      const index = pair.indexOf("=");
      return index === -1
        ? { field: pair.trim(), value: "" }
        : { field: pair.slice(0, index).trim(), value: pair.slice(index + 1) };
    })
    .filter((item) => item.field);
}

function parseAttachmentOverrides() {
  const names = process.argv
    .filter((arg) => arg.startsWith("--attachment-name="))
    .map((arg) => arg.replace("--attachment-name=", ""));
  return process.argv
    .filter((arg) => arg.startsWith("--attachment-path="))
    .map((arg) => arg.replace("--attachment-path=", ""))
    .map((attachmentPath, index) => ({
      path: attachmentPath,
      name: names[index] || path.basename(attachmentPath) || "arquivo.pdf",
    }))
    .filter((item) => item.path);
}

function normalizeStateSequence(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function buildFormData(formFields) {
  return Object.entries(formFields).map(([name, value]) => ({
    name,
    value: value == null ? "" : String(value),
  }));
}

function buildNewAttachment(fileName, taskUserId) {
  return {
    id: 1,
    fullPath: "BPM",
    droppedZipZone: false,
    name: fileName,
    newAttach: true,
    description: fileName,
    documentId: 0,
    attachedUser: "ADM MaxControl",
    attachedActivity: "Abertura via ADM MaxControl",
    attachments: [
      {
        attach: false,
        principal: true,
        fileName,
      },
    ],
    hasOwnSubMenu: true,
    enablePublish: false,
    enableEdit: false,
    enableEditContent: false,
    enableDownload: false,
    hasMoreOptions: false,
    classSubMenu: "fs-display-flex fs-justify-content-flex-end",
    iconClass: "fluigicon-file-upload",
    iconUrl: false,
    colleagueId: taskUserId,
  };
}

function resolveSelectedState(sourceDetails, targetStateOverride) {
  const candidates = [
    normalizeStateSequence(targetStateOverride),
    normalizeStateSequence(process.env.FLUIG_ADM_TARGET_STATE),
    normalizeStateSequence(process.env.FLUIG_SEND_TARGET_STATE),
    normalizeStateSequence(process.env.FLUIG_TARGET_STATE),
    normalizeStateSequence(sourceDetails && sourceDetails.content && sourceDetails.content.stateSequence),
    4,
  ].filter(Boolean);

  return candidates[0] || 4;
}

function resolveSelectedColleagues(sourceDetails, selectedState, fallbackUserId) {
  const colleagues = [];
  const seen = new Set();
  const push = (value) => {
    const normalized = String(value || "").trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      colleagues.push(normalized);
    }
  };

  const currentStates = Array.isArray(sourceDetails && sourceDetails.content && sourceDetails.content.currentStates)
    ? sourceDetails.content.currentStates
    : [];

  for (const state of currentStates) {
    const stateSequence = normalizeStateSequence(state && state.stateSequence);
    if (stateSequence && selectedState && stateSequence !== selectedState) continue;
    push(state && state.colleagueId);
  }

  push(fallbackUserId);
  return colleagues;
}

async function main() {
  const runnerRoot = requireRunnerRoot();
  process.chdir(runnerRoot);

  const config = require(path.join(runnerRoot, "scripts", "fluig", "config.js"));
  const { loginWithBrowser } = require(path.join(runnerRoot, "scripts", "fluig", "api", "session.js"));
  const {
    fetchRequest,
    fetchDetails,
    uploadFile,
    sendNewRequest,
    cancelRequest,
  } = require(path.join(runnerRoot, "scripts", "fluig", "api", "workflowViewApi.js"));

  const sourceRequestId = parseArg("source-request-id");
  if (!sourceRequestId) {
    throw new Error("Informe --source-request-id.");
  }

  const targetStateOverride = parseArg("target-state");
  const taskUserIdOverride = parseArg("task-user-id", process.env.FLUIG_TASK_USER_ID || "00130");
  const comment = parseArg("comment", "Abertura executada via ADM MaxControl.");
  const cancelAfter = parseBooleanFlag("cancel-after");
  const keepOpen = parseBooleanFlag("keep-open");
  const fieldOverrides = parseFieldOverrides();
  const attachmentOverrides = parseAttachmentOverrides();
  const session = await loginWithBrowser({ headless: true });

  try {
    const { page } = session;
    const source = await fetchRequest(page, sourceRequestId);
    const sourceFields = Object.fromEntries((source.formFields || []).map((item) => [item.field, item.value]));
    const taskUserId = sourceFields.matResponsavelEnvio || sourceFields.responsavelEnvio || taskUserIdOverride;
    const sourceDetails = await fetchDetails(page, sourceRequestId, taskUserId).catch(() => null);

    for (const override of fieldOverrides) {
      sourceFields[override.field] = override.value;
    }

    sourceFields.numeroSolicitacao = "";

    const uploadedFileNames = [];
    for (const attachment of attachmentOverrides) {
      const uploadInfo = await uploadFile(page, attachment.path, attachment.name);
      uploadedFileNames.push(uploadInfo.files && uploadInfo.files[0] ? uploadInfo.files[0].name : attachment.name);
    }

    const selectedState = resolveSelectedState(sourceDetails, targetStateOverride);
    const selectedColleague = resolveSelectedColleagues(sourceDetails, selectedState, taskUserId);
    const payload = {
      processInstanceId: 0,
      processId: source.processId,
      version: source.processVersion,
      taskUserId,
      completeTask: true,
      currentMovto: 0,
      managerMode: false,
      selectedDestinyAfterAutomatic: -1,
      conditionAfterAutomatic: -1,
      selectedColleague,
      comments: comment,
      newObservations: [],
      appointments: [],
      attachments: uploadedFileNames.map((fileName) => buildNewAttachment(fileName, taskUserId)),
      digitalSignature: false,
      formData: buildFormData(sourceFields),
      isDigitalSigned: false,
      versionDoc: 0,
      selectedState,
      internalFields: [],
      transferTaskAfterSelection: false,
      currentState: 4,
    };

    const sendResponse = await sendNewRequest(page, payload);
    const generatedRequestId = String(
      (sendResponse && sendResponse.content && sendResponse.content.processInstanceId) ||
        sendResponse.processInstanceId ||
        ""
    );

    let finalDetails = null;
    let cancelResponse = null;

    if (generatedRequestId) {
      finalDetails = await fetchDetails(page, generatedRequestId, taskUserId).catch(() => null);
    }

    if (generatedRequestId && cancelAfter) {
      cancelResponse = await cancelRequest(page, generatedRequestId, taskUserId, "Cancelamento apos teste via ADM MaxControl.");
    }

    if (generatedRequestId && keepOpen) {
      await page.goto(`${config.urls.base}/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=${generatedRequestId}`, {
        waitUntil: "domcontentloaded",
      });
      console.log(`ADM_FLUIG_OPEN_URL ${page.url()}`);
    }

    const output = {
      sourceRequestId,
      generatedRequestId,
      processId: source.processId,
      processVersion: source.processVersion,
      taskUserId,
      selectedState,
      selectedColleague,
      cancelAfter,
      fieldOverrideCount: fieldOverrides.length,
      attachmentCount: uploadedFileNames.length,
      sendResponse,
      cancelResponse,
      finalDetails,
      processedAt: new Date().toISOString(),
    };
    const outputPath = path.join(config.logsDir, `adm-fluig-open-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log(`ADM_FLUIG_OPEN_RESULT ${outputPath}`);
    console.log(`ADM_FLUIG_OPEN_REQUEST ${generatedRequestId || "NONE"}`);

    if (!generatedRequestId) {
      throw new Error("Fluig nao retornou numero da solicitacao.");
    }
  } finally {
    if (!keepOpen) {
      await session.close();
    }
  }
}

main().catch((error) => {
  console.error("ADM_FLUIG_OPEN_ERROR");
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
