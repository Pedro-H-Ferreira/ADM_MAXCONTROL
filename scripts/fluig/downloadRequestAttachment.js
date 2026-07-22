/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require("node:fs");
const path = require("node:path");

function parseArg(flag, fallback = "") {
  const prefix = `--${flag}=`;
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? String(arg.slice(prefix.length)).trim() : fallback;
}

function safeFileName(value) {
  return path.basename(String(value || "anexo")).replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim() || "anexo";
}

function attachmentItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.content)) return payload.content;
  return [];
}

function attachmentSequence(item, index) {
  return String(item?.attachmentSequence ?? item?.sequence ?? item?.attachSequence ?? item?.id ?? item?.documentId ?? index + 1);
}

async function main() {
  const config = require("./config");
  const { loginWithBrowser } = require("./api/session");
  const { downloadAttachment, fetchAttachments, fetchRequest } = require("./api/workflowViewApi");
  const requestId = parseArg("request-id");
  const sequence = parseArg("sequence");
  if (!/^\d+$/.test(requestId)) throw new Error("Informe --request-id numerico.");
  if (!/^\d+$/.test(sequence)) throw new Error("Informe --sequence numerica.");

  const session = await loginWithBrowser({ headless: true });
  try {
    const { page } = session;
    await fetchRequest(page, requestId);
    const attachments = await fetchAttachments(page, requestId);
    const item = attachmentItems(attachments).find((candidate, index) => attachmentSequence(candidate, index) === sequence);
    if (!item) throw new Error(`Anexo ${sequence} nao encontrado na solicitacao Fluig ${requestId}.`);

    const name = safeFileName(item.documentName || item.name || item.fileName || item.description || `anexo-${sequence}`);
    const filePath = path.join(config.logsDir, `download-${requestId}-${sequence}-${Date.now()}-${name}`);
    const download = await downloadAttachment(page, requestId, sequence, filePath, 120000);
    const output = {
      requestId,
      sequence,
      name,
      mimeType: download.contentType || item.mimeType || item.contentType || "application/octet-stream",
      size: fs.statSync(filePath).size,
      filePath,
      downloadedAt: new Date().toISOString(),
    };
    const outputPath = path.join(config.logsDir, `download-${requestId}-${sequence}-${Date.now()}.json`);
    await fs.promises.writeFile(outputPath, JSON.stringify(output, null, 2), "utf8");
    console.log(`FLUIG_REQUEST_ATTACHMENT_RESULT ${outputPath}`);
  } finally {
    await session.close();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error("FLUIG_REQUEST_ATTACHMENT_ERROR");
    console.error(error && error.message ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { __test: { attachmentItems, attachmentSequence, safeFileName } };
