import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createBranch, listAdminBranches, type BranchInput } from "@/lib/db/branches-repository";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";
import { parseBoolean } from "@/lib/fluig/route-utils";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const branchSchema = z.object({
  code: z.string().trim().min(1, "Codigo da filial e obrigatorio."),
  name: z.string().trim().min(1, "Nome da filial e obrigatorio."),
  fluigLabel: z.string().nullable().optional(),
  region: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
  active: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
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

const supplierWriteRoles = new Set(["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO"]);

function canListBranchesForSupplierForm(actor: AppActor) {
  return (
    canActorAccessPage(actor, "fornecedores") &&
    (supplierWriteRoles.has(actor.role) ||
      canActorPerformPageAction(actor, "fornecedores", "canCreate") ||
      canActorPerformPageAction(actor, "fornecedores", "canUpdate"))
  );
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
    const activeParam = url.searchParams.get("active");
    const payload = await listAdminBranches({
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      active: activeParam == null ? null : parseBoolean(activeParam, true),
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50),
    });

    return NextResponse.json({ success: true, permissions: branchPermissions(actor), ...payload });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar filiais.", 500);
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
    return jsonError(error instanceof Error ? error.message : "Falha ao criar filial.", 500);
  }
}
