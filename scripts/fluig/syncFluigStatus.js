/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchDetails, fetchRequest } = require("./api/workflowViewApi");

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

  if (requestIds.length === 0) {
    throw new Error("Uso: node src/syncFluigStatus.js <numeroFluig> [outrosNumeros] [--task-user-id=00130]");
  }

  return { taskUserId, requestIds };
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

function buildFieldsMap(formFields = []) {
  return Object.fromEntries(
    formFields.map((item) => [String(item.field || "").trim(), item.value == null ? "" : String(item.value)])
  );
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

async function main() {
  const { taskUserId, requestIds } = parseArgs();
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
        const paymentDueDate = await fetchPaymentDueDate(page, requestId);
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
