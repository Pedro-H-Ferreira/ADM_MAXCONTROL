import { NextResponse } from "next/server";

type DatabaseLikeError = {
  code?: string;
  message?: string;
};

const domainErrors: Record<string, { status: number; message: string }> = {
  BRANCH_FORBIDDEN: { status: 403, message: "Usuario sem permissao para esta filial." },
  BRANCH_NOT_FOUND: { status: 404, message: "Filial nao encontrada." },
  BRANCH_CODE_CONFLICT: { status: 409, message: "Codigo de filial ja cadastrado." },
  BRANCH_CODE_LOCKED: { status: 409, message: "O codigo da filial nao pode ser alterado porque possui vinculos." },
  BRANCH_HOME_IN_USE: { status: 409, message: "Reatribua a filial principal dos usuarios antes de inativar esta filial." },
  BRANCH_CODE_REQUIRED: { status: 400, message: "Codigo da filial e obrigatorio." },
  BRANCH_NAME_REQUIRED: { status: 400, message: "Nome da filial e obrigatorio." },
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

export function branchErrorResponse(error: unknown, fallback: string) {
  const typed = error as DatabaseLikeError | null;
  const message = errorMessage(error, fallback);
  const normalized = message.toLocaleLowerCase("pt-BR");
  const domainError = domainErrors[message];

  if (domainError) {
    return NextResponse.json(
      { success: false, error: domainError.message },
      { status: domainError.status }
    );
  }

  if (typed?.code === "42501" || normalized.includes("sem permissao")) {
    return NextResponse.json({ success: false, error: message }, { status: 403 });
  }

  if (
    typed?.code === "P0002" ||
    typed?.code === "PGRST116" ||
    normalized.includes("nao encontrad")
  ) {
    return NextResponse.json({ success: false, error: message }, { status: 404 });
  }

  if (
    typed?.code === "23505" ||
    typed?.code === "23503" ||
    typed?.code === "23P01" ||
    normalized.includes("ja cadastrad") ||
    normalized.includes("possui vinculo") ||
    normalized.includes("em uso")
  ) {
    return NextResponse.json({ success: false, error: message }, { status: 409 });
  }

  if (
    typed?.code === "22001" ||
    typed?.code === "22P02" ||
    typed?.code === "23502" ||
    typed?.code === "23514" ||
    normalized.includes("obrigatori") ||
    normalized.includes("invalid")
  ) {
    return NextResponse.json({ success: false, error: message }, { status: 400 });
  }

  return NextResponse.json({ success: false, error: message }, { status: 500 });
}
