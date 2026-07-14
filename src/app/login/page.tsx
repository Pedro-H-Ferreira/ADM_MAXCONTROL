import Image from "next/image";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type LoginPageProps = {
  searchParams?: Promise<{
    status?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};

  return (
    <main className="grid min-h-dvh bg-background lg:grid-cols-[1fr_520px]">
      <section className="relative hidden overflow-hidden bg-sidebar lg:block">
        <Image
          src="/stitch-thumbnail.png"
          alt="Prévia visual do portal MaxControLADM"
          fill
          priority
          className="stitch-subtle-drift object-cover opacity-80"
        />
        <div className="absolute inset-0 bg-gradient-to-br from-sidebar via-sidebar/80 to-transparent" />
        <div className="stitch-slide-right absolute bottom-10 left-10 max-w-xl text-sidebar-foreground">
          <p className="text-sm uppercase tracking-[0.16em] text-sidebar-foreground/60">
            Portal Administrativo do CD
          </p>
          <h1 className="mt-4 text-4xl font-semibold tracking-tight">MaxControLADM</h1>
          <p className="mt-4 text-sm leading-6 text-sidebar-foreground/72">
            Controle operacional de fornecedores, despesas, contratos, compras, manutenção,
            tarefas, usuários e auditoria em um único fluxo administrativo.
          </p>
        </div>
      </section>
      <section className="flex min-h-dvh items-center justify-center p-4">
        <div className="absolute right-4 top-4">
          <ThemeToggle />
        </div>
        <Card className="stitch-animate-in w-full max-w-md rounded-lg shadow-none">
          <CardHeader>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Acesso administrativo
            </p>
            <CardTitle className="text-2xl">Entrar no portal</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <LoginForm initialStatus={params.status} />
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">
                Esqueci minha senha
              </span>
              <span className="font-mono text-xs text-muted-foreground">America/Sao_Paulo</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
