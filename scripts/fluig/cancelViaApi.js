/* eslint-disable @typescript-eslint/no-require-imports */
const path = require("path");
const fs = require("fs");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchRequest, cancelRequest, fetchDetails } = require("./api/workflowViewApi");

function nowStamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function parseArgs() {
  const requestIds = process.argv.slice(2).filter((value) => value && !value.startsWith("--"));
  const commentArg = process.argv.find((arg) => arg.startsWith("--comment="));

  if (requestIds.length === 0) {
    throw new Error("Uso: node src/cancelViaApi.js <numeroFluig> [outroNumero] [--comment=texto]");
  }

  return {
    requestIds,
    cancelComment:
      commentArg?.replace("--comment=", "") || "Cancelamento executado via ADM Frete."
  };
}

async function main() {
  const { requestIds, cancelComment } = parseArgs();
  const session = await loginWithBrowser({ headless: true });

  try {
    const { page } = session;
    const items = [];

    for (const requestId of requestIds) {
      const request = await fetchRequest(page, requestId);
      const requestFields = Object.fromEntries((request.formFields || []).map((item) => [item.field, item.value]));
      const taskUserId = requestFields.matResponsavelEnvio || "00130";
      const cancelResponse = await cancelRequest(page, requestId, taskUserId, cancelComment);
      const details = await fetchDetails(page, requestId, taskUserId).catch(() => null);

      items.push({
        requestId: String(requestId),
        taskUserId,
        cancelResponse,
        details
      });
    }

    const output = {
      requestIds,
      cancelComment,
      items,
      processedAt: new Date().toISOString()
    };

    const outputPath = path.join(config.logsDir, `cancel-via-api-${nowStamp()}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");

    console.log(`CANCEL_VIA_API_RESULT ${outputPath}`);
    for (const item of items) {
      console.log(`CANCELLED_REQUEST ${item.requestId}`);
    }
  } finally {
    await session.close();
  }
}

main().catch((error) => {
  console.error("CANCEL_VIA_API_ERROR");
  console.error(error.message);
  process.exit(1);
});
