import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { branchErrorResponse } from "@/lib/branch-errors";
import { deleteBranch, readAdminBranch, updateBranch, type BranchInput } from "@/lib/db/branches-repository";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const brazilianUfSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() || null : value),
  z.enum([
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
  ], "UF invalida.").nullable()
);

const nullableText = (maximum: number, message: string) =>
  z.string().trim().max(maximum, message).nullable().optional();

const branchPatchSchema = z.object({
  code: z.string()
    .trim()
    .min(1, "Codigo da filial e obrigatorio.")
    .max(64, "Codigo da filial deve ter no maximo 64 caracteres.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Codigo da filial invalido.")
    .transform((value) => value.toUpperCase())
    .optional(),
  name: z.string()
    .trim()
    .min(1, "Nome da filial e obrigatorio.")
    .max(160, "Nome da filial deve ter no maximo 160 caracteres.")
    .optional(),
  fluigLabel: nullableText(240, "Identificacao Fluig deve ter no maximo 240 caracteres."),
  region: nullableText(100, "Regiao deve ter no maximo 100 caracteres."),
  city: nullableText(120, "Cidade deve ter no maximo 120 caracteres."),
  uf: brazilianUfSchema.optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict().refine((input) => Object.keys(input).length > 0, {
  message: "Informe ao menos um campo para atualizar a filial.",
});

const branchIdSchema = z.string().uuid("Identificador da filial invalido.");

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorAccessPage(actor, "configuracoes")) {
      return jsonError("Usuario sem permissao para consultar filiais.", 403);
    }

    const params = branchIdSchema.safeParse((await context.params).id);
    if (!params.success) return jsonError(params.error.issues[0]?.message || "Identificador da filial invalido.");

    const branch = await readAdminBranch(actor, params.data);
    if (!branch) return jsonError("Filial nao encontrada.", 404);
    return NextResponse.json({ success: true, branch });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return branchErrorResponse(error, "Falha ao consultar filial.");
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "configuracoes", "canUpdate")) {
      return jsonError("Usuario sem permissao para editar filiais.", 403);
    }

    const params = branchIdSchema.safeParse((await context.params).id);
    if (!params.success) return jsonError(params.error.issues[0]?.message || "Identificador da filial invalido.");

    const body = await request.json().catch(() => ({}));
    const parsed = branchPatchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da filial invalidos.");
    }

    const branch = await updateBranch(actor, params.data, parsed.data as Partial<BranchInput>);
    if (!branch) return jsonError("Filial nao encontrada.", 404);
    return NextResponse.json({ success: true, branch });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return branchErrorResponse(error, "Falha ao editar filial.");
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "configuracoes", "canUpdate")) {
      return jsonError("Usuario sem permissao para excluir filiais.", 403);
    }

    const params = branchIdSchema.safeParse((await context.params).id);
    if (!params.success) return jsonError(params.error.issues[0]?.message || "Identificador da filial invalido.");

    const result = await deleteBranch(actor, params.data);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return branchErrorResponse(error, "Falha ao excluir filial.");
  }
}
