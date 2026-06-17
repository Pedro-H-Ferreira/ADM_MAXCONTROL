import Image from "next/image";
import Link from "next/link";
import { Eye, LockKeyhole, Mail } from "lucide-react";
import { ThemeToggle } from "@/components/app/theme-toggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <main className="grid min-h-screen bg-background lg:grid-cols-[1fr_520px]">
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
      <section className="flex min-h-screen items-center justify-center p-4">
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
            <div className="grid gap-2">
              <Label htmlFor="email">E-mail</Label>
              <div className="relative">
                <Mail className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="email"
                  type="email"
                  className="pl-9 transition-all duration-300 focus:shadow-sm"
                  placeholder="admin@empresa.com.br"
                />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="password">Senha</Label>
              <div className="relative">
                <LockKeyhole className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  id="password"
                  type="password"
                  className="px-9 transition-all duration-300 focus:shadow-sm"
                  placeholder="Sua senha"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 -translate-y-1/2 transition-colors duration-200"
                  aria-label="Mostrar senha"
                >
                  <Eye className="size-4" />
                </Button>
              </div>
            </div>
            <Button asChild className="stitch-soft-button w-full">
              <Link href="/dashboard">Entrar</Link>
            </Button>
            <div className="flex items-center justify-between text-sm">
              <Link href="/login" className="text-muted-foreground hover:text-foreground">
                Esqueci minha senha
              </Link>
              <span className="font-mono text-xs text-muted-foreground">America/Sao_Paulo</span>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
