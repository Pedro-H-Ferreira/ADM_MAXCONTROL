const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { __test } = require("../src/runner");
const agentRuntime = require("../src/index").__test;
const attachmentRuntime = require("../../../scripts/fluig/attachToRequest").__test;

test("pollDelayMs keeps normal cadence and backs off transient failures", () => {
  assert.equal(agentRuntime.pollDelayMs(8000, 0, () => 0.5), 8000);
  assert.equal(agentRuntime.pollDelayMs(8000, 1, () => 0), 8000);
  assert.equal(agentRuntime.pollDelayMs(8000, 2, () => 0), 16000);
  assert.equal(agentRuntime.pollDelayMs(8000, 5, () => 0), 60000);
});

test("chunk compaction preserves Fluig task central identity, totals, and memberships", () => {
  const metadata = {
    directTaskCentral: true,
    currentFluigUser: { id: "132", code: "00130", email: "administrativo@dvaatacados.com.br" },
    centralTaskTotals: { openTasks: 45, myRequests: 600 },
    membership: {
      global: { openTasks: 45, myRequests: 600 },
      modules: [{ module: "pagamentos", openTasks: 32, myRequests: 567 }],
    },
    syncStartedAt: "2026-07-14T15:00:00.000Z",
    items: [{ numeroFluig: "1160447" }],
  };
  const result = { outputPath: "result.json", data: metadata };

  for (const compacted of [
    agentRuntime.compactHistoryResult(result, { itemCount: 1, chunkCount: 1 }),
    agentRuntime.compactResultPayload(result),
    agentRuntime.minimalResultPayload(result, "test"),
  ]) {
    assert.equal(compacted.data.directTaskCentral, true);
    assert.equal(compacted.data.currentFluigUser.code, "00130");
    assert.deepEqual(compacted.data.centralTaskTotals, { openTasks: 45, myRequests: 600 });
    assert.deepEqual(compacted.data.membership.global, { openTasks: 45, myRequests: 600 });
    assert.equal(compacted.data.syncStartedAt, "2026-07-14T15:00:00.000Z");
  }

  const compactedItem = agentRuntime.minimalChunkItem({
    numeroFluig: "1160447",
    moduleSlug: "pagamentos",
    syncFluigUserId: "00130",
    syncTypes: ["open_tasks", "my_requests"],
    responsavelAtual: "Administrativo CD",
  });
  assert.equal(compactedItem.syncFluigUserId, "00130");
  assert.deepEqual(compactedItem.syncTypes, ["open_tasks", "my_requests"]);
  assert.equal(compactedItem.responsavelAtual, "Administrativo CD");
});

test("decodeAttachmentBase64 accepts canonical base64 and validates decoded size", () => {
  const input = Buffer.from("arquivo seguro");
  assert.deepEqual(__test.decodeAttachmentBase64(input.toString("base64"), input.length), input);
  assert.throws(
    () => __test.decodeAttachmentBase64(input.toString("base64"), input.length - 1),
    /(excede o limite|acima de)/
  );
  assert.throws(() => __test.decodeAttachmentBase64("AAAA===", 100), /dataBase64 invalido/);
  assert.throws(() => __test.decodeAttachmentBase64(" QUJD ", 100), /dataBase64 invalido/);
});

test("attachment confirmation normalizes the Fluig response names", () => {
  assert.deepEqual(
    attachmentRuntime.attachmentNames({
      items: [
        { documentName: "ADF-2026-000001 Assinada.PDF" },
        { fileName: "cotacao.pdf" },
      ],
    }),
    ["adf-2026-000001 assinada.pdf", "cotacao.pdf"]
  );
  assert.equal(attachmentRuntime.normalizedName("  ADF.PDF "), "adf.pdf");
});

test("writePayloadAttachments rejects job-provided paths and removes its temporary directory", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adm-fluig-agent-test-"));
  const root = path.join(projectRoot, ".adm-fluig-agent", "attachments");

  try {
    assert.throws(
      () => __test.writePayloadAttachments(
        { projectRoot },
        { id: "../../outside" },
        [{ name: "documento.pdf", path: "C:\\segredo.txt" }]
      ),
      /attachments\[\]\.path nao e aceito/
    );
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("writePayloadAttachments writes decoded bytes only inside an isolated job directory", () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adm-fluig-agent-test-"));
  const content = Buffer.from("conteudo do anexo");
  let result;

  try {
    result = __test.writePayloadAttachments(
      { projectRoot },
      { id: "job/with/path" },
      [{ name: "../nota.pdf", dataBase64: content.toString("base64") }]
    );
    assert.equal(result.items.length, 1);
    assert.deepEqual(fs.readFileSync(result.items[0].path), content);
    assert.equal(path.dirname(result.items[0].path), result.root);
    assert.ok(path.resolve(result.root).startsWith(path.resolve(projectRoot)));
  } finally {
    if (result?.root) fs.rmSync(result.root, { recursive: true, force: true });
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});

test("runNodeScript terminates a timed-out subprocess without retrying it", async () => {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adm-fluig-timeout-test-"));
  const scriptPath = path.join(projectRoot, "hang.js");
  const countPath = path.join(projectRoot, "runs.txt");
  const previousUsername = process.env.FLUIG_USERNAME;
  const previousPassword = process.env.FLUIG_PASSWORD;
  fs.writeFileSync(
    scriptPath,
    `const fs = require("node:fs");\nfs.appendFileSync(${JSON.stringify(countPath)}, "run\\n");\nsetInterval(() => {}, 1000);\n`,
    "utf8"
  );
  process.env.FLUIG_USERNAME = "test-user";
  process.env.FLUIG_PASSWORD = "test-password";

  const config = {
    projectRoot,
    configDir: projectRoot,
    fluig: {
      baseUrl: "https://fluig.example.test",
      loginPath: "/login",
      lancamentoPath: "/form",
      processUrl: "",
      taskUserId: "1",
      headless: "true",
      slowMo: "0",
      selectors: {
        loginUser: "#user",
        loginPassword: "#password",
        loginSubmit: "#submit",
        postLoginReady: "body",
        lancamentoFormReady: "body",
        lancamentoSubmit: "button",
      },
    },
  };

  try {
    await assert.rejects(
      __test.runNodeScript(config, scriptPath, [], { timeoutMs: 250 }),
      /excedeu o timeout/
    );
    assert.equal(fs.readFileSync(countPath, "utf8"), "run\n");
  } finally {
    if (previousUsername === undefined) delete process.env.FLUIG_USERNAME;
    else process.env.FLUIG_USERNAME = previousUsername;
    if (previousPassword === undefined) delete process.env.FLUIG_PASSWORD;
    else process.env.FLUIG_PASSWORD = previousPassword;
    fs.rmSync(projectRoot, { recursive: true, force: true });
  }
});
