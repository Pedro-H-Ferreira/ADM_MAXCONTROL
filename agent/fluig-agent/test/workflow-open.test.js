const assert = require("node:assert/strict");
const test = require("node:test");

const workflowApi = require("../../../scripts/fluig/api/workflowViewApi").__test;
const workflowOpen = require("../../../scripts/fluig-adm-open-from-source.cjs").__test;

test("parseHttpJson rejects non-success HTTP and malformed JSON", () => {
  assert.throws(
    () => workflowApi.parseHttpJson({ status: 500, text: "falha interna" }, "Envio"),
    /HTTP 500: falha interna/
  );
  assert.throws(
    () => workflowApi.parseHttpJson({ status: 200, text: "not-json" }, "Envio"),
    /JSON invalido/
  );
  assert.deepEqual(
    workflowApi.parseHttpJson({ status: 201, text: '{"processInstanceId":123}' }, "Envio"),
    { processInstanceId: 123 }
  );
});

test("confirmGeneratedRequest requires a matching protocol from requery", async () => {
  let calls = 0;
  const confirmed = await workflowOpen.confirmGeneratedRequest(
    async () => {
      calls += 1;
      return calls === 1 ? { processInstanceId: 999 } : { processInstanceId: 123 };
    },
    {},
    "123",
    { attempts: 2, delayMs: 1 }
  );

  assert.equal(calls, 2);
  assert.equal(confirmed.processInstanceId, 123);
  await assert.rejects(
    workflowOpen.confirmGeneratedRequest(async () => ({ processInstanceId: 999 }), {}, "123", {
      attempts: 1,
      delayMs: 1,
    }),
    /nao confirmou o protocolo 123/
  );
});
