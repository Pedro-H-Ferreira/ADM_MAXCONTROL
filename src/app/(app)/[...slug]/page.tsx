import { notFound } from "next/navigation";
import { DashboardOverview } from "@/components/pages/dashboard-overview";
import { ModulePage } from "@/components/pages/module-page";
import { getKnownSlugs, getModuleConfig } from "@/lib/admin-data";
import { canActorAccessPage, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const dynamic = "force-dynamic";

type PageProps = {
  params: Promise<{
    slug: string[];
  }>;
};

export function generateStaticParams() {
  const base = getKnownSlugs().map((slug) => ({ slug: [slug] }));
  const nested = [
    { slug: ["fornecedores", "novo"] },
    { slug: ["fornecedores", "demo"] },
    { slug: ["produtos", "novo"] },
    { slug: ["produtos", "demo"] },
    { slug: ["contratos", "novo"] },
    { slug: ["contratos", "demo"] },
    { slug: ["despesas", "nova"] },
    { slug: ["despesas", "demo"] },
    { slug: ["compras", "nova"] },
    { slug: ["compras", "demo"] },
    { slug: ["manutencao", "nova"] },
    { slug: ["manutencao", "demo"] },
    { slug: ["tarefas", "nova"] },
    { slug: ["usuarios", "novo"] },
  ];

  return [...base, ...nested, { slug: ["dashboard"] }];
}

export default async function AdminCatchAllPage({ params }: PageProps) {
  const { slug } = await params;
  const [moduleSlug, mode] = slug;
  const actor = await resolveCurrentAppUser();

  if (!canActorAccessPage(actor, moduleSlug)) {
    notFound();
  }

  if (moduleSlug === "dashboard") {
    return <DashboardOverview />;
  }

  const config = getModuleConfig(moduleSlug);
  if (!config) {
    notFound();
  }

  const normalizedMode = mode === "novo" || mode === "nova" ? "new" : mode ? "detail" : "list";

  return <ModulePage config={config} mode={normalizedMode} />;
}
