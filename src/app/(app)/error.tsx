"use client";

import Link from "next/link";
import { useEffect } from "react";
import { AlertTriangle, Home, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export default function AdminRouteError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[app-route-error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center p-4">
      <Card className="w-full max-w-xl rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <AlertTriangle className="size-5 text-destructive" />
            Nao foi possivel abrir esta tela
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            A tela falhou durante o carregamento. Tente novamente para buscar os dados atuais do
            servidor.
          </p>
          {error.digest ? (
            <p className="rounded-md border bg-muted/40 p-3 font-mono text-xs text-foreground">
              Codigo do erro: {error.digest}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="button" onClick={() => unstable_retry()} className="stitch-soft-button">
              <RefreshCw className="size-4" />
              Tentar novamente
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => window.location.reload()}
              className="stitch-soft-button"
            >
              <RefreshCw className="size-4" />
              Recarregar tela
            </Button>
            <Button type="button" variant="outline" asChild className="stitch-soft-button">
              <Link href="/dashboard">
                <Home className="size-4" />
                Ir para o dashboard
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
