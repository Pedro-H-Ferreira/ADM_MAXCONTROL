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

type ModuleSeed = Omit<ModuleConfig, "metrics" | "table"> & {
  icon: LucideIcon;
  columns: string[];
};

export const currentUser = {
  name: "Usuario ADM",
  email: "",
  role: "Aguardando Auth",
  cd: "CD nao sincronizado",
};

function awaitingMetric(title: string, icon: LucideIcon): StatItem {
  return {
    title,
    value: "0",
    helper: "Aguardando dados reais",
    change: "Sem sincronizacao",
    tone: "info",
    icon,
  };
}

function createModule(seed: ModuleSeed): ModuleConfig {
  return {
    slug: seed.slug,
    title: seed.title,
    eyebrow: seed.eyebrow,
    description: seed.description,
    primaryAction: seed.primaryAction,
    statuses: seed.statuses,
    formSections: seed.formSections,
    metrics: [
      awaitingMetric("Registros reais", seed.icon),
      awaitingMetric("Pendencias reais", AlertTriangle),
      awaitingMetric("Ultima sincronizacao", ShieldCheck),
    ],
    table: {
      columns: seed.columns,
      rows: [],
    },
  };
}

export const dashboardStats: StatItem[] = [
  awaitingMetric("Despesas do mes", ReceiptText),
  awaitingMetric("Contas pendentes", Banknote),
  awaitingMetric("Contratos vencendo", FileSignature),
  awaitingMetric("OS abertas", Wrench),
  awaitingMetric("Tarefas atrasadas", ListTodo),
  awaitingMetric("Fornecedores ativos", Building2),
];

export const dashboardAlerts: { title: string; detail: string; tone: Tone }[] = [];
export const upcomingPayments: string[][] = [];
export const recentActivities: string[] = [];
export const chartRows: { label: string; value: number }[] = [];

export const moduleConfigs: Record<string, ModuleConfig> = {
  fornecedores: createModule({
    slug: "fornecedores",
    title: "Fornecedores",
    eyebrow: "Compras e cadastro",
    description: "Cadastro de fornecedores, contatos, anexos, contratos e historico operacional.",
    primaryAction: { label: "Novo fornecedor", href: "/fornecedores/novo" },
    icon: Building2,
    columns: ["Razao social", "Categoria", "Contato", "Telefone", "Status"],
    statuses: ["ATIVO", "PENDENTE", "INATIVO"],
    formSections: [
      { title: "Dados cadastrais", fields: ["Razao social", "Nome fantasia", "CNPJ", "Categoria"] },
      { title: "Contato", fields: ["E-mail", "Telefone", "Contato responsavel", "Observacoes"] },
    ],
  }),
  produtos: createModule({
    slug: "produtos",
    title: "Produtos",
    eyebrow: "Catalogo administrativo",
    description: "Itens e materiais vinculados a fornecedores, preco historico e lead time.",
    primaryAction: { label: "Novo produto", href: "/produtos/novo" },
    icon: ClipboardCheck,
    columns: ["SKU", "Produto", "Categoria", "Unidade", "Status"],
    statuses: ["ATIVO", "REVISAR", "INATIVO"],
    formSections: [
      { title: "Dados do produto", fields: ["SKU", "Nome", "Categoria", "Unidade"] },
      { title: "Vinculo fornecedor", fields: ["Fornecedor", "SKU fornecedor", "Ultimo preco", "Lead time"] },
    ],
  }),
  contratos: createModule({
    slug: "contratos",
    title: "Contratos",
    eyebrow: "Governanca financeira",
    description: "Contratos por fornecedor, vencimento, reajuste, SLA e anexos.",
    primaryAction: { label: "Novo contrato", href: "/contratos/novo" },
    icon: FileSignature,
    columns: ["Fornecedor", "Titulo", "Fim", "Valor mensal", "Status"],
    statuses: ["ATIVO", "VENCENDO", "VENCIDO", "ENCERRADO"],
    formSections: [
      { title: "Contrato", fields: ["Fornecedor", "Titulo", "Categoria", "SLA"] },
      { title: "Financeiro", fields: ["Data inicio", "Data fim", "Valor mensal", "Reajuste"] },
    ],
  }),
  despesas: createModule({
    slug: "despesas",
    title: "Despesas",
    eyebrow: "Contas a pagar",
    description: "Despesas fixas e variaveis com vencimento, centro de custo e comprovantes.",
    primaryAction: { label: "Nova despesa", href: "/despesas/nova" },
    icon: ReceiptText,
    columns: ["Vencimento", "Fornecedor", "Categoria", "Valor", "Status"],
    statuses: ["PENDENTE", "PAGO", "VENCIDO", "CANCELADO"],
    formSections: [
      { title: "Despesa", fields: ["Fornecedor", "Contrato", "Categoria", "Descricao"] },
      { title: "Pagamento", fields: ["Data de vencimento", "Valor", "Centro de custo", "Recorrencia"] },
    ],
  }),
  pagamentos: createModule({
    slug: "pagamentos",
    title: "Pagamentos",
    eyebrow: "Baixas financeiras",
    description: "Registro de pagamentos, comprovantes e auditoria de baixas.",
    primaryAction: { label: "Registrar pagamento", href: "/pagamentos#novo-lancamento-fluig" },
    icon: Banknote,
    columns: ["Data", "Fornecedor", "Despesa", "Valor", "Status"],
    statuses: ["PAGO", "PENDENTE", "ESTORNADO"],
    formSections: [
      { title: "Pagamento", fields: ["Despesa", "Data pagamento", "Valor pago", "Forma de pagamento"] },
      { title: "Comprovante", fields: ["Arquivo", "Observacoes"] },
    ],
  }),
  compras: createModule({
    slug: "compras",
    title: "Requisicoes de Compra",
    eyebrow: "Compras administrativas",
    description: "Solicitacoes, prioridades, aprovacoes e recebimento de compras do CD.",
    primaryAction: { label: "Nova requisicao", href: "/compras#novo-lancamento-fluig" },
    icon: ShoppingCart,
    columns: ["Numero", "Titulo", "Solicitante", "Prioridade", "Status"],
    statuses: ["ABERTA", "EM_COTACAO", "AGUARDANDO_APROVACAO", "APROVADA"],
    formSections: [
      { title: "Requisicao", fields: ["Titulo", "Descricao", "Categoria", "Quantidade"] },
      { title: "Necessidade", fields: ["Unidade", "Necessario ate", "Centro de custo", "Prioridade"] },
    ],
  }),
  cotacoes: createModule({
    slug: "cotacoes",
    title: "Cotacoes e Aprovacoes",
    eyebrow: "Comparativo de propostas",
    description: "Analise de fornecedores, valores, prazos e aprovacao de cotacoes.",
    primaryAction: { label: "Nova cotacao", href: "/cotacoes/nova" },
    icon: ShoppingCart,
    columns: ["Requisicao", "Fornecedor", "Valor", "Prazo", "Status"],
    statuses: ["EM_ANALISE", "APROVADA", "REPROVADA"],
    formSections: [
      { title: "Cotacao", fields: ["Requisicao", "Fornecedor", "Valor", "Prazo entrega"] },
      { title: "Proposta", fields: ["Arquivo", "Observacoes", "Status"] },
    ],
  }),
  manutencao: createModule({
    slug: "manutencao",
    title: "Manutencao",
    eyebrow: "Facilities e ordens de servico",
    description: "Ordens preventivas e corretivas por area, prioridade, custo e evidencias.",
    primaryAction: { label: "Nova OS", href: "/manutencao/nova" },
    icon: Wrench,
    columns: ["Numero", "Area", "Tipo", "Prazo", "Status"],
    statuses: ["ABERTA", "INICIADA", "AGUARDANDO_MATERIAL", "AGUARDANDO_TERCEIRO", "FINALIZADA"],
    formSections: [
      { title: "Ordem de servico", fields: ["Area", "Tipo", "Prioridade", "Descricao"] },
      { title: "Execucao", fields: ["Fornecedor", "Data abertura", "Prazo", "Custo estimado"] },
    ],
  }),
  tarefas: createModule({
    slug: "tarefas",
    title: "Tarefas e Checklists",
    eyebrow: "Plano de acao",
    description: "Tarefas recorrentes, checklists mensais e evidencias do plano de acao.",
    primaryAction: { label: "Nova tarefa", href: "/tarefas/nova" },
    icon: ListTodo,
    columns: ["Titulo", "Area", "Responsavel", "Vencimento", "Status"],
    statuses: ["NAO_INICIADA", "EM_ANDAMENTO", "CONCLUIDA", "ATRASADA"],
    formSections: [
      { title: "Tarefa", fields: ["Titulo", "Detalhes", "Area", "Prioridade"] },
      { title: "Planejamento", fields: ["Responsavel", "Inicio", "Vencimento", "Recorrencia"] },
    ],
  }),
  checklists: createModule({
    slug: "checklists",
    title: "Checklists",
    eyebrow: "Rotinas mensais",
    description: "Templates e execucoes mensais para fechamento, infraestrutura e auditorias.",
    primaryAction: { label: "Novo checklist", href: "/checklists/novo" },
    icon: ClipboardCheck,
    columns: ["Template", "Area", "Periodo", "Responsavel", "Status"],
    statuses: ["PENDENTE", "EM_ANDAMENTO", "CONCLUIDO"],
    formSections: [
      { title: "Template", fields: ["Titulo", "Area", "Recorrencia", "Ativo"] },
      { title: "Execucao", fields: ["Periodo", "Responsavel", "Evidencia", "Observacoes"] },
    ],
  }),
  usuarios: createModule({
    slug: "usuarios",
    title: "Usuarios e Perfis",
    eyebrow: "RBAC",
    description: "Usuarios, perfis, vinculo com CD, status e permissoes operacionais.",
    primaryAction: { label: "Convidar usuario", href: "/usuarios/novo" },
    icon: UsersRound,
    columns: ["Nome", "E-mail", "Cargo", "Perfil", "Status"],
    statuses: ["ATIVO", "INATIVO", "CONVIDADO"],
    formSections: [
      { title: "Usuario", fields: ["Nome", "E-mail", "Telefone", "Cargo"] },
      { title: "Acesso", fields: ["Perfil", "CD", "Ativo"] },
    ],
  }),
  notificacoes: createModule({
    slug: "notificacoes",
    title: "Notificacoes",
    eyebrow: "Alertas internos",
    description: "Vencimentos, atrasos e aprovacoes pendentes gerados pelo sistema.",
    icon: AlertTriangle,
    columns: ["Tipo", "Titulo", "Entidade", "Criado em", "Status"],
    statuses: ["NAO_LIDA", "LIDA", "RESOLVIDA"],
    formSections: [],
  }),
  relatorios: createModule({
    slug: "relatorios",
    title: "Relatorios",
    eyebrow: "Analises e exportacao",
    description: "Visoes financeiras, contratos, compras e manutencao com filtros por periodo.",
    icon: ClipboardCheck,
    columns: ["Relatorio", "Periodo", "Area", "Atualizado", "Status"],
    statuses: ["PRONTO", "PROCESSANDO"],
    formSections: [],
  }),
  configuracoes: createModule({
    slug: "configuracoes",
    title: "Configuracoes",
    eyebrow: "Sistema",
    description: "Dados do CD, categorias, centros de custo, alertas e preferencias globais.",
    icon: Building2,
    columns: ["Configuracao", "Valor", "Escopo", "Atualizado", "Status"],
    statuses: ["ATIVO", "PENDENTE"],
    formSections: [
      { title: "CD", fields: ["Nome", "Codigo", "Ativo"] },
      { title: "Alertas", fields: ["Despesas", "Contratos", "Tarefas", "OS"] },
    ],
  }),
  auditoria: createModule({
    slug: "auditoria",
    title: "Auditoria",
    eyebrow: "Rastreabilidade",
    description: "Linha do tempo de alteracoes criticas por usuario, entidade e CD.",
    icon: ShieldCheck,
    columns: ["Data", "Usuario", "Entidade", "Acao", "Status"],
    statuses: ["OK", "CRITICO"],
    formSections: [],
  }),
  perfil: createModule({
    slug: "perfil",
    title: "Perfil",
    eyebrow: "Minha conta",
    description: "Dados pessoais, cargo, perfil de acesso e preferencias do usuario atual.",
    icon: UsersRound,
    columns: ["Campo", "Valor", "Status"],
    statuses: ["ATIVO", "VERIFICAR_SUPABASE"],
    formSections: [
      { title: "Perfil", fields: ["Nome", "E-mail", "Telefone", "Cargo"] },
      { title: "Preferencias", fields: ["Tema", "Avatar"] },
    ],
  }),
};

export function getModuleConfig(slug: string) {
  return moduleConfigs[slug];
}

export function getKnownSlugs() {
  return Object.keys(moduleConfigs);
}
