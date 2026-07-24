import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { DashboardOverview } from "@/components/pages/dashboard-overview";
import { ModulePage } from "@/components/pages/module-page";
import { Button } from "@/components/ui/button";
import { getKnownSlugs, getModuleConfig } from "@/lib/admin-data";
import { canActorAccessPage } from "@/lib/db/app-repository";
import { resolveCurrentAppUserForPage } from "@/lib/page-auth";

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
    { slug: ["pagamentos", "contas-mensais"] },
    { slug: ["compras", "nova"] },
    { slug: ["compras", "demo"] },
    { slug: ["manutencao", "nova"] },
    { slug: ["manutencao", "demo"] },
    { slug: ["tarefas", "nova"] },
    { slug: ["usuarios", "novo"] },
  ];

  return [...base, ...nested, { slug: ["dashboard"] }];
}

function AccessDeniedPage({ moduleTitle }: { moduleTitle: string }) {
  return (
    <section className="mx-auto flex min-h-[65vh] max-w-xl flex-col items-center justify-center px-6 text-center">
      <div className="grid size-12 place-items-center rounded-md bg-amber-50 text-amber-700 ring-1 ring-amber-200">
        <ShieldAlert className="size-6" aria-hidden="true" />
      </div>
      <p className="mt-5 font-mono text-xs uppercase text-muted-foreground">Acesso restrito</p>
      <h1 className="mt-2 text-2xl font-semibold">Sem permissao para {moduleTitle}</h1>
      <p className="mt-3 text-sm leading-6 text-muted-foreground">
        Seu usuario esta autenticado, mas esta pagina nao foi liberada no seu perfil. Solicite ao administrador a
        permissao de visualizacao deste modulo.
      </p>
      <Button asChild className="mt-6">
        <Link href="/dashboard">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar ao dashboard
        </Link>
      </Button>
    </section>
  );
}

export default async function AdminCatchAllPage({ params }: PageProps) {
  const { slug } = await params;
  const [moduleSlug, mode] = slug;
  const actor = await resolveCurrentAppUserForPage();
  const config = moduleSlug === "dashboard" ? null : getModuleConfig(moduleSlug);

  if (moduleSlug !== "dashboard" && !config) {
    notFound();
  }

  if (!canActorAccessPage(actor, moduleSlug)) {
    return <AccessDeniedPage moduleTitle={config?.title || "Dashboard"} />;
  }

  if (moduleSlug === "dashboard") {
    return <DashboardOverview actor={actor} />;
  }

  const normalizedMode = mode === "novo" || mode === "nova" ? "new" : mode ? "detail" : "list";

  return (
    <ModulePage
      config={config!}
      mode={normalizedMode}
      recordId={normalizedMode === "detail" ? mode : null}
    />
  );
}
