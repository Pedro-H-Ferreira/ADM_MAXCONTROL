import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { branchErrorResponse } from "@/lib/branch-errors";
import { createBranch, listAdminBranches, type BranchInput } from "@/lib/db/branches-repository";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const brazilianUfSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() || null : value),
  z.enum([
    "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
    "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
  ], "UF invalida.").nullable()
);

const nullableText = (maximum: number, message: string) =>
  z.string().trim().max(maximum, message).nullable().optional();

const branchSchema = z.object({
  code: z.string()
    .trim()
    .min(1, "Codigo da filial e obrigatorio.")
    .max(64, "Codigo da filial deve ter no maximo 64 caracteres.")
    .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Codigo da filial invalido.")
    .transform((value) => value.toUpperCase()),
  name: z.string()
    .trim()
    .min(1, "Nome da filial e obrigatorio.")
    .max(160, "Nome da filial deve ter no maximo 160 caracteres."),
  fluigLabel: nullableText(240, "Identificacao Fluig deve ter no maximo 240 caracteres."),
  region: nullableText(100, "Regiao deve ter no maximo 100 caracteres."),
  city: nullableText(120, "Cidade deve ter no maximo 120 caracteres."),
  uf: brazilianUfSchema.optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
}).strict();

const branchListSchema = z.object({
  search: z.string().trim().max(200, "Busca deve ter no maximo 200 caracteres.").nullable(),
  active: z.enum(["true", "false"], "Situacao da filial invalida.")
    .transform((value) => value === "true")
    .nullable(),
  page: z.coerce.number().int("Pagina invalida.").min(1, "Pagina invalida.").default(1),
  pageSize: z.coerce.number().int("Tamanho da pagina invalido.").min(1, "Tamanho da pagina invalido.").max(200, "Tamanho da pagina deve ser no maximo 200.").default(50),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function branchPermissions(actor: Awaited<ReturnType<typeof resolveCurrentAppUser>>) {
  const canView = canActorAccessPage(actor, "configuracoes");
  return {
    canView,
    canCreate: canView && canActorPerformPageAction(actor, "configuracoes", "canCreate"),
    canUpdate: canView && canActorPerformPageAction(actor, "configuracoes", "canUpdate"),
    canApprove: canView && canActorPerformPageAction(actor, "configuracoes", "canApprove"),
  };
}

function canListBranchesForSupplierForm(actor: AppActor) {
  return canActorAccessPage(actor, "fornecedores");
}

function actorBranchesPayload(actor: AppActor) {
  const items = actor.branches
    .filter((branch) => branch.active)
    .map((branch) => ({
      id: branch.id,
      code: branch.code,
      name: branch.name,
      fluigLabel: branch.fluigLabel,
      region: null,
      city: null,
      uf: null,
      active: branch.active,
      metadata: {},
      lastFluigSyncAt: null,
      usersCount: 0,
      suppliersCount: 0,
      openRequestsCount: 0,
      createdAt: null,
      updatedAt: null,
      deletedAt: null,
    }));

  return {
    page: 1,
    pageSize: items.length,
    total: items.length,
    items,
  };
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorAccessPage(actor, "configuracoes")) {
      if (!canListBranchesForSupplierForm(actor)) {
        return jsonError("Usuario sem permissao para consultar filiais.", 403);
      }

      return NextResponse.json({
        success: true,
        permissions: branchPermissions(actor),
        ...actorBranchesPayload(actor),
      });
    }

    const url = new URL(request.url);
    const parsed = branchListSchema.safeParse({
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      active: url.searchParams.get("active"),
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 50,
    });
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Filtros de filiais invalidos.");
    }

    const payload = await listAdminBranches(actor, parsed.data);

    return NextResponse.json({ success: true, permissions: branchPermissions(actor), ...payload });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return branchErrorResponse(error, "Falha ao listar filiais.");
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "configuracoes", "canCreate")) {
      return jsonError("Usuario sem permissao para criar filiais.", 403);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = branchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da filial invalidos.");
    }

    const branch = await createBranch(actor, parsed.data as BranchInput);
    return NextResponse.json({ success: true, branch }, { status: 201 });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return branchErrorResponse(error, "Falha ao criar filial.");
  }
}
