import {
  AlertTriangle,
  Banknote,
  Building2,
  ClipboardCheck,
  FileSignature,
  ListTodo,
  ReceiptText,
  ShieldCheck,
  ShoppingCart,
  UsersRound,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type Tone = "default" | "success" | "warning" | "danger" | "info";

export type StatItem = {
  title: string;
  value: string;
  helper: string;
  change: string;
  tone: Tone;
  icon: LucideIcon;
};

export type TableRow = Record<string, string>;

export type ModuleConfig = {
  slug: string;
  title: string;
  eyebrow: string;
  description: string;
  primaryAction?: {
    label: string;
    href: string;
  };
  metrics: StatItem[];
  table: {
    columns: string[];
    rows: TableRow[];
  };
  statuses: string[];
  formSections: {
    title: string;
    fields: string[];
  }[];
};

export const currentUser = {
  name: "Pedro Henrique",
  email: "admin@maxcontrol.local",
  role: "ADMIN_MASTER",
  cd: "CD Principal",
};

export const dashboardStats: StatItem[] = [
  {
    title: "Despesas do mês",
    value: "R$ 184.920,00",
    helper: "Competência atual",
    change: "+8,2%",
    tone: "info",
    icon: ReceiptText,
  },
  {
    title: "Contas pendentes",
    value: "37",
    helper: "R$ 92.410,00 em aberto",
    change: "12 críticas",
    tone: "warning",
    icon: Banknote,
  },
  {
    title: "Contratos vencendo",
    value: "9",
    helper: "Próximos 30 dias",
    change: "3 sem renovação",
    tone: "danger",
    icon: FileSignature,
  },
  {
    title: "OS abertas",
    value: "24",
    helper: "Facilities e manutenção",
    change: "6 atrasadas",
    tone: "warning",
    icon: Wrench,
  },
  {
    title: "Tarefas atrasadas",
    value: "18",
    helper: "Plano de ação 90 dias",
    change: "-4 vs semana",
    tone: "success",
    icon: ListTodo,
  },
  {
    title: "Fornecedores ativos",
    value: "312",
    helper: "Base homologada",
    change: "+11 no mês",
    tone: "success",
    icon: Building2,
  },
];

export const dashboardAlerts = [
  {
    title: "Energia elétrica vence hoje",
    detail: "Despesa R$ 42.880,00 aguardando validação fiscal.",
    tone: "danger" as Tone,
  },
  {
    title: "Contrato de vigilância vence em 12 dias",
    detail: "Renovação sem anexo atualizado.",
    tone: "warning" as Tone,
  },
  {
    title: "Checklist mensal incompleto",
    detail: "5 itens de infraestrutura ainda sem evidência.",
    tone: "info" as Tone,
  },
];

export const upcomingPayments = [
  ["19/06/2026", "Energia SP", "R$ 42.880,00", "VENCE HOJE"],
  ["21/06/2026", "Limpeza terceirizada", "R$ 18.400,00", "PENDENTE"],
  ["25/06/2026", "Internet corporativa", "R$ 3.980,00", "PENDENTE"],
  ["28/06/2026", "Manutenção empilhadeiras", "R$ 12.750,00", "EM ANÁLISE"],
];

export const recentActivities = [
  "Pagamento de limpeza registrado por Financeiro",
  "Fornecedor TopFrio teve contrato renovado",
  "OS #OS-1042 movida para aguardando fornecedor",
  "Nova requisição de compra criada para EPI",
  "Usuário Manutenção CD anexou evidência em checklist",
];

const baseMetrics: StatItem[] = [
  {
    title: "Registros ativos",
    value: "128",
    helper: "Filtrados pelo CD Principal",
    change: "+6 este mês",
    tone: "success",
    icon: ClipboardCheck,
  },
  {
    title: "Pendências",
    value: "14",
    helper: "Demandam ação",
    change: "4 críticas",
    tone: "warning",
    icon: AlertTriangle,
  },
  {
    title: "Atualizados",
    value: "92%",
    helper: "Com auditoria recente",
    change: "+3 p.p.",
    tone: "info",
    icon: ShieldCheck,
  },
];

export const moduleConfigs: Record<string, ModuleConfig> = {
  fornecedores: {
    slug: "fornecedores",
    title: "Fornecedores",
    eyebrow: "Compras e cadastro",
    description: "Cadastro de fornecedores, contatos, anexos, contratos e histórico operacional.",
    primaryAction: { label: "Novo fornecedor", href: "/fornecedores/novo" },
    metrics: [
      { ...baseMetrics[0], value: "312", title: "Fornecedores ativos", icon: Building2 },
      { ...baseMetrics[1], value: "18", title: "Sem documentação" },
      { ...baseMetrics[2], value: "74", title: "Com contrato vigente" },
    ],
    table: {
      columns: ["Razão social", "Categoria", "Contato", "Telefone", "Status"],
      rows: [
        { "Razão social": "TopFrio Climatização", Categoria: "Manutenção", Contato: "Marina Lopes", Telefone: "(11) 4002-1188", Status: "ATIVO" },
        { "Razão social": "Grupo Protege CD", Categoria: "Vigilância", Contato: "Rafael Lima", Telefone: "(11) 3200-9012", Status: "ATIVO" },
        { "Razão social": "CleanMax Serviços", Categoria: "Limpeza", Contato: "Bianca Souza", Telefone: "(11) 2100-1000", Status: "PENDENTE" },
      ],
    },
    statuses: ["ATIVO", "PENDENTE", "INATIVO"],
    formSections: [
      { title: "Dados cadastrais", fields: ["Razão social", "Nome fantasia", "CNPJ", "Categoria"] },
      { title: "Contato", fields: ["E-mail", "Telefone", "Contato responsável", "Observações"] },
    ],
  },
  produtos: {
    slug: "produtos",
    title: "Produtos",
    eyebrow: "Catálogo administrativo",
    description: "Itens e materiais vinculados a fornecedores, preço histórico e lead time.",
    primaryAction: { label: "Novo produto", href: "/produtos/novo" },
    metrics: [
      { ...baseMetrics[0], value: "486", title: "Produtos ativos", icon: ClipboardCheck },
      { ...baseMetrics[1], value: "39", title: "Sem fornecedor" },
      { ...baseMetrics[2], value: "67%", title: "Com preço recente" },
    ],
    table: {
      columns: ["SKU", "Produto", "Categoria", "Unidade", "Status"],
      rows: [
        { SKU: "ADM-EP-019", Produto: "Luva nitrílica", Categoria: "EPI", Unidade: "CX", Status: "ATIVO" },
        { SKU: "FAC-LP-044", Produto: "Lâmpada LED 40W", Categoria: "Facilities", Unidade: "UN", Status: "ATIVO" },
        { SKU: "MAN-OL-882", Produto: "Óleo hidráulico", Categoria: "Manutenção", Unidade: "LT", Status: "REVISAR" },
      ],
    },
    statuses: ["ATIVO", "REVISAR", "INATIVO"],
    formSections: [
      { title: "Dados do produto", fields: ["SKU", "Nome", "Categoria", "Unidade"] },
      { title: "Vínculo fornecedor", fields: ["Fornecedor", "SKU fornecedor", "Último preço", "Lead time"] },
    ],
  },
  contratos: {
    slug: "contratos",
    title: "Contratos",
    eyebrow: "Governança financeira",
    description: "Contratos por fornecedor, vencimento, reajuste, SLA e anexos.",
    primaryAction: { label: "Novo contrato", href: "/contratos/novo" },
    metrics: [
      { ...baseMetrics[0], value: "74", title: "Contratos ativos", icon: FileSignature },
      { ...baseMetrics[1], value: "9", title: "Vencendo em 30 dias" },
      { ...baseMetrics[2], value: "R$ 326 mil", title: "Mensalidade total" },
    ],
    table: {
      columns: ["Fornecedor", "Título", "Fim", "Valor mensal", "Status"],
      rows: [
        { Fornecedor: "Grupo Protege CD", Título: "Vigilância patrimonial", Fim: "29/06/2026", "Valor mensal": "R$ 68.000,00", Status: "VENCENDO" },
        { Fornecedor: "CleanMax Serviços", Título: "Limpeza operacional", Fim: "12/08/2026", "Valor mensal": "R$ 18.400,00", Status: "ATIVO" },
        { Fornecedor: "NetCorp", Título: "Link dedicado", Fim: "01/07/2026", "Valor mensal": "R$ 3.980,00", Status: "VENCENDO" },
      ],
    },
    statuses: ["ATIVO", "VENCENDO", "VENCIDO", "ENCERRADO"],
    formSections: [
      { title: "Contrato", fields: ["Fornecedor", "Título", "Categoria", "SLA"] },
      { title: "Financeiro", fields: ["Data início", "Data fim", "Valor mensal", "Reajuste"] },
    ],
  },
  despesas: {
    slug: "despesas",
    title: "Despesas",
    eyebrow: "Contas a pagar",
    description: "Despesas fixas e variáveis com vencimento, centro de custo e comprovantes.",
    primaryAction: { label: "Nova despesa", href: "/despesas/nova" },
    metrics: [
      { ...baseMetrics[0], value: "R$ 184.920", title: "Total do mês", icon: ReceiptText },
      { ...baseMetrics[1], value: "37", title: "Pendentes" },
      { ...baseMetrics[2], value: "12", title: "Vencidas" },
    ],
    table: {
      columns: ["Vencimento", "Fornecedor", "Categoria", "Valor", "Status"],
      rows: [
        { Vencimento: "19/06/2026", Fornecedor: "Energia SP", Categoria: "Energia", Valor: "R$ 42.880,00", Status: "VENCIDO" },
        { Vencimento: "21/06/2026", Fornecedor: "CleanMax Serviços", Categoria: "Limpeza", Valor: "R$ 18.400,00", Status: "PENDENTE" },
        { Vencimento: "25/06/2026", Fornecedor: "NetCorp", Categoria: "Internet", Valor: "R$ 3.980,00", Status: "PENDENTE" },
      ],
    },
    statuses: ["PENDENTE", "PAGO", "VENCIDO", "CANCELADO"],
    formSections: [
      { title: "Despesa", fields: ["Fornecedor", "Contrato", "Categoria", "Descrição"] },
      { title: "Pagamento", fields: ["Data de vencimento", "Valor", "Centro de custo", "Recorrência"] },
    ],
  },
  pagamentos: {
    slug: "pagamentos",
    title: "Pagamentos",
    eyebrow: "Baixas financeiras",
    description: "Registro de pagamentos, comprovantes e auditoria de baixas.",
    primaryAction: { label: "Registrar pagamento", href: "/pagamentos/novo" },
    metrics: [
      { ...baseMetrics[0], value: "R$ 92.510", title: "Pago no mês", icon: Banknote },
      { ...baseMetrics[1], value: "7", title: "Aguardando comprovante" },
      { ...baseMetrics[2], value: "98%", title: "Baixas conciliadas" },
    ],
    table: {
      columns: ["Data", "Fornecedor", "Despesa", "Valor", "Status"],
      rows: [
        { Data: "15/06/2026", Fornecedor: "CleanMax Serviços", Despesa: "Limpeza mensal", Valor: "R$ 18.400,00", Status: "PAGO" },
        { Data: "14/06/2026", Fornecedor: "TopFrio", Despesa: "Manutenção AC", Valor: "R$ 8.750,00", Status: "PAGO" },
        { Data: "13/06/2026", Fornecedor: "NetCorp", Despesa: "Link dedicado", Valor: "R$ 3.980,00", Status: "PAGO" },
      ],
    },
    statuses: ["PAGO", "PENDENTE", "ESTORNADO"],
    formSections: [
      { title: "Pagamento", fields: ["Despesa", "Data pagamento", "Valor pago", "Forma de pagamento"] },
      { title: "Comprovante", fields: ["Arquivo", "Observações"] },
    ],
  },
  compras: {
    slug: "compras",
    title: "Requisições de Compra",
    eyebrow: "Compras administrativas",
    description: "Solicitações, prioridades, aprovações e recebimento de compras do CD.",
    primaryAction: { label: "Nova requisição", href: "/compras/nova" },
    metrics: [
      { ...baseMetrics[0], value: "42", title: "Requisições abertas", icon: ShoppingCart },
      { ...baseMetrics[1], value: "11", title: "Aguardando aprovação" },
      { ...baseMetrics[2], value: "R$ 57.600", title: "Em andamento" },
    ],
    table: {
      columns: ["Número", "Título", "Solicitante", "Prioridade", "Status"],
      rows: [
        { Número: "REQ-1042", Título: "Reposição de EPI", Solicitante: "Operação CD", Prioridade: "ALTA", Status: "EM_COTACAO" },
        { Número: "REQ-1041", Título: "Material escritório", Solicitante: "Administrativo", Prioridade: "MEDIA", Status: "ABERTA" },
        { Número: "REQ-1038", Título: "Peças empilhadeira", Solicitante: "Manutenção", Prioridade: "ALTA", Status: "AGUARDANDO_APROVACAO" },
      ],
    },
    statuses: ["ABERTA", "EM_COTACAO", "AGUARDANDO_APROVACAO", "APROVADA"],
    formSections: [
      { title: "Requisição", fields: ["Título", "Descrição", "Categoria", "Quantidade"] },
      { title: "Necessidade", fields: ["Unidade", "Necessário até", "Centro de custo", "Prioridade"] },
    ],
  },
  cotacoes: {
    slug: "cotacoes",
    title: "Cotações e Aprovações",
    eyebrow: "Comparativo de propostas",
    description: "Análise de fornecedores, valores, prazos e aprovação de cotações.",
    primaryAction: { label: "Nova cotação", href: "/cotacoes/nova" },
    metrics: [
      { ...baseMetrics[0], value: "18", title: "Em análise", icon: ShoppingCart },
      { ...baseMetrics[1], value: "5", title: "Sem proposta" },
      { ...baseMetrics[2], value: "12%", title: "Economia média" },
    ],
    table: {
      columns: ["Requisição", "Fornecedor", "Valor", "Prazo", "Status"],
      rows: [
        { Requisição: "REQ-1042", Fornecedor: "EPI Total", Valor: "R$ 9.840,00", Prazo: "3 dias", Status: "MENOR_PRECO" },
        { Requisição: "REQ-1042", Fornecedor: "SupplyPro", Valor: "R$ 10.120,00", Prazo: "2 dias", Status: "MENOR_PRAZO" },
        { Requisição: "REQ-1038", Fornecedor: "HidraParts", Valor: "R$ 18.600,00", Prazo: "7 dias", Status: "EM_ANALISE" },
      ],
    },
    statuses: ["EM_ANALISE", "APROVADA", "REPROVADA"],
    formSections: [
      { title: "Cotação", fields: ["Requisição", "Fornecedor", "Valor", "Prazo entrega"] },
      { title: "Proposta", fields: ["Arquivo", "Observações", "Status"] },
    ],
  },
  manutencao: {
    slug: "manutencao",
    title: "Manutenção",
    eyebrow: "Facilities e ordens de serviço",
    description: "Ordens preventivas e corretivas por área, prioridade, custo e evidências.",
    primaryAction: { label: "Nova OS", href: "/manutencao/nova" },
    metrics: [
      { ...baseMetrics[0], value: "24", title: "OS abertas", icon: Wrench },
      { ...baseMetrics[1], value: "6", title: "Atrasadas" },
      { ...baseMetrics[2], value: "R$ 41.200", title: "Custo estimado" },
    ],
    table: {
      columns: ["Número", "Área", "Tipo", "Prazo", "Status"],
      rows: [
        { Número: "OS-1042", Área: "Docas", Tipo: "CORRETIVA", Prazo: "20/06/2026", Status: "EM_ANDAMENTO" },
        { Número: "OS-1039", Área: "Câmara fria", Tipo: "PREVENTIVA", Prazo: "22/06/2026", Status: "ABERTA" },
        { Número: "OS-1035", Área: "Cobertura", Tipo: "CORRETIVA", Prazo: "18/06/2026", Status: "ATRASADA" },
      ],
    },
    statuses: ["ABERTA", "INICIADA", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "FINALIZADA"],
    formSections: [
      { title: "Ordem de serviço", fields: ["Área", "Tipo", "Prioridade", "Descrição"] },
      { title: "Execução", fields: ["Fornecedor", "Data abertura", "Prazo", "Custo estimado"] },
    ],
  },
  tarefas: {
    slug: "tarefas",
    title: "Tarefas e Checklists",
    eyebrow: "Plano de ação",
    description: "Tarefas recorrentes, checklists mensais e evidências do plano de ação.",
    primaryAction: { label: "Nova tarefa", href: "/tarefas/nova" },
    metrics: [
      { ...baseMetrics[0], value: "86", title: "Tarefas ativas", icon: ListTodo },
      { ...baseMetrics[1], value: "18", title: "Atrasadas" },
      { ...baseMetrics[2], value: "71%", title: "Concluídas no prazo" },
    ],
    table: {
      columns: ["Título", "Área", "Responsável", "Vencimento", "Status"],
      rows: [
        { Título: "Fechamento financeiro", Área: "Financeiro", Responsável: "Ana", Vencimento: "30/06/2026", Status: "EM_ANDAMENTO" },
        { Título: "Vistoria docas", Área: "Facilities", Responsável: "Carlos", Vencimento: "18/06/2026", Status: "ATRASADA" },
        { Título: "Auditoria fornecedor", Área: "Compras", Responsável: "Marina", Vencimento: "27/06/2026", Status: "NAO_INICIADA" },
      ],
    },
    statuses: ["NAO_INICIADA", "EM_ANDAMENTO", "CONCLUIDA", "ATRASADA"],
    formSections: [
      { title: "Tarefa", fields: ["Título", "Detalhes", "Área", "Prioridade"] },
      { title: "Planejamento", fields: ["Responsável", "Início", "Vencimento", "Recorrência"] },
    ],
  },
  checklists: {
    slug: "checklists",
    title: "Checklists",
    eyebrow: "Rotinas mensais",
    description: "Templates e execuções mensais para fechamento, infraestrutura e auditorias.",
    primaryAction: { label: "Novo checklist", href: "/checklists/novo" },
    metrics: [
      { ...baseMetrics[0], value: "7", title: "Templates ativos", icon: ClipboardCheck },
      { ...baseMetrics[1], value: "5", title: "Itens pendentes" },
      { ...baseMetrics[2], value: "82%", title: "Execução mensal" },
    ],
    table: {
      columns: ["Template", "Área", "Período", "Responsável", "Status"],
      rows: [
        { Template: "Fechamento financeiro", Área: "Financeiro", Período: "06/2026", Responsável: "Ana", Status: "EM_ANDAMENTO" },
        { Template: "Vistoria infraestrutura", Área: "Facilities", Período: "06/2026", Responsável: "Carlos", Status: "PENDENTE" },
        { Template: "Auditoria fornecedores", Área: "Compras", Período: "06/2026", Responsável: "Marina", Status: "CONCLUIDO" },
      ],
    },
    statuses: ["PENDENTE", "EM_ANDAMENTO", "CONCLUIDO"],
    formSections: [
      { title: "Template", fields: ["Título", "Área", "Recorrência", "Ativo"] },
      { title: "Execução", fields: ["Período", "Responsável", "Evidência", "Observações"] },
    ],
  },
  usuarios: {
    slug: "usuarios",
    title: "Usuários e Perfis",
    eyebrow: "RBAC",
    description: "Usuários, perfis, vínculo com CD, status e permissões operacionais.",
    primaryAction: { label: "Convidar usuário", href: "/usuarios/novo" },
    metrics: [
      { ...baseMetrics[0], value: "38", title: "Usuários ativos", icon: UsersRound },
      { ...baseMetrics[1], value: "3", title: "Convites pendentes" },
      { ...baseMetrics[2], value: "7", title: "Perfis configurados" },
    ],
    table: {
      columns: ["Nome", "E-mail", "Cargo", "Perfil", "Status"],
      rows: [
        { Nome: "Ana Financeiro", "E-mail": "ana@maxcontrol.local", Cargo: "Analista", Perfil: "FINANCEIRO", Status: "ATIVO" },
        { Nome: "Carlos Manutenção", "E-mail": "carlos@maxcontrol.local", Cargo: "Supervisor", Perfil: "MANUTENCAO", Status: "ATIVO" },
        { Nome: "Marina Compras", "E-mail": "marina@maxcontrol.local", Cargo: "Compradora", Perfil: "COMPRAS", Status: "ATIVO" },
      ],
    },
    statuses: ["ATIVO", "INATIVO", "CONVIDADO"],
    formSections: [
      { title: "Usuário", fields: ["Nome", "E-mail", "Telefone", "Cargo"] },
      { title: "Acesso", fields: ["Perfil", "CD", "Ativo"] },
    ],
  },
  notificacoes: {
    slug: "notificacoes",
    title: "Notificações",
    eyebrow: "Alertas internos",
    description: "Vencimentos, atrasos e aprovações pendentes gerados pelo sistema.",
    metrics: [
      { ...baseMetrics[0], value: "43", title: "Não lidas", icon: AlertTriangle },
      { ...baseMetrics[1], value: "12", title: "Críticas" },
      { ...baseMetrics[2], value: "31", title: "Resolvidas no mês" },
    ],
    table: {
      columns: ["Tipo", "Título", "Entidade", "Criado em", "Status"],
      rows: [
        { Tipo: "Despesa", Título: "Conta vencida", Entidade: "DESP-882", "Criado em": "17/06/2026", Status: "NAO_LIDA" },
        { Tipo: "Contrato", Título: "Contrato vencendo", Entidade: "CONT-204", "Criado em": "16/06/2026", Status: "NAO_LIDA" },
        { Tipo: "OS", Título: "OS atrasada", Entidade: "OS-1035", "Criado em": "15/06/2026", Status: "LIDA" },
      ],
    },
    statuses: ["NAO_LIDA", "LIDA", "RESOLVIDA"],
    formSections: [],
  },
  relatorios: {
    slug: "relatorios",
    title: "Relatórios",
    eyebrow: "Análises e exportação",
    description: "Visões financeiras, contratos, compras e manutenção com filtros por período.",
    metrics: [
      { ...baseMetrics[0], value: "6", title: "Relatórios ativos", icon: ClipboardCheck },
      { ...baseMetrics[1], value: "2", title: "Exportações pendentes" },
      { ...baseMetrics[2], value: "100%", title: "Filtros por CD" },
    ],
    table: {
      columns: ["Relatório", "Período", "Área", "Atualizado", "Status"],
      rows: [
        { Relatório: "Despesas por categoria", Período: "06/2026", Área: "Financeiro", Atualizado: "Hoje", Status: "PRONTO" },
        { Relatório: "Contratos vencendo", Período: "30 dias", Área: "Gestão", Atualizado: "Hoje", Status: "PRONTO" },
        { Relatório: "Manutenção por área", Período: "06/2026", Área: "Facilities", Atualizado: "Ontem", Status: "PRONTO" },
      ],
    },
    statuses: ["PRONTO", "PROCESSANDO"],
    formSections: [],
  },
  configuracoes: {
    slug: "configuracoes",
    title: "Configurações",
    eyebrow: "Sistema",
    description: "Dados do CD, categorias, centros de custo, alertas e preferências globais.",
    metrics: [
      { ...baseMetrics[0], value: "1", title: "CD principal", icon: Building2 },
      { ...baseMetrics[1], value: "4", title: "Regras incompletas" },
      { ...baseMetrics[2], value: "26", title: "Categorias ativas" },
    ],
    table: {
      columns: ["Configuração", "Valor", "Escopo", "Atualizado", "Status"],
      rows: [
        { Configuração: "Dias alerta contrato", Valor: "30, 15, 7", Escopo: "CD", Atualizado: "Hoje", Status: "ATIVO" },
        { Configuração: "Centros de custo", Valor: "14 ativos", Escopo: "CD", Atualizado: "Ontem", Status: "ATIVO" },
        { Configuração: "Storage anexos", Valor: "cd-anexos", Escopo: "Global", Atualizado: "Hoje", Status: "PENDENTE" },
      ],
    },
    statuses: ["ATIVO", "PENDENTE"],
    formSections: [
      { title: "CD", fields: ["Nome", "Código", "Ativo"] },
      { title: "Alertas", fields: ["Despesas", "Contratos", "Tarefas", "OS"] },
    ],
  },
  auditoria: {
    slug: "auditoria",
    title: "Auditoria",
    eyebrow: "Rastreabilidade",
    description: "Linha do tempo de alterações críticas por usuário, entidade e CD.",
    metrics: [
      { ...baseMetrics[0], value: "1.248", title: "Eventos no mês", icon: ShieldCheck },
      { ...baseMetrics[1], value: "18", title: "Ações críticas" },
      { ...baseMetrics[2], value: "100%", title: "Com user_id" },
    ],
    table: {
      columns: ["Data", "Usuário", "Entidade", "Ação", "Status"],
      rows: [
        { Data: "17/06/2026 10:22", Usuário: "Ana", Entidade: "despesas", Ação: "PAGAMENTO_REGISTRADO", Status: "OK" },
        { Data: "17/06/2026 09:41", Usuário: "Carlos", Entidade: "ordens_servico", Ação: "EVIDENCIA_ANEXADA", Status: "OK" },
        { Data: "16/06/2026 18:12", Usuário: "Marina", Entidade: "cotacoes", Ação: "APROVACAO", Status: "OK" },
      ],
    },
    statuses: ["OK", "CRITICO"],
    formSections: [],
  },
  perfil: {
    slug: "perfil",
    title: "Perfil",
    eyebrow: "Minha conta",
    description: "Dados pessoais, cargo, perfil de acesso e preferências do usuário atual.",
    metrics: [
      { ...baseMetrics[0], value: "ADMIN_MASTER", title: "Perfil", icon: UsersRound },
      { ...baseMetrics[1], value: "CD Principal", title: "CD padrão" },
      { ...baseMetrics[2], value: "Ativo", title: "Status da conta" },
    ],
    table: {
      columns: ["Campo", "Valor", "Status"],
      rows: [
        { Campo: "Nome", Valor: currentUser.name, Status: "ATIVO" },
        { Campo: "E-mail", Valor: currentUser.email, Status: "VERIFICAR_SUPABASE" },
        { Campo: "Tema", Valor: "Persistido no navegador", Status: "ATIVO" },
      ],
    },
    statuses: ["ATIVO", "VERIFICAR_SUPABASE"],
    formSections: [
      { title: "Perfil", fields: ["Nome", "E-mail", "Telefone", "Cargo"] },
      { title: "Preferências", fields: ["Tema", "Avatar"] },
    ],
  },
};

export const chartRows = [
  { label: "Energia", value: 42 },
  { label: "Limpeza", value: 28 },
  { label: "Manutenção", value: 22 },
  { label: "Internet", value: 8 },
];

export function getModuleConfig(slug: string) {
  return moduleConfigs[slug];
}

export function getKnownSlugs() {
  return Object.keys(moduleConfigs);
}
