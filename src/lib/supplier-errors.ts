import { NextResponse } from "next/server";

type PostgresLikeError = Error & {
  code?: string;
  details?: string;
};

export function supplierErrorResponse(error: unknown, fallback: string) {
  const typed = error as PostgresLikeError;
  const message = error instanceof Error ? error.message : fallback;
  const normalized = message.toLocaleLowerCase("pt-BR");

  if (typed?.code === "42501") {
    return NextResponse.json({ success: false, error: message }, { status: 403 });
  }
  if (typed?.code === "P0002" || normalized.includes("nao encontrado")) {
    return NextResponse.json({ success: false, error: message }, { status: 404 });
  }
  if (
    typed?.code === "23505" ||
    typed?.code === "23503" ||
    normalized.includes("ja cadastrado") ||
    normalized.includes("ja foi revisado") ||
    normalized.includes("possui vinculos")
  ) {
    return NextResponse.json({ success: false, error: message }, { status: 409 });
  }
  if (typed?.code === "23514" || normalized.includes("invalido") || normalized.includes("obrigatoria")) {
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
