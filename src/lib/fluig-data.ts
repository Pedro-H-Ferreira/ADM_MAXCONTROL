export type FluigModuleSlug = "pagamentos" | "compras" | "manutencao" | "fornecedores";

export type FluigMappedField = {
  fluigField: string;
  admField: string;
  rule: string;
  source: "adm_page" | "fixed_default" | "fluig_zoom" | "supplier_map" | "attachment" | "user_context";
  required: boolean;
};

export type FluigExampleRequest = {
  id: string;
  title: string;
  processId: string;
  source: string;
  openedBy: string;
  status: string;
  notes: string;
  stableDefaults: string[];
  variableFields: string[];
  payloadPreview: Record<string, string>;
};

export type FluigSyncRow = {
  id: string;
  module: FluigModuleSlug;
  admReference: string;
  fluigNumber: string;
  branch?: string;
  branchCode?: string;
  supplier: string;
  cnpj: string;
  amount: string;
  currentTask: string;
  taskOwner: string;
  fluigStatus: string;
  actionRequired: string;
  updatedAt: string;
};

export type FluigSupplierMatch = {
  supplier: string;
  cnpj: string;
  fluigName: string;
  previousRequest: string;
  confidence: string;
  status: string;
};

export type FluigIntegrationModule = {
  slug: FluigModuleSlug;
  route: string;
  title: string;
  intent: string;
  processId: string;
  processLabel: string;
  openUrl: string;
  stitch: {
    id: string;
    image: string;
    screenTitle: string;
  };
  exportFiles: string[];
  userOpenedEvidence: string[];
  apiUsage: string[];
  primaryAction: string;
  syncAction: string;
  status: string;
  mappedFields: FluigMappedField[];
  examples: FluigExampleRequest[];
  syncRows: FluigSyncRow[];
  supplierMatches: FluigSupplierMatch[];
};

export type FluigAdmSyncResponse = {
  success: boolean;
  generatedAt: string;
  sourceMode: "supabase_snapshot" | "external_api_proxy" | "internal_runner" | "disabled";
  externalApiConfigured: boolean;
  module: FluigModuleSlug;
  integration: FluigIntegrationModule;
  rows: FluigSyncRow[];
  examples: FluigExampleRequest[];
  supplierMatches: FluigSupplierMatch[];
  persistence?: {
    configured: boolean;
    errors: string[];
  };
};

const fluigHost = "https://nossaempresa.fluig.cloudtotvs.com.br";

const paymentFields: FluigMappedField[] = [
  {
    fluigField: "centroCusto",
    admField: "centro de custo do pagamento",
    rule: "Usar zoom Fluig; default CD Logistica quando a despesa nao informar outro centro.",
    source: "fluig_zoom",
    required: true,
  },
  {
    fluigField: "codigonaturezaC",
    admField: "categoria financeira",
    rule: "Default validado nos exemplos: 4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE.",
    source: "fixed_default",
    required: true,
  },
  {
    fluigField: "formaPagamento",
    admField: "forma de pagamento",
    rule: "Mapear PIX, BOLETO ou TRANSFERENCIA a partir do pagamento do ADM.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "fornecedorC",
    admField: "fornecedor",
    rule: "Resolver pelo mapa fornecedor ERP -> fornecedor Fluig antes de abrir solicitacao.",
    source: "supplier_map",
    required: true,
  },
  {
    fluigField: "codCNPJ",
    admField: "cnpj do fornecedor",
    rule: "Enviar somente digitos e validar contra XML/PDF quando houver anexo fiscal.",
    source: "supplier_map",
    required: true,
  },
  {
    fluigField: "descricaoDemandaEnvio",
    admField: "descricao do pagamento",
    rule: "Montar texto auditavel com despesa, periodo, nota e referencia ADM.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "nNotaFiscal",
    admField: "numero da nota",
    rule: "Usar numero extraido do XML ou digitado no pagamento.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "dataEmissaoNF",
    admField: "data de emissao",
    rule: "Formato pt-BR esperado pelo formulario Fluig.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "vencPagNota",
    admField: "vencimento",
    rule: "Usar vencimento da pagina de pagamentos, preservando prazo permitido pelo Fluig.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "unidadeFilial",
    admField: "filial",
    rule: "Enviar label exata do dataset dsConsultaFilialDDRestCONSINCO.",
    source: "fluig_zoom",
    required: true,
  },
  {
    fluigField: "valorNF",
    admField: "valor pago",
    rule: "Formatar como moeda pt-BR e repetir em valorNFT/valorTotalExibicao quando necessario.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "fileUpload / files[]",
    admField: "anexos do pagamento",
    rule: "Anexar XML/PDF pelo input real ecm-navigation-inputFile-clone quando a API nao suportar binario.",
    source: "attachment",
    required: false,
  },
];

const purchaseFields: FluigMappedField[] = [
  {
    fluigField: "responsavelPedido",
    admField: "solicitante",
    rule: "Preenchido pelo usuario Fluig autenticado; exportacao mostra Administrativo CD.",
    source: "user_context",
    required: true,
  },
  {
    fluigField: "dataPedido",
    admField: "data da requisicao",
    rule: "Data de abertura da requisicao do ADM.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "numeroSolicitacao",
    admField: "numero Fluig",
    rule: "Somente leitura no Fluig; gravar de volta no ADM apos abertura.",
    source: "user_context",
    required: false,
  },
  {
    fluigField: "centroCusto",
    admField: "centro de custo",
    rule: "Obrigatorio para abrir compra administrativa e para aprovacoes.",
    source: "fluig_zoom",
    required: true,
  },
  {
    fluigField: "contaCentroCusto",
    admField: "conta contabel",
    rule: "Derivar pela categoria do item ou selecionar por catalogo Fluig.",
    source: "fluig_zoom",
    required: true,
  },
  {
    fluigField: "codFilialPedido",
    admField: "filial de compra",
    rule: "Usar codigo de filial do ADM e label de zoom do Fluig.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "produto / descricaoProduto",
    admField: "itens da requisicao",
    rule: "Enviar cada item da tabela de compras com unidade, quantidade e observacao.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "anexos",
    admField: "cotacoes e evidencias",
    rule: "Anexar proposta, print ou justificativa diretamente da pagina de compras.",
    source: "attachment",
    required: false,
  },
];

const maintenanceFields: FluigMappedField[] = [
  {
    fluigField: "codPatrimonio",
    admField: "tag ou ativo",
    rule: "Obrigatorio quando a OS envolver ativo fixo; vazio para manutencao predial simples.",
    source: "adm_page",
    required: false,
  },
  {
    fluigField: "tipoTransacao",
    admField: "tipo da OS",
    rule: "Mapear manutencao, transferencia, baixa ou ajuste administrativo.",
    source: "fluig_zoom",
    required: true,
  },
  {
    fluigField: "filial",
    admField: "filial origem",
    rule: "Usar a filial do equipamento/area da OS.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "filialDestino",
    admField: "filial destino",
    rule: "Usar somente quando houver transferencia ou nota de remessa.",
    source: "fluig_zoom",
    required: false,
  },
  {
    fluigField: "dataPrevSaida",
    admField: "data prevista",
    rule: "Data planejada da execucao ou retirada do ativo.",
    source: "adm_page",
    required: false,
  },
  {
    fluigField: "zoomDemandaPara",
    admField: "responsavel Fluig",
    rule: "Roteia tarefa para fiscal, administrativo ou manutencao.",
    source: "fluig_zoom",
    required: true,
  },
  {
    fluigField: "obsFiscal",
    admField: "descricao tecnica",
    rule: "Copiar diagnostico, evidencias e acao esperada da OS.",
    source: "adm_page",
    required: true,
  },
  {
    fluigField: "NumLancW",
    admField: "numero de lancamento Consinco",
    rule: "Somente leitura; sincronizar de volta quando o Fluig preencher.",
    source: "user_context",
    required: false,
  },
];

const supplierFields: FluigMappedField[] = [
  {
    fluigField: "fornecedorC",
    admField: "razao social",
    rule: "Chave principal para localizar fornecedor ja usado no Fluig.",
    source: "supplier_map",
    required: true,
  },
  {
    fluigField: "codCNPJ",
    admField: "cnpj",
    rule: "Usar CNPJ normalizado para resolver duplicidades de nome.",
    source: "supplier_map",
    required: true,
  },
  {
    fluigField: "sourceRequestId",
    admField: "solicitacao modelo",
    rule: "Guardar numero de solicitacao anterior para copiar defaults seguros.",
    source: "user_context",
    required: false,
  },
  {
    fluigField: "formaPagamento",
    admField: "perfil financeiro",
    rule: "Sugerir default para pagamentos futuros, sem sobrescrever o formulario do ADM.",
    source: "fixed_default",
    required: false,
  },
];

export const fluigAdmApiContract = [
  {
    method: "POST",
    path: "/api/fluig/adm/sync",
    purpose: "Sincronizacao por pagina do ADM, sem importar o modelo antigo de fila.",
  },
  {
    method: "GET",
    path: "/fluig/suppliers",
    purpose: "API tecnica herdada para leitura de perfis e mapa de fornecedores.",
  },
  {
    method: "GET",
    path: "/fluig/logs",
    purpose: "Consulta tecnica de logs quando o runner interno Fluig do ADM estiver ativo.",
  },
  {
    method: "POST",
    path: "/fluig/launch/sync-status",
    purpose: "Referencia tecnica para consulta de status; o ADM usa payload proprio por modulo.",
  },
];

export const fluigIntegrationModules: Record<FluigModuleSlug, FluigIntegrationModule> = {
  pagamentos: {
    slug: "pagamentos",
    route: "/pagamentos",
    title: "Lancamento de pagamentos no Fluig",
    intent: "A pagina de pagamentos abre a Central de Lancamento Fluig, sincroniza status, tarefas e dados fiscais no proprio fluxo financeiro.",
    processId: "Atendimento Central de Lancamento - CONSINCO",
    processLabel: "Central de Lancamento",
    openUrl: `${fluigHost}/portal/p/1/pageworkflowview?processID=Atendimento%20Central%20de%20Lan%C3%A7amento%20-%20CONSINCO`,
    stitch: {
      id: "45cf17c924ea4dc18c4ae793c3f0d01d",
      image: "/stitch-fluig/detalhes-pagamento.png",
      screenTitle: "18.1. Detalhes de Pagamento (Fluig)",
    },
    exportFiles: [
      "FLUIG-EXPORT/Anexar NF para Central de Lancamento.html",
      "FLUIG-EXPORT/Anexar NF para Central de Lancamento2.html",
      "FLUIG-EXPORT/Anexar NF para Central de Lancamento3.html",
    ],
    userOpenedEvidence: [
      "Exemplos comparados: 1103651 e 1103369",
      "Campos fixos confirmados: PIX, fornecedor, sem rateio, sem parcelas",
      "Filiais confirmadas no zoom: 1007 - 1007-SIA, 1062 - 1062-LUZIANIA 2",
    ],
    apiUsage: [
      "Reaproveitar autenticacao, consulta de status e fornecedores da API existente.",
      "Nao usar a fila antiga de lancamentos como modelo de negocio do ADM.",
      "Enviar payload gerado pela pagina /pagamentos.",
    ],
    primaryAction: "Abrir pagamento no Fluig",
    syncAction: "Sincronizar pagamentos",
    status: "MAPEADO",
    mappedFields: paymentFields,
    examples: [],
    syncRows: [],
    supplierMatches: [],
  },
  compras: {
    slug: "compras",
    route: "/compras",
    title: "Abertura de compras no Fluig",
    intent: "A pagina de compras abre solicitacao administrativa no Fluig usando os itens, centro de custo, aprovadores e anexos da requisicao.",
    processId: "Solicitacao de Compra Administrativa",
    processLabel: "Compra Administrativa",
    openUrl: `${fluigHost}/portal/p/1/pageworkflowview?processID=Solicitacao%20de%20Compra%20Administrativa`,
    stitch: {
      id: "0865e9e688254986aebd9550904ad653",
      image: "/stitch-fluig/pedido-compra.png",
      screenTitle: "18.2. Pedido de Compra (Fluig)",
    },
    exportFiles: ["FLUIG-EXPORT/Pedido de Compra Administrativa.html"],
    userOpenedEvidence: [
      "Formulario exportado com processID=Solicitacao+de+Compra+Administrativa",
      "Usuario exportado: Administrativo CD / taskUserId=00130",
      "Versao exportada: WKVersDef=23",
    ],
    apiUsage: [
      "Usar a API existente apenas como transporte autenticado para abrir processo e consultar tarefa.",
      "O payload e os itens nascem em /compras.",
      "O retorno grava numero Fluig, etapa, responsavel e SLA no registro da requisicao.",
    ],
    primaryAction: "Abrir compra no Fluig",
    syncAction: "Sincronizar compras",
    status: "MAPEADO",
    mappedFields: purchaseFields,
    examples: [],
    syncRows: [],
    supplierMatches: [],
  },
  manutencao: {
    slug: "manutencao",
    route: "/manutencao",
    title: "OS e manutencao integradas ao Fluig",
    intent: "A pagina de manutencao usa o processo de ativo fixo para transferencia, baixa, ajuste ou manutencao com retorno para a OS.",
    processId: "Solicitar_transferencia_baixas_ativo_fixo",
    processLabel: "Ativo fixo / manutencao",
    openUrl: `${fluigHost}/portal/p/1/pageworkflowview?processID=Solicitar_transferencia_baixas_ativo_fixo`,
    stitch: {
      id: "2aa2358a06ce4737bad53125f96530da",
      image: "/stitch-fluig/manutencao-lancamentos.png",
      screenTitle: "18.3. Manutencao e Lancamentos (Fluig)",
    },
    exportFiles: ["FLUIG-EXPORT/Solicitaremissaodenotafiscal.html"],
    userOpenedEvidence: [
      "Formulario exportado com processID=Solicitar_transferencia_baixas_ativo_fixo",
      "Usuario exportado: Administrativo CD / taskUserId=00130",
      "Grupo solicitante encontrado: EasyAtivos",
    ],
    apiUsage: [
      "Consultar tarefas abertas por usuario/grupo para trazer pendencias de manutencao.",
      "Abrir processo a partir da OS atual, nao em uma aba Fluig separada.",
      "Sincronizar NumLancW, etapa atual, responsavel e anexos no registro da OS.",
    ],
    primaryAction: "Abrir OS no Fluig",
    syncAction: "Sincronizar OS",
    status: "EM_ANALISE",
    mappedFields: maintenanceFields,
    examples: [],
    syncRows: [],
    supplierMatches: [],
  },
  fornecedores: {
    slug: "fornecedores",
    route: "/fornecedores",
    title: "Mapa de fornecedores Fluig",
    intent: "A pagina de fornecedores consolida CNPJ, nome Fluig e solicitacoes anteriores para evitar erro de zoom ao abrir pagamentos e compras.",
    processId: "Mapa transversal",
    processLabel: "Fornecedores e defaults",
    openUrl: `${fluigHost}/portal/p/1/pageprocessstart`,
    stitch: {
      id: "3d3b676a415d46cba27b56226b48a04d",
      image: "/stitch-fluig/espelhamento-dados.png",
      screenTitle: "18.6. Espelhamento de Dados (Fluig)",
    },
    exportFiles: [
      "FLUIG-EXPORT/Anexar NF para Central de Lancamento*.html",
      "FLUIG-EXPORT/Pedido de Compra Administrativa.html",
    ],
    userOpenedEvidence: [
      "Solicitacoes modelo 1103651 e 1103369 usadas para mapear fornecedores ja lancados.",
      "Campos fornecedorC/codCNPJ encontrados nas paginas de pagamento e compra.",
    ],
    apiUsage: [
      "Ler /fluig/suppliers quando o backend externo estiver disponivel.",
      "Salvar correspondencias no cadastro local de fornecedores do ADM.",
      "Expor sugestoes para /pagamentos e /compras.",
    ],
    primaryAction: "Mapear fornecedor",
    syncAction: "Sincronizar fornecedores",
    status: "MAPEADO",
    mappedFields: supplierFields,
    examples: [],
    syncRows: [],
    supplierMatches: [],
  },
};

export function getFluigIntegrationForModule(slug: string) {
  return fluigIntegrationModules[slug as FluigModuleSlug] ?? null;
}

export function hasFluigIntegration(slug: string) {
  return Boolean(getFluigIntegrationForModule(slug));
}

export function buildFluigAdmSyncResponse(slug: string, generatedAt: string): FluigAdmSyncResponse | null {
  const integration = getFluigIntegrationForModule(slug);

  if (!integration) {
    return null;
  }

  return {
    success: true,
    generatedAt,
    sourceMode: "disabled",
    externalApiConfigured: Boolean(process.env.FLUIG_API_BASE_URL || process.env.NEXT_PUBLIC_FLUIG_API_BASE_URL),
    module: integration.slug,
    integration,
    rows: [],
    examples: [],
    supplierMatches: [],
  };
}
