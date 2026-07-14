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
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO", "COMPRAS", "MANUTENCAO", "LEITURA"],
      },
      {
        title: "Despesas",
        href: "/despesas",
        icon: "ReceiptText",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO"],
      },
      {
        title: "Pagamentos",
        href: "/pagamentos",
        icon: "WalletCards",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO"],
      },
      {
        title: "Controle de ADF",
        href: "/adfs",
        icon: "FileCheck2",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO", "COMPRAS"],
      },
      {
        title: "Contratos",
        href: "/contratos",
        icon: "FileSignature",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO"],
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
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "COMPRAS"],
      },
      {
        title: "Produtos",
        href: "/produtos",
        icon: "Boxes",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "COMPRAS"],
      },
      {
        title: "Requisicoes",
        href: "/compras",
        icon: "ShoppingCart",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "COMPRAS"],
      },
      {
        title: "Cotacoes",
        href: "/cotacoes",
        icon: "BadgeCheck",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "COMPRAS"],
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
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "MANUTENCAO"],
      },
      {
        title: "Tarefas",
        href: "/tarefas",
        icon: "ListTodo",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "MANUTENCAO", "LEITURA"],
      },
      {
        title: "Checklists",
        href: "/checklists",
        icon: "ClipboardCheck",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "MANUTENCAO", "LEITURA"],
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
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO", "COMPRAS", "MANUTENCAO", "LEITURA"],
      },
      {
        title: "Relatorios",
        href: "/relatorios",
        icon: "ChartNoAxesColumn",
        roles: ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO"],
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

export type NavigationPageOption = {
  slug: string;
  title: string;
  section: string;
  href: string;
  defaultRoles: string[];
};

export function pageSlugFromHref(href: string) {
  return href.replace(/^\/+/, "").split("/")[0] || "dashboard";
}

const allRoles = ["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO", "GERENTE_CD", "FINANCEIRO", "COMPRAS", "MANUTENCAO", "LEITURA"];

export const navigationPageOptions: NavigationPageOption[] = [
  ...navigationSections.flatMap((section) =>
    section.items.map((item) => ({
      slug: pageSlugFromHref(item.href),
      title: item.title,
      section: section.title,
      href: item.href,
      defaultRoles: item.roles,
    }))
  ),
  {
    slug: "perfil",
    title: "Perfil",
    section: "Conta",
    href: "/perfil",
    defaultRoles: allRoles,
  },
];

export const allNavigationPageSlugs = navigationPageOptions.map((page) => page.slug);

export function getDefaultPageSlugsForRole(role: string) {
  const pages = navigationPageOptions
    .filter((page) => page.defaultRoles.includes(role))
    .map((page) => page.slug);

  return Array.from(new Set(["dashboard", "perfil", ...pages]));
}

export function filterNavigationSectionsForAccess(pageSlugs: string[] | null | undefined) {
  if (!pageSlugs?.length) return navigationSections;

  const allowed = new Set(pageSlugs);
  return navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) => allowed.has(pageSlugFromHref(item.href))),
    }))
    .filter((section) => section.items.length > 0);
}

export function isKnownNavigationPage(slug: string) {
  return allNavigationPageSlugs.includes(slug);
}
