export type NavigationItem = {
  title: string;
  href: string;
  icon: string;
  roles: string[];
};

export type NavigationSection = {
  title: string;
  items: NavigationItem[];
};

export const navigationSections: NavigationSection[] = [
  {
    title: "Operacao",
    items: [
      {
        title: "Dashboard",
        href: "/dashboard",
        icon: "LayoutDashboard",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "FINANCEIRO", "COMPRAS", "MANUTENCAO", "LEITURA"],
      },
      {
        title: "Despesas",
        href: "/despesas",
        icon: "ReceiptText",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "FINANCEIRO"],
      },
      {
        title: "Pagamentos",
        href: "/pagamentos",
        icon: "WalletCards",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "FINANCEIRO"],
      },
      {
        title: "Contratos",
        href: "/contratos",
        icon: "FileSignature",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "FINANCEIRO"],
      },
    ],
  },
  {
    title: "Compras",
    items: [
      {
        title: "Fornecedores",
        href: "/fornecedores",
        icon: "Building2",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "COMPRAS"],
      },
      {
        title: "Produtos",
        href: "/produtos",
        icon: "Boxes",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "COMPRAS"],
      },
      {
        title: "Requisicoes",
        href: "/compras",
        icon: "ShoppingCart",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "COMPRAS"],
      },
      {
        title: "Cotacoes",
        href: "/cotacoes",
        icon: "BadgeCheck",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "COMPRAS"],
      },
    ],
  },
  {
    title: "Facilities",
    items: [
      {
        title: "Manutencao",
        href: "/manutencao",
        icon: "Wrench",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "MANUTENCAO"],
      },
      {
        title: "Tarefas",
        href: "/tarefas",
        icon: "ListTodo",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "MANUTENCAO", "LEITURA"],
      },
      {
        title: "Checklists",
        href: "/checklists",
        icon: "ClipboardCheck",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "MANUTENCAO", "LEITURA"],
      },
    ],
  },
  {
    title: "Gestao",
    items: [
      {
        title: "Usuarios",
        href: "/usuarios",
        icon: "UsersRound",
        roles: ["ADMIN_MASTER", "ADMIN"],
      },
      {
        title: "Notificacoes",
        href: "/notificacoes",
        icon: "Bell",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "FINANCEIRO", "COMPRAS", "MANUTENCAO", "LEITURA"],
      },
      {
        title: "Relatorios",
        href: "/relatorios",
        icon: "ChartNoAxesColumn",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD", "FINANCEIRO"],
      },
      {
        title: "Auditoria",
        href: "/auditoria",
        icon: "ShieldCheck",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD"],
      },
      {
        title: "Configuracoes",
        href: "/configuracoes",
        icon: "Settings",
        roles: ["ADMIN_MASTER", "ADMIN", "GERENTE_CD"],
      },
    ],
  },
];

export const flatNavigationItems = navigationSections.flatMap((section) => section.items);
