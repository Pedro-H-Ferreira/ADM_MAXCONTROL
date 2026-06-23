import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <div className="max-w-md text-center">
        <p className="font-mono text-sm text-muted-foreground">404</p>
        <h1 className="mt-2 text-2xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          A rota solicitada ainda não faz parte do portal administrativo.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard" prefetch={false}>
            Voltar ao dashboard
          </Link>
        </Button>
      </div>
    </main>
  );
}
