"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import { useEffect } from "react";

export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string };
  unstable_retry: () => void;
}) {
  useEffect(() => {
    console.error("[global-app-error]", {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="pt-BR">
      <head>
        <title>Falha ao abrir o ADM MaxControl</title>
      </head>
      <body style={styles.body}>
        <main style={styles.panel}>
          <div aria-hidden="true" style={styles.icon}>
            !
          </div>
          <p style={styles.eyebrow}>ADM MAXCONTROL</p>
          <h1 style={styles.title}>Nao foi possivel abrir esta tela</h1>
          <p style={styles.description}>
            O servidor nao concluiu o carregamento. Tente novamente para renovar a sessao e buscar
            os dados atuais.
          </p>
          {error.digest ? <p style={styles.digest}>Codigo do erro: {error.digest}</p> : null}
          <div style={styles.actions}>
            <button type="button" onClick={() => unstable_retry()} style={styles.primaryButton}>
              Tentar novamente
            </button>
            <button type="button" onClick={() => window.location.reload()} style={styles.secondaryButton}>
              Recarregar pagina
            </button>
            <Link href="/dashboard" style={styles.secondaryButton}>
              Ir para o dashboard
            </Link>
          </div>
        </main>
      </body>
    </html>
  );
}

const styles = {
  body: {
    alignItems: "center",
    background: "#f4f7fb",
    color: "#101828",
    display: "flex",
    fontFamily: "Arial, Helvetica, sans-serif",
    justifyContent: "center",
    margin: 0,
    minHeight: "100vh",
    padding: "24px",
  },
  panel: {
    background: "#ffffff",
    border: "1px solid #d0d5dd",
    borderRadius: "8px",
    boxSizing: "border-box",
    maxWidth: "560px",
    padding: "32px",
    width: "100%",
  },
  icon: {
    alignItems: "center",
    background: "#fee4e2",
    border: "1px solid #fecdca",
    borderRadius: "50%",
    color: "#b42318",
    display: "flex",
    fontSize: "22px",
    fontWeight: 700,
    height: "44px",
    justifyContent: "center",
    width: "44px",
  },
  eyebrow: {
    color: "#667085",
    fontSize: "12px",
    fontWeight: 700,
    letterSpacing: 0,
    margin: "24px 0 8px",
  },
  title: {
    fontSize: "24px",
    lineHeight: 1.25,
    margin: 0,
  },
  description: {
    color: "#475467",
    fontSize: "15px",
    lineHeight: 1.6,
    margin: "12px 0 0",
  },
  digest: {
    background: "#f2f4f7",
    border: "1px solid #e4e7ec",
    borderRadius: "6px",
    fontFamily: "Consolas, monospace",
    fontSize: "12px",
    margin: "20px 0 0",
    padding: "12px",
  },
  actions: {
    display: "flex",
    flexWrap: "wrap",
    gap: "10px",
    marginTop: "24px",
  },
  primaryButton: {
    background: "#101828",
    border: "1px solid #101828",
    borderRadius: "6px",
    color: "#ffffff",
    cursor: "pointer",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px 16px",
  },
  secondaryButton: {
    background: "#ffffff",
    border: "1px solid #d0d5dd",
    borderRadius: "6px",
    color: "#101828",
    fontSize: "14px",
    fontWeight: 600,
    padding: "10px 16px",
    textDecoration: "none",
  },
} satisfies Record<string, CSSProperties>;
