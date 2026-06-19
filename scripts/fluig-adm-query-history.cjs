/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

function parseArg(flag, fallback = "") {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? String(arg.slice(prefix.length)).trim() : fallback;
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

function normalizeText(value) {
  return String(value || "").trim();
}

function formatWindowDate(value, fallback) {
  const raw = normalizeText(value);
  if (!raw) return fallback;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00-0300`;
  return raw;
}

function parseWindowsJsonArg() {
  const raw = parseArg("windows-json");
  if (!raw) return null;

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`--windows-json invalido: ${error && error.message ? error.message : String(error)}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error("--windows-json deve ser uma lista de janelas.");
  }

  const windows = parsed
    .map((window) => ({
      initialStartDate: formatWindowDate(window && window.start, ""),
      finalStartDate: formatWindowDate(window && window.end, ""),
    }))
    .filter((window) => window.initialStartDate && window.finalStartDate);

  if (windows.length === 0) {
    throw new Error("--windows-json nao possui janelas validas.");
  }

  return windows;
}

function buildQueryWindows(days) {
  const windows = parseWindowsJsonArg();
  if (windows) return windows;

  const start = new Date();
  start.setDate(start.getDate() - (Number.isFinite(days) && days > 0 ? days : 90));

  return [
    {
      initialStartDate: formatWindowDate(parseArg("start"), start.toISOString().slice(0, 10)),
      finalStartDate: formatWindowDate(parseArg("end"), new Date().toISOString().replace("Z", "-0300")),
    },
  ];
}

function buildFieldsMap(formFields = []) {
  return Object.fromEntries(
    formFields.map((item) => [String(item.field || item.name || "").trim(), item.value == null ? "" : String(item.value)])
  );
}

function emitProgress(payload) {
  console.log(`ADM_FLUIG_HISTORY_PROGRESS ${JSON.stringify({ at: new Date().toISOString(), ...payload })}`);
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

async function main() {
  const runnerRoot = requireRunnerRoot();
  process.chdir(runnerRoot);

  const config = require(path.join(runnerRoot, "scripts", "fluig", "config.js"));
  const { loginWithBrowser } = require(path.join(runnerRoot, "scripts", "fluig", "api", "session.js"));

  const processId = parseArg("process-id");
  if (!processId) {
    throw new Error("Informe --process-id.");
  }

  const processVersions = parseArg("process-version")
    .split(/[,;\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (processVersions.length === 0) {
    throw new Error("Informe --process-version com uma ou mais versoes.");
  }

  const pageSize = Number(parseArg("page-size", "100"));
  const maxPages = Number(parseArg("max-pages", "5"));
  const timeoutMs = Number(parseArg("timeout-ms", "30000"));
  const days = Number(parseArg("days", "90"));
  const windows = buildQueryWindows(days);
  const initialStartDate = windows[0].initialStartDate;
  const finalStartDate = windows[windows.length - 1].finalStartDate;

  emitProgress({
    stage: "login",
    label: `Login no Fluig para ${windows.length} janela${windows.length === 1 ? "" : "s"}.`,
    processId,
    processVersions,
    windowCount: windows.length,
  });
  const session = await loginWithBrowser({ headless: true });
  const items = [];
  const inspected = [];

  try {
    for (const [windowIndex, queryWindow] of windows.entries()) {
      const windowPosition = windowIndex + 1;
      emitProgress({
        stage: "window",
        windowIndex: windowPosition,
        windowCount: windows.length,
        initialStartDate: queryWindow.initialStartDate,
        finalStartDate: queryWindow.finalStartDate,
        label: `Consultando janela ${windowPosition}/${windows.length}.`,
      });

      for (const processVersion of processVersions) {
        for (let pageNumber = 1; pageNumber <= maxPages; pageNumber += 1) {
          const params = new URLSearchParams();
          params.append("initialStartDate", queryWindow.initialStartDate);
          params.append("finalStartDate", queryWindow.finalStartDate);
          params.append("page", String(pageNumber));
          params.append("pageSize", String(pageSize));
          params.append("order", "-processInstanceId");
          params.append("expand", "formFields");

          const endpoint = `/process-management/api/v2/processes/${encodeURIComponent(processId)}/process-versions/${encodeURIComponent(
            processVersion
          )}/requests?${params.toString()}`;
          emitProgress({
            stage: "request",
            processVersion,
            page: pageNumber,
            windowIndex: windowPosition,
            windowCount: windows.length,
            initialStartDate: queryWindow.initialStartDate,
            finalStartDate: queryWindow.finalStartDate,
            label: `Lendo pagina ${pageNumber} da janela ${windowPosition}/${windows.length}.`,
          });
          const response = assertResponse(await fetchJson(session.page, endpoint, timeoutMs), endpoint);
          const requests = Array.isArray(response.items) ? response.items : [];
          inspected.push({
            processVersion,
            page: pageNumber,
            count: requests.length,
            hasNext: Boolean(response.hasNext),
            windowIndex: windowPosition,
            windowCount: windows.length,
            initialStartDate: queryWindow.initialStartDate,
            finalStartDate: queryWindow.finalStartDate,
          });

          for (const request of requests) {
            const formFields = Array.isArray(request.formFields) ? request.formFields : [];
            items.push({
              processInstanceId: String(request.processInstanceId || ""),
              processId: String(request.processId || processId),
              processVersion: String(request.processVersion || processVersion),
              status: String(request.status || ""),
              startDate: request.startDate || null,
              requesterId: request.requesterId || request.requesterCode || null,
              requesterName: request.requesterName || request.requester || null,
              formFields: buildFieldsMap(formFields),
              raw: request,
              sourceUrl: `${config.urls.base.replace(/\/$/, "")}/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=${
                request.processInstanceId || ""
              }`,
            });
          }

          if (!response.hasNext || requests.length === 0) break;
        }
      }
    }
  } finally {
    await session.close();
  }

  const output = {
    generatedAt: new Date().toISOString(),
    query: { processId, processVersions, initialStartDate, finalStartDate, windows, pageSize, maxPages },
    inspected,
    totalItems: items.length,
    items,
  };
  const outputPath = path.join(config.logsDir, `adm-fluig-history-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
  console.log(`ADM_FLUIG_HISTORY_RESULT ${outputPath}`);
  console.log(`ADM_FLUIG_HISTORY_ITEMS ${items.length}`);
}

main().catch((error) => {
  console.error("ADM_FLUIG_HISTORY_ERROR");
  console.error(error && error.message ? error.message : String(error));
  process.exitCode = 1;
});
