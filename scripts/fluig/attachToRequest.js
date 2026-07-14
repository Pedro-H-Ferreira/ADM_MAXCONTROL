/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");
const config = require("./config");
const { loginWithBrowser } = require("./api/session");
const { fetchAttachments, fetchRequest } = require("./api/workflowViewApi");

function parseArg(flag, fallback = "") {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? String(arg.slice(prefix.length)).trim() : fallback;
}

function parseAttachments() {
  const names = process.argv.filter((arg) => arg.startsWith("--attachment-name=")).map((arg) => arg.slice(18));
  return process.argv
    .filter((arg) => arg.startsWith("--attachment-path="))
    .map((arg) => arg.slice(18))
    .map((filePath, index) => ({ path: filePath, name: names[index] || path.basename(filePath) }))
    .filter((item) => item.path);
}

function normalizedName(value) {
  return String(value || "").trim().toLocaleLowerCase("pt-BR");
}

function attachmentNames(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : Array.isArray(payload) ? payload : [];
  return items.map((item) => normalizedName(item.documentName || item.name || item.fileName)).filter(Boolean);
}

function emitProgress(stage, label, payload = {}) {
  console.log(`ADM_FLUIG_ATTACH_PROGRESS ${JSON.stringify({ stage, label, ...payload })}`);
}

async function waitForConfirmedAttachments(page, requestId, expectedNames, beforeNames, timeoutMs = 90000) {
  const startedAt = Date.now();
  let lastNames = beforeNames;
  while (Date.now() - startedAt < timeoutMs) {
    const response = await fetchAttachments(page, requestId).catch(() => null);
    if (response) {
      lastNames = attachmentNames(response);
      const confirmed = expectedNames.filter((name) => lastNames.includes(normalizedName(name)));
      if (confirmed.length === expectedNames.length) return { response, confirmed, names: lastNames };
    }
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  throw new Error(
    `O upload terminou, mas o Fluig nao confirmou os anexos na solicitacao ${requestId}. ` +
      `Esperados: ${expectedNames.join(", ")}. Encontrados: ${lastNames.join(", ") || "nenhum"}.`
  );
}

async function revealFileInput(page) {
  const direct = page.locator("#ecm-navigation-inputFile-clone, input[name='files[]'], input[type='file']");
  if ((await direct.count()) > 0) return direct.first();

  for (const label of ["Anexos", "Adicionar", "Upload de arquivo", "Anexar"]) {
    const actions = page.getByText(label, { exact: false });
    const count = await actions.count();
    for (let index = 0; index < Math.min(count, 8); index += 1) {
      const action = actions.nth(index);
      if (!(await action.isVisible().catch(() => false))) continue;
      await action.click().catch(() => {});
      await page.waitForTimeout(500);
      if ((await direct.count()) > 0) return direct.first();
    }
  }

  throw new Error("Campo real de upload do Fluig nao encontrado na solicitacao aberta.");
}

async function main() {
  const requestId = parseArg("request-id");
  const taskUserId = parseArg("task-user-id", process.env.FLUIG_TASK_USER_ID || "00130");
  const attachments = parseAttachments();
  if (!/^\d+$/.test(requestId)) throw new Error("Informe --request-id numerico.");
  if (!attachments.length) throw new Error("Informe ao menos um --attachment-path.");
  for (const attachment of attachments) {
    if (!fs.existsSync(attachment.path)) throw new Error(`ADF nao encontrada no agente: ${attachment.path}`);
  }

  emitProgress("authenticating", "Autenticando no Fluig para anexar a ADF.");
  const session = await loginWithBrowser({ headless: true });
  try {
    const { page } = session;
    await fetchRequest(page, requestId);
    const beforePayload = await fetchAttachments(page, requestId).catch(() => ({ items: [] }));
    const beforeNames = attachmentNames(beforePayload);
    const expectedNames = attachments.map((item) => item.name);

    emitProgress("opening_fluig", `Abrindo a solicitacao Fluig ${requestId}.`, { requestId });
    await page.goto(
      `${config.urls.base}/portal/p/1/pageworkflowview?app_ecm_workflowview_detailsProcessInstanceID=${requestId}&taskUserId=${encodeURIComponent(taskUserId)}`,
      { waitUntil: "domcontentloaded", timeout: 60000 }
    );
    await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});

    emitProgress("filling_form", "Selecionando o PDF assinado no campo real de anexos do Fluig.");
    const fileInput = await revealFileInput(page);
    const uploadResponse = page
      .waitForResponse((response) => response.url().includes("/ecm/upload") && response.status() < 400, { timeout: 60000 })
      .catch(() => null);
    await fileInput.setInputFiles(attachments.map((item) => item.path));
    await uploadResponse;

    emitProgress("waiting_protocol", "Confirmando os anexos na propria solicitacao Fluig.", { requestId });
    const confirmation = await waitForConfirmedAttachments(page, requestId, expectedNames, beforeNames);
    const output = {
      requestId,
      taskUserId,
      attachedFileNames: expectedNames,
      attachmentCountBefore: beforeNames.length,
      attachmentCountAfter: confirmation.names.length,
      confirmed: confirmation.confirmed,
      processedAt: new Date().toISOString(),
    };
    const outputPath = path.join(config.logsDir, `attach-to-request-${requestId}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`ADM_FLUIG_ATTACH_RESULT ${outputPath}`);
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("ADM_FLUIG_ATTACH_ERROR");
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { __test: { attachmentNames, normalizedName, waitForConfirmedAttachments } };
