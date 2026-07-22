import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { __test } = require("../../scripts/fluig/api/userTaskApi.js") as {
  __test: {
    currentUserIdentity: (payload: unknown) => Record<string, unknown> | null;
    datasetRows: (payload: unknown) => Array<Record<string, unknown>>;
    mapCentralTaskItem: (item: Record<string, unknown>, input: Record<string, unknown>) => Record<string, unknown> | null;
    membershipSummary: (
      items: Array<Record<string, unknown>>,
      totals: { openTasks: number; myRequests: number }
    ) => Record<string, unknown>;
    mergeCentralItems: (items: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
    normalizeKey: (value: unknown) => string;
    totalsFromSummary: (payload: unknown) => { openTasks: number; myRequests: number };
  };
};

describe("Fluig Central de Tarefas API", () => {
  it("usa o codigo do colaborador e nao o id numerico interno", () => {
    expect(
      __test.currentUserIdentity({
        content: {
          id: 132,
          code: "00130",
          login: "administrativo.dvaatacados.com.br.1",
          email: "administrativo@dvaatacados.com.br",
          fullName: "Administrativo CD",
        },
      })
    ).toMatchObject({ id: "132", code: "00130" });
  });

  it("le os totais oficiais exibidos pela Central de Tarefas", () => {
    expect(
      __test.totalsFromSummary({
        content: [
          { type: "open", totalTask: 45 },
          { type: "requests", totalTask: 600 },
        ],
      })
    ).toEqual({ openTasks: 45, myRequests: 600 });
  });

  it("le o retorno do dataset de colaboradores usado para resolver os usuarios monitorados", () => {
    expect(
      __test.datasetRows({
        content: {
          values: [{ "colleaguePK.colleagueId": "00189", mail: "administrativo.agc@atacadaodiaadia.com.br" }],
        },
      })
    ).toEqual([{ "colleaguePK.colleagueId": "00189", mail: "administrativo.agc@atacadaodiaadia.com.br" }]);
  });

  it("classifica, une e contabiliza a mesma solicitacao sem duplicar", () => {
    const processModules = new Map([
      [__test.normalizeKey("Atendimento Central de Lancamento - CONSINCO"), "pagamentos"],
    ]);
    const commonInput = {
      processModules,
      knownRequestModules: new Map(),
      fluigUser: { code: "00130" },
      syncStartedAt: "2026-07-14T15:00:00.000Z",
    };
    const source = {
      processInstanceId: "1160447",
      processId: "Atendimento Central de Lançamento - CONSINCO",
      processDescription: "Central de Lançamento",
      requesterId: "00130",
      requesterName: "Administrativo CD",
      stateDescription: "Realizar Pagamento",
      active: true,
    };
    const task = __test.mapCentralTaskItem(source, {
      ...commonInput,
      syncType: "open_tasks",
      operation: "sync_user_open_tasks",
    });
    const request = __test.mapCentralTaskItem(source, {
      ...commonInput,
      syncType: "my_requests",
      operation: "sync_user_open_requests",
    });
    const items = __test.mergeCentralItems([task, request].filter(Boolean) as Array<Record<string, unknown>>);

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      numeroFluig: "1160447",
      moduleSlug: "pagamentos",
      syncFluigUserId: "00130",
      syncTypes: ["open_tasks", "my_requests"],
    });
    expect(__test.membershipSummary(items, { openTasks: 45, myRequests: 600 })).toMatchObject({
      global: { openTasks: 45, myRequests: 600 },
      modules: [{ module: "pagamentos", openTasks: 1, myRequests: 1 }],
    });
  });

  it("inclui na lista monitorada uma solicitacao que aparece apenas como tarefa do usuario", () => {
    expect(
      __test.membershipSummary(
        [
          {
            numeroFluig: "1119665",
            moduleSlug: "compras",
            syncTypes: ["open_tasks"],
          },
        ],
        { openTasks: 45, myRequests: 600 }
      )
    ).toMatchObject({
      modules: [{ module: "compras", openTasks: 1, myRequests: 1 }],
    });
  });
});
