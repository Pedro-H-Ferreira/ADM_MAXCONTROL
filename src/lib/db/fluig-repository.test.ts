import { describe, expect, it } from "vitest";
import {
  buildFluigLaunchTemplatesFromRequests,
  buildFluigHistoryRequestRow,
  buildFluigNatureFacets,
  buildFluigStatusRequestRow,
  buildSupplierCandidates,
  countDistinctFluigAccounts,
  describeFluigPersistenceError,
  fluigFieldLabelFromKey,
  fluigFieldSettingsHash,
  groupFluigStatusRowsForUpsert,
  mergeFluigFieldSettingsWithDiscovered,
  normalizeFluigRequestLifecycle,
} from "@/lib/db/fluig-repository";
import type { FluigHistoryItem, FluigStatusItem } from "@/lib/fluig/server-client";

function historyItem(
  processInstanceId: string,
  overrides: Partial<FluigHistoryItem["formFields"]> = {}
): FluigHistoryItem {
  return {
    processInstanceId,
    processId: "Atendimento Central de Lancamento - CONSINCO",
    processVersion: "162",
    status: "OPEN",
    startDate: "2026-06-01T00:00:00.000Z",
    requesterId: "00101",
    requesterName: "Administrativo",
    sourceUrl: "https://fluig.example/request",
    raw: {},
    formFields: {
      fornecedorC: "2119453 - IRONBR AMBIENTE SEGURO LTDA - 00801587000138",
      codCNPJ: "00801587000138",
      unidadeFilial: "1016 - 1016-SAD",
      centroCusto: "3311003 - EXPANSAO MANUTENCAO",
      codCentroCusto: "3311003",
      codigonaturezaC: "5030101 - MANUTENCAO",
      ...overrides,
    },
  };
}

type TemplateRequestRow = Parameters<typeof buildFluigLaunchTemplatesFromRequests>[0][number];

function templateRequest(
  id: string,
  openedAt: string,
  overrides: Partial<TemplateRequestRow> & { fields?: Record<string, string> } = {}
): TemplateRequestRow {
  const { fields, ...rowOverrides } = overrides;
  return {
    id,
    module_slug: "pagamentos",
    fluig_request_id: id,
    supplier_name: "FORNECEDOR MODELO",
    supplier_cnpj: "00801587000138",
    expense_nature: "5030103 - ENERGIA ELETRICA - REDE GERAL",
    branch_code: "1016",
    branch_label: "1016 - 1016-SAD",
    opened_at: openedAt,
    last_synced_at: openedAt,
    raw_payload: {
      formFields: {
        fornecedorC: "2119453 - FORNECEDOR MODELO - 00801587000138",
        codCNPJ: "00801587000138",
        unidadeFilial: "1016 - 1016-SAD",
        centroCusto: "3311003 - EXPANSAO MANUTENCAO",
        codigonaturezaC: "5030101 - MANUTENCAO",
        formaPagamento: "PIX",
        ...fields,
      },
    },
    ...rowOverrides,
  } as TemplateRequestRow;
}

describe("buildSupplierCandidates", () => {
  it("preserva mensagem, detalhes e codigo dos erros retornados pelo Supabase", () => {
    expect(describeFluigPersistenceError({
      message: "Falha ao salvar",
      details: "Coluna invalida",
      code: "PGRST204",
    })).toBe("Falha ao salvar | Coluna invalida | PGRST204");
  });

  it("inclui todos os campos Fluig descobertos sem duplicar os ja configurados", () => {
    const settings = mergeFluigFieldSettingsWithDiscovered("pagamentos", [{
      id: "setting-nf",
      module: "pagamentos",
      fieldKey: "nNotaFiscal",
      label: "Numero da NF",
      sourceType: "form",
      active: true,
      visibleInList: true,
      listOrder: 10,
      visibleInForm: true,
      formOrder: 10,
    }], [
      { field_key: "nNotaFiscal", occurrence_count: 20, sample_value: "4844" },
      { field_key: "obsAnalisePgto", occurrence_count: "18", sample_value: "Pagamento conferido" },
    ]);

    expect(settings).toHaveLength(2);
    expect(settings[0]).toMatchObject({
      fieldKey: "nNotaFiscal",
      discovered: false,
      occurrenceCount: 20,
      sampleValue: "4844",
    });
    expect(settings[1]).toMatchObject({
      fieldKey: "obsAnalisePgto",
      label: "Obs Analise Pgto",
      active: false,
      visibleInList: false,
      visibleInForm: false,
      discovered: true,
      occurrenceCount: 18,
      sampleValue: "Pagamento conferido",
    });
    expect(fluigFieldLabelFromKey("solProdutoServico___3")).toBe("Sol Produto Servico - linha 3");
  });

  it("lista somente naturezas presentes e mostra a quantidade de cada uma", () => {
    expect(buildFluigNatureFacets([
      "5040613 - MANUTENCAO DA EMPILHADEIRA",
      " 5030101 - MANUTENCAO ",
      "5040613 - MANUTENCAO DA EMPILHADEIRA",
      null,
      "",
    ])).toEqual([
      { value: "5030101 - MANUTENCAO", label: "5030101 - MANUTENCAO", count: 1 },
      { value: "5040613 - MANUTENCAO DA EMPILHADEIRA", label: "5040613 - MANUTENCAO DA EMPILHADEIRA", count: 2 },
    ]);
  });

  it("conta perfis com a mesma identidade Fluig como uma credencial", () => {
    expect(countDistinctFluigAccounts([
      {
        id: "user-administrativo",
        email: "administrativo@dvaatacados.com.br",
        fluigUsername: "administrativo@dvaatacados.com.br",
        fluigUserId: "00130",
      },
      {
        id: "user-pedro",
        email: "pedro@example.com",
        fluigUsername: "ADMINISTRATIVO@DVAATACADOS.COM.BR",
        fluigUserId: "00130",
      },
    ])).toBe(1);
  });

  it("mantem credenciais Fluig realmente diferentes separadas", () => {
    expect(countDistinctFluigAccounts([
      {
        id: "user-1",
        email: "administrativo.agc@atacadaodiaadia.com.br",
        fluigUsername: "administrativo.agc@atacadaodiaadia.com.br",
        fluigUserId: "00130",
      },
      {
        id: "user-2",
        email: "administrativo.aps@atacadaodiaadia.com.br",
        fluigUsername: "administrativo.aps@atacadaodiaadia.com.br",
        fluigUserId: "00131",
      },
    ])).toBe(2);
  });

  it("normaliza o ciclo de vida historico antes de montar listas operacionais", () => {
    expect(normalizeFluigRequestLifecycle("OPEN", "2026-06-25T10:00:00.000Z")).toMatchObject({
      normalizedStatus: "em_andamento",
      isOpen: true,
      closedAt: null,
    });
    expect(normalizeFluigRequestLifecycle("FINALIZED", "2026-06-25T10:00:00.000Z")).toMatchObject({
      normalizedStatus: "finalizado",
      isOpen: false,
      finalizedAt: "2026-06-25T10:00:00.000Z",
    });
    expect(normalizeFluigRequestLifecycle("CANCELED", "2026-06-25T10:00:00.000Z")).toMatchObject({
      normalizedStatus: "cancelado",
      isOpen: false,
      canceledAt: "2026-06-25T10:00:00.000Z",
    });
  });

  it("grava o estado aberto diretamente durante a carga historica", () => {
    expect(buildFluigHistoryRequestRow("pagamentos", historyItem("1164217"))).toMatchObject({
      normalized_status: "em_andamento",
      is_open: true,
      expense_nature: "5030101 - MANUTENCAO",
      finalized_at: null,
      closed_at: null,
      canceled_at: null,
    });

    const finalized = historyItem("1164216");
    finalized.status = "FINALIZED";
    finalized.endDate = "2026-06-15T12:00:00.000-0300";
    expect(buildFluigHistoryRequestRow("pagamentos", finalized)).toMatchObject({
      normalized_status: "finalizado",
      is_open: false,
      finalized_at: "2026-06-15T15:00:00.000Z",
      closed_at: "2026-06-15T15:00:00.000Z",
    });
  });

  it("deduplica o mesmo fornecedor e preserva as solicitacoes de origem", () => {
    const candidates = buildSupplierCandidates([
      historyItem("1164218"),
      historyItem("1164219", { unidadeFilial: "1016 - 1016-SAD" }),
    ]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      cnpj: "00801587000138",
      confidence: 0.95,
    });
    expect(candidates[0].sourceRequestIds).toEqual(["1164218", "1164219"]);
    expect(candidates[0].suggestedDefaults).toMatchObject({
      sourceRequestId: "1164218",
      unidadeFilial: "1016 - 1016-SAD",
      codCentroCusto: "3311003",
    });
  });

  it("usa os campos reais do formulario quando a API historica nao retorna solicitante", () => {
    const item = historyItem("1164220", {
      responsavelEnvio: "Administrativo DVA CD",
      matResponsavelEnvio: "00130",
    });
    item.requesterId = null;
    item.requesterName = null;

    expect(buildFluigHistoryRequestRow("pagamentos", item)).toMatchObject({
      requester: "Administrativo DVA CD",
      fluig_requester_login: "Administrativo DVA CD",
      fluig_requester_code: "00130",
    });
  });

  it("preserva formulario historico e etapa anterior quando o status vem parcial", () => {
    const statusItem: FluigStatusItem = {
      numeroFluig: "1164220",
      statusProcesso: "em_andamento",
      active: true,
      responsavelCodigo: "00130",
      dataUltimaConsulta: "2026-06-25T10:00:00.000Z",
    };

    const row = buildFluigStatusRequestRow(
      "pagamentos",
      statusItem,
      { ownerUserId: "2ff30ac3-e1c7-4df8-a12c-511318469cca", syncSource: "sync_user_open_tasks" },
      {
        status: "OPEN",
        current_task: "Realizar pagamento",
        task_owner: null,
        due_date: "2026-06-30",
        raw_payload: {
          formFields: {
            fornecedorC: "Fornecedor existente",
          },
        },
      }
    );

    expect(row).toMatchObject({
      current_task: "Realizar pagamento",
      task_owner: "00130",
      currency: "BRL",
      due_date: "2026-06-30",
      sync_owner_user_id: "2ff30ac3-e1c7-4df8-a12c-511318469cca",
      raw_payload: {
        formFields: {
          fornecedorC: "Fornecedor existente",
        },
        statusSnapshot: statusItem,
      },
    });
  });

  it("separa lotes por campos definidos para nao transformar ausentes em null", () => {
    const groups = groupFluigStatusRowsForUpsert([
      { fluig_request_id: "1", currency: "BRL", detail_snapshot: undefined },
      { fluig_request_id: "2", currency: "BRL", detail_snapshot: { formFields: {} } },
    ]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toEqual([{ fluig_request_id: "1", currency: "BRL" }]);
    expect(groups[1]).toEqual([
      { fluig_request_id: "2", currency: "BRL", detail_snapshot: { formFields: {} } },
    ]);
  });

  it("grava somente o snapshot detalhado recebido pela sincronizacao e atualiza os campos operacionais", () => {
    const row = buildFluigStatusRequestRow("pagamentos", {
      numeroFluig: "1160475",
      statusProcesso: "em_andamento",
      active: true,
      movementSequence: 31,
      detailConfigHash: "config-1",
      detailSnapshot: {
        requestId: "1160475",
        taskUserId: "00130",
        sourceUrl: "https://fluig.example/1160475",
        fetchedAt: "2026-07-22T20:00:00.000Z",
        formFields: {
          nNotaFiscal: "3737",
          valorNF: "1.105,92",
          vencPagNota: "01/07/2026",
          codigonaturezaC: "5040613",
          fornecedorC: "FORNECEDOR TESTE",
          codCNPJ: "00801587000138",
        },
        attachments: [{ sequence: "1", name: "nota.pdf", description: "nota.pdf", mimeType: "application/pdf", size: 10, documentId: "1", version: "1", attachedBy: "ADM", attachedAt: null }],
        history: [],
        warnings: [],
      },
    });

    expect(row).toMatchObject({
      supplier_name: "FORNECEDOR TESTE",
      supplier_cnpj: "00801587000138",
      amount_cents: 110592,
      due_date: "2026-07-01",
      expense_nature: "5040613",
      detail_movement_sequence: 31,
      detail_config_hash: "config-1",
      raw_payload: { formFields: { nNotaFiscal: "3737" } },
    });
    expect((row.raw_payload.statusSnapshot as Record<string, unknown>).detailSnapshot).toBeUndefined();
  });

  it("muda a assinatura somente quando os campos sincronizados mudam", () => {
    const base = [{ fieldKey: "nNotaFiscal", sourceType: "form" as const, active: true, visibleInList: true, visibleInForm: true }];
    expect(fluigFieldSettingsHash(base)).toBe(fluigFieldSettingsHash([{ ...base[0] }]));
    expect(fluigFieldSettingsHash(base)).not.toBe(fluigFieldSettingsHash([{ ...base[0], visibleInForm: false }]));
  });

  it("distingue cancelamento de finalizacao na consulta de status", () => {
    const row = buildFluigStatusRequestRow("pagamentos", {
      numeroFluig: "1164221",
      statusProcesso: "cancelado",
      active: false,
      dataUltimaConsulta: "2026-06-25T11:00:00.000Z",
    });

    expect(row).toMatchObject({
      normalized_status: "cancelado",
      is_open: false,
      finalized_at: null,
      closed_at: "2026-06-25T11:00:00.000Z",
      canceled_at: "2026-06-25T11:00:00.000Z",
    });
  });

  it("marca a participacao exata do usuario nas listas da Central de Tarefas", () => {
    expect(
      buildFluigStatusRequestRow("pagamentos", {
        numeroFluig: "1160447",
        statusProcesso: "em_andamento",
        active: true,
        dataUltimaConsulta: "2026-07-14T15:00:00.000Z",
        syncFluigUserId: "00130",
        syncTypes: ["open_tasks", "my_requests"],
      })
    ).toMatchObject({
      open_task_fluig_user_id: "00130",
      my_request_fluig_user_id: "00130",
      last_seen_in_user_task_list_at: "2026-07-14T15:00:00.000Z",
      last_seen_in_user_request_list_at: "2026-07-14T15:00:00.000Z",
    });
  });
});

describe("buildFluigLaunchTemplatesFromRequests", () => {
  it("nao classifica frete de transferencia DANFE como conta mensal", () => {
    const templates = buildFluigLaunchTemplatesFromRequests([
      templateRequest("frete-abril-1", "2026-04-01T10:00:00.000Z", {
        expense_nature: "4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE",
      }),
      templateRequest("frete-abril-2", "2026-04-08T10:00:00.000Z", {
        expense_nature: "4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE",
      }),
      templateRequest("frete-maio-1", "2026-05-01T10:00:00.000Z", {
        expense_nature: "4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE",
      }),
      templateRequest("frete-junho-1", "2026-06-01T10:00:00.000Z", {
        expense_nature: "4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE",
      }),
    ]);

    expect(templates[0]?.recurrence).toBe("model");
  });

  it("reconhece recorrencia que ficaria fora das 50 solicitacoes mais recentes", () => {
    const recentOneOffs = Array.from({ length: 50 }, (_, index) =>
      templateRequest(`2000${index}`, `2026-07-${String((index % 28) + 1).padStart(2, "0")}T10:00:00.000Z`, {
        supplier_name: `FORNECEDOR AVULSO ${index}`,
        supplier_cnpj: String(10000000000000 + index),
        fields: {
          fornecedorC: `FORNECEDOR AVULSO ${index}`,
          codCNPJ: String(10000000000000 + index),
        },
      })
    );
    const templates = buildFluigLaunchTemplatesFromRequests([
      ...recentOneOffs,
      templateRequest("1164200", "2026-04-01T10:00:00.000Z"),
      templateRequest("1164201", "2026-05-01T10:00:00.000Z"),
    ]);

    expect(templates.find((template) => template.supplierCnpj === "00801587000138")).toMatchObject({
      recurrence: "monthly",
      monthCount: 2,
    });
  });

  it("agrupa pagamentos por fornecedor, CNPJ e filial", () => {
    const templates = buildFluigLaunchTemplatesFromRequests([
      templateRequest("1164300", "2026-05-01T10:00:00.000Z"),
      templateRequest("1164301", "2026-06-01T10:00:00.000Z"),
      templateRequest("1164302", "2026-06-02T10:00:00.000Z", {
        branch_code: "1022",
        branch_label: "1022 - 1022-CA",
        fields: { unidadeFilial: "1022 - 1022-CA" },
      }),
    ]);

    expect(templates).toHaveLength(2);
    expect(templates.find((template) => template.branchCode === "1016")).toMatchObject({
      recurrence: "monthly",
      occurrenceCount: 2,
      monthCount: 2,
    });
  });

  it("usa o registro reutilizavel mais recente, preserva a descricao e descarta campos variaveis", () => {
    const templates = buildFluigLaunchTemplatesFromRequests([
      templateRequest("1164400", "2026-05-01T10:00:00.000Z", {
        fields: {
          centroCusto: "ANTIGO",
          codigonaturezaC: "NATUREZA ANTIGA",
          formaPagamento: "BOLETO",
        },
      }),
      templateRequest("1164401", "2026-06-01T10:00:00.000Z", {
        fields: {
          centroCusto: "NOVO",
          codigonaturezaC: "NATUREZA NOVA",
          formaPagamento: "PIX",
          nNotaFiscal: "9988",
          dataEmissaoNF: "01/06/2026",
          vencPagNota: "10/06/2026",
          valorNF: "1.234,56",
          descricaoDemandaEnvio: "Competencia de junho",
        },
      }),
      templateRequest("1164402", "2026-07-01T10:00:00.000Z", {
        fields: {
          centroCusto: "INCOMPLETO",
          codigonaturezaC: "",
          formaPagamento: "",
          descricaoDemandaEnvio: "",
        },
      }),
    ]);

    expect(templates[0]).toMatchObject({
      sourceRequestId: "1164402",
      defaultFields: {
        centroCusto: "INCOMPLETO",
        codigonaturezaC: "NATUREZA NOVA",
        formaPagamento: "PIX",
        descricaoDemandaEnvio: "Competencia de junho",
      },
    });
    expect(templates[0].defaultFields).not.toHaveProperty("nNotaFiscal");
    expect(templates[0].defaultFields).not.toHaveProperty("dataEmissaoNF");
    expect(templates[0].defaultFields).not.toHaveProperty("vencPagNota");
    expect(templates[0].defaultFields).not.toHaveProperty("valorNF");
    expect(templates[0].defaultFields.descricaoDemandaEnvio).toBe("Competencia de junho");
  });

  it("cria modelo mesmo quando o historico possui apenas parte da classificacao", () => {
    const templates = buildFluigLaunchTemplatesFromRequests([
      templateRequest("1164500", "2026-06-01T10:00:00.000Z", {
        fields: {
          centroCusto: "3111001 - OPERACAO LOJA",
          codigonaturezaC: "5030103 - ENERGIA ELETRICA - REDE GERAL",
          formaPagamento: "",
          descricaoDemandaEnvio: "CONTA MENSAL DE ENERGIA",
        },
      }),
    ]);

    expect(templates[0]).toMatchObject({
      sourceRequestId: "1164500",
      defaultFields: {
        centroCusto: "3111001 - OPERACAO LOJA",
        codigonaturezaC: "5030103 - ENERGIA ELETRICA - REDE GERAL",
        descricaoDemandaEnvio: "CONTA MENSAL DE ENERGIA",
      },
    });
  });
});
