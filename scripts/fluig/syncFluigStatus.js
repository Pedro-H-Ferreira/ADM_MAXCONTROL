/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchAttachments, fetchDetails, fetchHistories, fetchRequest } = require("./api/workflowViewApi");
const { normalizeAttachments, normalizeFormFields, normalizeHistory } = require("./requestDetails").__test;

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs() {
  const taskUserIdArg = process.argv.find((arg) => arg.startsWith("--task-user-id="));
  const taskUserId = taskUserIdArg ? taskUserIdArg.replace("--task-user-id=", "") : process.env.FLUIG_TASK_USER_ID || "00130";
  const requestIds = process.argv
    .slice(2)
    .filter((arg) => !arg.startsWith("--"))
    .map((value) => value.trim())
    .filter(Boolean);
  const fieldsArg = process.argv.find((arg) => arg.startsWith("--detail-fields-json="));
  const hashArg = process.argv.find((arg) => arg.startsWith("--detail-config-hash="));
  let detailFields = [];
  try { detailFields = fieldsArg ? JSON.parse(fieldsArg.slice("--detail-fields-json=".length)) : []; } catch { detailFields = []; }
  const detailConfigHash = hashArg ? hashArg.slice("--detail-config-hash=".length) : "";

  if (requestIds.length === 0) {
    throw new Error("Uso: node src/syncFluigStatus.js <numeroFluig> [outrosNumeros] [--task-user-id=00130]");
  }

  return { taskUserId, requestIds, detailFields, detailConfigHash };
}

function emitProgress(payload) {
  console.log(`SYNC_FLUIG_STATUS_PROGRESS ${JSON.stringify({
    at: new Date().toISOString(),
    ...payload
  })}`);
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

function requestSourceUrl(requestId, taskUserId) {
  const url = new URL("/portal/p/1/pageworkflowview", config.urls.base);
  url.searchParams.set("app_ecm_workflowview_detailsProcessInstanceID", requestId);
  if (taskUserId) url.searchParams.set("taskUserId", taskUserId);
  return url.toString();
}

async function fetchDetailSnapshot(page, requestId, taskUserId, allowedFields) {
  const [request, attachments, histories] = await Promise.all([
    fetchRequest(page, requestId),
    fetchAttachments(page, requestId).catch((error) => ({ items: [], error: error.message })),
    fetchHistories(page, requestId).catch((error) => ({ items: [], error: error.message })),
  ]);
  const allFields = normalizeFormFields(request);
  const fieldSet = new Set(allowedFields);
  return {
    requestId: String(requestId),
    taskUserId: taskUserId || null,
    sourceUrl: requestSourceUrl(requestId, taskUserId),
    fetchedAt: new Date().toISOString(),
    formFields: Object.fromEntries(Object.entries(allFields).filter(([name]) => fieldSet.has(name))),
    attachments: normalizeAttachments(attachments),
    history: normalizeHistory(histories),
    warnings: [attachments.error, histories.error].filter(Boolean),
  };
}

async function main() {
  const { taskUserId, requestIds, detailFields, detailConfigHash } = parseArgs();
  emitProgress({
    stage: "login",
    label: "Abrindo sessao autenticada no Fluig",
    current: 0,
    total: requestIds.length
  });
  const session = await loginWithBrowser({ headless: true });

  try {
    const { page } = session;
    const items = [];

    emitProgress({
      stage: "consultando",
      label: `Sessao pronta. Consultando ${requestIds.length} solicitacao(oes) no Fluig`,
      current: 0,
      total: requestIds.length
    });

    for (const [index, requestId] of requestIds.entries()) {
      emitProgress({
        stage: "consultando_item",
        label: `Consultando Fluig ${requestId}`,
        current: index,
        total: requestIds.length,
        numeroFluig: String(requestId)
      });

      try {
        const details = await fetchDetails(page, requestId, taskUserId);
        const detailSnapshot = await fetchDetailSnapshot(page, requestId, taskUserId, detailFields);
        const paymentDueDate = {
          raw: detailSnapshot.formFields.vencPagNota || "",
          normalized: normalizeDateOnly(detailSnapshot.formFields.vencPagNota),
        };
        const content = details?.content || {};
        const currentState = Array.isArray(content.currentStates) ? content.currentStates[0] : null;
        const etapaAtual = String(content.stateDescription || currentState?.stateDescription || "");
        items.push({
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
          detailSnapshot,
          detailConfigHash,
        });

        emitProgress({
          stage: "item_consultado",
          label: `Fluig ${requestId} consultado: ${etapaAtual || "sem etapa retornada"}`,
          current: index + 1,
          total: requestIds.length,
          numeroFluig: String(requestId),
          status: etapaAtual || "sem etapa retornada"
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        items.push({
          numeroFluig: String(requestId),
          error: message,
          dataUltimaConsulta: new Date().toISOString(),
        });
        emitProgress({
          stage: "erro_item",
          label: `Erro ao consultar Fluig ${requestId}`,
          current: index + 1,
          total: requestIds.length,
          numeroFluig: String(requestId),
          status: message
        });
      }
    }

    const output = {
      processed: requestIds.length,
      taskUserId,
      items,
      processedAt: new Date().toISOString(),
    };

    const outputPath = path.join(config.logsDir, `sync-fluig-status-${nowStamp()}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log(`SYNC_FLUIG_STATUS_RESULT ${outputPath}`);
    console.log(JSON.stringify({ processed: output.processed, items: output.items.length }, null, 2));
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error("SYNC_FLUIG_STATUS_ERROR");
  console.error(error.message);
  process.exitCode = 1;
});
