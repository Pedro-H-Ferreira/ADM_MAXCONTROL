"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function RootRouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[root-app-error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
      path: window.location.pathname,
    });
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-background p-6">
      <Card className="w-full max-w-xl rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="size-5 text-destructive" aria-hidden="true" />
            Nao foi possivel abrir esta tela
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            O portal nao conseguiu concluir o carregamento desta rota. Isso pode acontecer quando a
            tela ficou aberta durante uma nova publicacao. Tente novamente ou recarregue a pagina
            para buscar a versao atual.
          </p>
          {error.digest ? (
            <p className="rounded-md border bg-muted/40 p-3 font-mono text-xs text-foreground">
              Codigo do erro: {error.digest}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => unstable_retry()} className="stitch-soft-button">
              <RefreshCw className="size-4" aria-hidden="true" />
              Tentar novamente
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
              className="stitch-soft-button"
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              Recarregar tela
            </Button>
            <Button type="button" variant="outline" asChild className="stitch-soft-button">
              <Link href="/dashboard">
                <Home className="size-4" aria-hidden="true" />
                Ir para o dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
