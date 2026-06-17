import {
  fluigIntegrationModules,
  type FluigIntegrationModule,
  type FluigMappedField,
  type FluigModuleSlug,
} from "@/lib/fluig-data";

export type FluigOperationName = "history" | "status" | "open" | "cancel" | "supplier_preload";

export type FluigProcessCapability = {
  operation: FluigOperationName;
  enabled: boolean;
  runner: "generic_history" | "generic_open_from_source" | "sync_status" | "cancel" | "supplier_analyzer";
  notes: string;
};

export type FluigProcessMap = {
  module: FluigModuleSlug;
  route: string;
  processId: string;
  processLabel: string;
  processVersions: string[];
  defaultTaskUserId: string;
  defaultSourceRequestIds: string[];
  openUrl: string;
  status: FluigIntegrationModule["status"];
  exportFiles: string[];
  mappedFields: FluigMappedField[];
  capabilities: FluigProcessCapability[];
};

const processRuntime: Record<
  FluigModuleSlug,
  Pick<FluigProcessMap, "processVersions" | "defaultTaskUserId" | "defaultSourceRequestIds" | "capabilities">
> = {
  pagamentos: {
    processVersions: ["162"],
    defaultTaskUserId: "00130",
    defaultSourceRequestIds: ["1103651", "1103369"],
    capabilities: [
      {
        operation: "history",
        enabled: true,
        runner: "generic_history",
        notes: "Consulta o indice de solicitacoes do processo com formFields para mapear pagamentos e fornecedores.",
      },
      {
        operation: "status",
        enabled: true,
        runner: "sync_status",
        notes: "Consulta etapa, responsavel, vencimento e cancelabilidade por numero de solicitacao.",
      },
      {
        operation: "open",
        enabled: true,
        runner: "generic_open_from_source",
        notes: "Abre a Central de Lancamento a partir de uma solicitacao modelo e sobrescreve campos da pagina /pagamentos.",
      },
      {
        operation: "cancel",
        enabled: true,
        runner: "cancel",
        notes: "Cancela solicitacoes confirmadas pelo usuario usando a API interna workflowView.",
      },
      {
        operation: "supplier_preload",
        enabled: true,
        runner: "supplier_analyzer",
        notes: "Usa fornecedorC/codCNPJ do historico para criar pre-cadastro local.",
      },
    ],
  },
  compras: {
    processVersions: ["23"],
    defaultTaskUserId: "00130",
    defaultSourceRequestIds: [],
    capabilities: [
      {
        operation: "history",
        enabled: true,
        runner: "generic_history",
        notes: "Consulta pedidos administrativos anteriores e permite escolher uma solicitacao modelo real.",
      },
      {
        operation: "status",
        enabled: true,
        runner: "sync_status",
        notes: "Consulta etapa, responsavel e SLA do pedido de compra ja aberto.",
      },
      {
        operation: "open",
        enabled: true,
        runner: "generic_open_from_source",
        notes: "Requer sourceRequestId de uma compra real ja aberta para clonar estrutura e itens.",
      },
      {
        operation: "cancel",
        enabled: true,
        runner: "cancel",
        notes: "Cancela pedido de compra quando a solicitacao estiver cancelavel no Fluig.",
      },
      {
        operation: "supplier_preload",
        enabled: true,
        runner: "supplier_analyzer",
        notes: "Tenta extrair fornecedores dos campos de compra e anexos quando presentes.",
      },
    ],
  },
  manutencao: {
    processVersions: ["14"],
    defaultTaskUserId: "00130",
    defaultSourceRequestIds: [],
    capabilities: [
      {
        operation: "history",
        enabled: true,
        runner: "generic_history",
        notes: "Consulta OS/processos de ativo fixo para mapear campos e retornos NumLancW.",
      },
      {
        operation: "status",
        enabled: true,
        runner: "sync_status",
        notes: "Consulta etapa, responsavel e status das OS integradas ao Fluig.",
      },
      {
        operation: "open",
        enabled: true,
        runner: "generic_open_from_source",
        notes: "Requer sourceRequestId de uma OS Fluig real; OS manual fica somente na ferramenta.",
      },
      {
        operation: "cancel",
        enabled: true,
        runner: "cancel",
        notes: "Cancela somente OS que foram abertas no Fluig, nunca OS manual da ferramenta.",
      },
      {
        operation: "supplier_preload",
        enabled: true,
        runner: "supplier_analyzer",
        notes: "Mapeia prestadores e fornecedores usados em manutencoes quando os campos existirem.",
      },
    ],
  },
  fornecedores: {
    processVersions: ["162", "23", "14"],
    defaultTaskUserId: "00130",
    defaultSourceRequestIds: ["1103651", "1103369"],
    capabilities: [
      {
        operation: "history",
        enabled: true,
        runner: "generic_history",
        notes: "Varre os processos mapeados para encontrar fornecedores ja usados.",
      },
      {
        operation: "status",
        enabled: false,
        runner: "sync_status",
        notes: "Fornecedores nao possuem solicitacao propria; status vem dos processos de origem.",
      },
      {
        operation: "open",
        enabled: false,
        runner: "generic_open_from_source",
        notes: "O cadastro de fornecedor e local; abertura ocorre nas paginas de pagamentos, compras ou manutencao.",
      },
      {
        operation: "cancel",
        enabled: false,
        runner: "cancel",
        notes: "Cancelamento e sempre da solicitacao de origem.",
      },
      {
        operation: "supplier_preload",
        enabled: true,
        runner: "supplier_analyzer",
        notes: "Gera candidatos de pre-cadastro por CNPJ/nome normalizado e solicitacoes modelo.",
      },
    ],
  },
};

export function listFluigProcessMaps() {
  return Object.keys(fluigIntegrationModules)
    .map((slug) => getFluigProcessMap(slug as FluigModuleSlug))
    .filter((map): map is FluigProcessMap => Boolean(map));
}

export function getFluigProcessMap(slug: string): FluigProcessMap | null {
  const integration = fluigIntegrationModules[slug as FluigModuleSlug];
  const runtime = processRuntime[slug as FluigModuleSlug];

  if (!integration || !runtime) {
    return null;
  }

  return {
    module: integration.slug,
    route: integration.route,
    processId: integration.processId,
    processLabel: integration.processLabel,
    processVersions: runtime.processVersions,
    defaultTaskUserId: runtime.defaultTaskUserId,
    defaultSourceRequestIds: runtime.defaultSourceRequestIds,
    openUrl: integration.openUrl,
    status: integration.status,
    exportFiles: integration.exportFiles,
    mappedFields: integration.mappedFields,
    capabilities: runtime.capabilities,
  };
}

export function requireFluigProcessMap(slug: string) {
  const map = getFluigProcessMap(slug);

  if (!map) {
    throw new Error(`Modulo sem mapeamento Fluig: ${slug}`);
  }

  return map;
}

export function isFluigModuleSlug(value: string): value is FluigModuleSlug {
  return value === "pagamentos" || value === "compras" || value === "manutencao" || value === "fornecedores";
}
