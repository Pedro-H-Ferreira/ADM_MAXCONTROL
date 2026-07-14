const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { __test } = require("../src/runner");
const agentRuntime = require("../src/index").__test;

test("pollDelayMs keeps normal cadence and backs off transient failures", () => {
  assert.equal(agentRuntime.pollDelayMs(8000, 0, () => 0.5), 8000);
  assert.equal(agentRuntime.pollDelayMs(8000, 1, () => 0), 8000);
  assert.equal(agentRuntime.pollDelayMs(8000, 2, () => 0), 16000);
  assert.equal(agentRuntime.pollDelayMs(8000, 5, () => 0), 60000);
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
