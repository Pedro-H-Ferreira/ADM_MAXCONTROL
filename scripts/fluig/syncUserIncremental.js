/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchUserTaskCentral } = require("./api/userTaskApi");

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
    const output = {
      processed: central.items.length,
      taskUserId: central.currentFluigUser.code,
      batchCount: batches.length,
      batched: true,
      directTaskCentral: true,
      ...central,
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
