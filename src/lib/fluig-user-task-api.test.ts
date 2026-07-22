import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { __test } = require("../../scripts/fluig/api/userTaskApi.js") as {
  __test: {
    currentUserIdentity: (payload: unknown) => Record<string, unknown> | null;
    datasetRows: (payload: unknown) => Array<Record<string, unknown>>;
    mapFallbackWorkflowTask: (item: Record<string, unknown>) => Record<string, unknown>;
    mapProcessTaskDatasetRow: (
      task: Record<string, unknown>,
      process: Record<string, unknown>
    ) => Record<string, unknown>;
    mapCentralTaskItem: (item: Record<string, unknown>, input: Record<string, unknown>) => Record<string, unknown> | null;
    membershipSummary: (
      items: Array<Record<string, unknown>>,
      totals: { openTasks: number; myRequests: number }
    ) => Record<string, unknown>;
    mergeCentralItems: (items: Array<Record<string, unknown>>) => Array<Record<string, unknown>>;
    normalizeKey: (value: unknown) => string;
    pickColleague: (
      rows: Array<Record<string, unknown>>,
      email: string,
      localPart: string
    ) => Record<string, unknown> | null;
    totalsFromSummary: (payload: unknown) => { openTasks: number; myRequests: number };
    userListItems: (payload: unknown) => Array<Record<string, unknown>>;
    workflowEnvelope: (payload: unknown) => { items: Array<Record<string, unknown>>; hasNext: boolean | null };
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

  it("encontra o colaborador por login quando o e-mail cadastrado no Fluig diverge", () => {
    expect(
      __test.pickColleague(
        [
          {
            "colleaguePK.colleagueId": "00144",
            login: "administrativo.qnm11.atacadaodiaadia.com.br.1",
            mail: "administrativo.ceilandia@atacadaodiaadia.com.br",
          },
        ],
        "administrativo.qnm11@atacadaodiaadia.com.br",
        "administrativo.qnm11"
      )
    ).toMatchObject({ "colleaguePK.colleagueId": "00144" });
  });

  it("normaliza a resposta paginada da API alternativa de tarefas", () => {
    const envelope = __test.workflowEnvelope({
      content: {
        items: [
          {
            processInstanceId: 179529,
            processId: "Solicitacao de Compra Administrativa",
            requesterCode: "00189",
            stateName: "Analisar solicitacao",
          },
        ],
        hasNext: false,
      },
    });

    expect(envelope.hasNext).toBe(false);
    expect(__test.mapFallbackWorkflowTask(envelope.items[0])).toMatchObject({
      processInstanceId: 179529,
      requesterId: "00189",
      stateDescription: "Analisar solicitacao",
      active: true,
    });
  });

  it("monta a tarefa a partir dos datasets internos sem depender da referencia orfa", () => {
    expect(
      __test.mapProcessTaskDatasetRow(
        {
          "processTask.processInstanceId": "1184954",
          "processTask.movementSequence": "7",
          choosedSequence: "12",
          choosedColleagueId: "00144",
          status: "0",
          active: "true",
        },
        {
          processId: "Solicitacao de Compra Administrativa",
          requesterId: "00189",
          startDateProcess: "2026-07-20 10:00:00",
        }
      )
    ).toMatchObject({
      processInstanceId: "1184954",
      processId: "Solicitacao de Compra Administrativa",
      movementSequence: 7,
      stateId: 12,
      active: true,
    });
  });

  it("le usuarios quando o Fluig retorna a lista dentro de content.users", () => {
    expect(__test.userListItems({ content: { users: [{ code: "00189" }] } })).toEqual([{ code: "00189" }]);
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
