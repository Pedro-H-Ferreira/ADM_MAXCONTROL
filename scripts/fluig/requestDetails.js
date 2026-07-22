/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

function parseArg(flag, fallback = "") {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? String(arg.slice(prefix.length)).trim() : fallback;
}

function cleanText(value) {
  return String(value ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  if (Array.isArray(value)) return value;
  const record = objectValue(value);
  for (const key of ["items", "content", "data", "details", "history", "historical", "movements"]) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}

function normalizeFormFields(payload) {
  const candidates = [];
  const inspect = (value, depth = 0) => {
    if (depth > 5 || value == null) return;
    if (Array.isArray(value)) {
      for (const item of value) inspect(item, depth + 1);
      return;
    }
    if (typeof value !== "object") return;
    if (value.formFields != null) candidates.push(value.formFields);
    for (const nested of Object.values(value)) inspect(nested, depth + 1);
  };
  inspect(payload);
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return Object.fromEntries(
        candidate
          .map((field) => [cleanText(field?.name || field?.field || field?.key), cleanText(field?.value)])
          .filter(([name]) => Boolean(name))
      );
    }
    if (candidate && typeof candidate === "object") {
      return Object.fromEntries(
        Object.entries(candidate)
          .map(([name, value]) => [name, cleanText(value)])
          .filter(([, value]) => Boolean(value))
      );
    }
  }
  return {};
}

function normalizeAttachments(payload) {
  return arrayValue(payload)
    .map((item, index) => {
      const row = objectValue(item);
      const sequence = cleanText(
        row.attachmentSequence ?? row.sequence ?? row.attachSequence ?? row.id ?? row.documentId ?? index + 1
      );
      const name = cleanText(row.documentName || row.name || row.fileName || row.description || `Anexo ${index + 1}`);
      return {
        sequence,
        name,
        description: cleanText(row.description || row.documentDescription || name),
        mimeType: cleanText(row.mimeType || row.contentType || row.fileType) || null,
        size: Number(row.size || row.fileSize || row.sizeBytes || 0) || null,
        documentId: cleanText(row.documentId) || null,
        version: cleanText(row.version || row.documentVersion) || null,
        attachedBy: cleanText(row.attachedBy || row.userName || row.colleagueName) || null,
        attachedAt: cleanText(row.attachedAt || row.createDate || row.date) || null,
      };
    })
    .filter((item) => item.sequence && item.name);
}

function collectHistoryCandidates(value, output, depth = 0) {
  if (depth > 5 || output.length >= 1000 || value == null) return;
  if (Array.isArray(value)) {
    for (const item of value) collectHistoryCandidates(item, output, depth + 1);
    return;
  }
  if (typeof value !== "object") return;

  const row = value;
  const historyKeys = [
    "movementSequence", "movementDate", "movementTime", "activity", "stateDescription", "history",
    "observation", "activityDetail", "choosedActivity", "title", "choosedColleagueName", "workflowDetail",
  ];
  if (historyKeys.some((key) => row[key] != null && cleanText(row[key]))) output.push(row);
  for (const nested of Object.values(row)) collectHistoryCandidates(nested, output, depth + 1);
}

function normalizeHistory(payload) {
  const candidates = [];
  collectHistoryCandidates(payload, candidates);
  const seen = new Set();

  return candidates
    .map((row, index) => {
      const sequence = cleanText(row.movementSequence ?? row.sequence ?? index + 1);
      const state = objectValue(row.state);
      const targetState = objectValue(row.targetState);
      const userRecord = objectValue(row.user);
      const user = cleanText(
        userRecord.name || userRecord.login || row.choosedColleagueName || row.title || row.responsible || row.colleagueName || row.userName || row.login
      );
      const activity = cleanText(state.stateName || state.stateDescription || row.activity || row.stateDescription || row.activityLabel || row.task || row.stage);
      const destination = cleanText(targetState.stateName || targetState.stateDescription || row.choosedActivity || row.nextActivity || row.destination);
      const historyType = cleanText(row.type);
      const detail = cleanText(row.history || row.activityDetail || row.description || (historyType === "attachment" ? row.attachmentDescription : ""));
      const observation = cleanText(row.observationDescription || row.observation || row.comment || row.comments || row.conversionObservation);
      const date = cleanText(
        row.date || row.movementDatetime || row.movementDate || row.movementTime || row.createdAt || row.createDate || row.lastUpdate
      );
      const key = [sequence, user, activity, destination, detail, observation, date].join("|");
      if (seen.has(key)) return null;
      seen.add(key);
      return {
        sequence,
        user: user || "Fluig",
        activity: activity || null,
        destination: destination && destination !== activity ? destination : null,
        detail: detail || null,
        observation: observation || null,
        date: date || null,
        automatic: Boolean(row.hasIcon || row.workflowDetail || row.system || row.automatic || row.isDefaultLink),
      };
    })
    .filter((item) => item && (item.activity || item.detail || item.observation || item.date));
}

function sourceUrl(requestId, taskUserId, config) {
  const url = new URL("/portal/p/1/pageworkflowview", config.urls.base);
  url.searchParams.set("app_ecm_workflowview_detailsProcessInstanceID", requestId);
  if (taskUserId) url.searchParams.set("taskUserId", taskUserId);
  return url.toString();
}

async function main() {
  const config = require("./config");
  const { loginWithBrowser } = require("./api/session");
  const { fetchAttachments, fetchDetails, fetchHistories, fetchRequest } = require("./api/workflowViewApi");
  const requestId = parseArg("request-id");
  const taskUserId = parseArg("task-user-id", process.env.FLUIG_TASK_USER_ID || "");
  if (!/^\d+$/.test(requestId)) throw new Error("Informe --request-id numerico.");

  const session = await loginWithBrowser({ headless: true });
  try {
    const { page } = session;
    const [request, attachments, histories, details] = await Promise.all([
      fetchRequest(page, requestId),
      fetchAttachments(page, requestId).catch((error) => ({ items: [], error: error.message })),
      fetchHistories(page, requestId).catch((error) => ({ items: [], error: error.message })),
      fetchDetails(page, requestId, taskUserId).catch((error) => ({ content: [], error: error.message })),
    ]);
    const output = {
      requestId,
      taskUserId: taskUserId || null,
      sourceUrl: sourceUrl(requestId, taskUserId, config),
      fetchedAt: new Date().toISOString(),
      formFields: normalizeFormFields(request),
      attachments: normalizeAttachments(attachments),
      history: normalizeHistory(histories?.error ? details : histories),
      warnings: [attachments?.error, histories?.error, details?.error].filter(Boolean),
    };
    const outputPath = path.join(config.logsDir, `request-details-${requestId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`FLUIG_REQUEST_DETAILS_RESULT ${outputPath}`);
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("FLUIG_REQUEST_DETAILS_ERROR");
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = {
  __test: {
    normalizeAttachments,
    normalizeFormFields,
    normalizeHistory,
  },
};
