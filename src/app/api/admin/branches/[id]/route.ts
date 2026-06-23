import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { deleteBranch, readAdminBranch, updateBranch, type BranchInput } from "@/lib/db/branches-repository";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const branchPatchSchema = z.object({
  code: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).optional(),
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

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorAccessPage(actor, "configuracoes")) {
      return jsonError("Usuario sem permissao para consultar filiais.", 403);
    }

    const { id } = await context.params;
    const branch = await readAdminBranch(id);
    if (!branch) return jsonError("Filial nao encontrada.", 404);
    return NextResponse.json({ success: true, branch });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar filial.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "configuracoes", "canUpdate")) {
      return jsonError("Usuario sem permissao para editar filiais.", 403);
    }

    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const parsed = branchPatchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados da filial invalidos.");
    }

    const branch = await updateBranch(actor, id, parsed.data as Partial<BranchInput>);
    if (!branch) return jsonError("Filial nao encontrada.", 404);
    return NextResponse.json({ success: true, branch });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao editar filial.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canActorPerformPageAction(actor, "configuracoes", "canUpdate")) {
      return jsonError("Usuario sem permissao para excluir filiais.", 403);
    }

    const { id } = await context.params;
    const result = await deleteBranch(actor, id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao excluir filial.", 500);
  }
}
