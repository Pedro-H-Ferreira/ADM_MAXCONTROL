import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { deleteSupplier, readSupplier, updateSupplier, type SupplierInput } from "@/lib/db/suppliers-repository";
import { canActorAccessPage, canActorPerformPageAction, resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    id: string;
  }>;
};

const writeRoles = new Set(["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO"]);

const supplierPatchSchema = z.object({
  cnpj: z.string().nullable().optional(),
  razaoSocial: z.string().trim().min(1).optional(),
  nomeFantasia: z.string().nullable().optional(),
  inscricaoEstadual: z.string().nullable().optional(),
  inscricaoMunicipal: z.string().nullable().optional(),
  categoria: z.string().nullable().optional(),
  status: z.enum(["ATIVO", "PENDENTE_REVISAO", "INATIVO"]).optional(),
  email: z.string().nullable().optional(),
  telefone: z.string().nullable().optional(),
  contatoPrincipal: z.string().nullable().optional(),
  contatos: z.array(z.record(z.string(), z.unknown())).optional(),
  cep: z.string().nullable().optional(),
  endereco: z.string().nullable().optional(),
  numero: z.string().nullable().optional(),
  complemento: z.string().nullable().optional(),
  bairro: z.string().nullable().optional(),
  cidade: z.string().nullable().optional(),
  uf: z.string().nullable().optional(),
  pais: z.string().nullable().optional(),
  observacoes: z.string().nullable().optional(),
  fluigName: z.string().nullable().optional(),
  fluigCode: z.string().nullable().optional(),
  fluigSupplierLabel: z.string().nullable().optional(),
  defaultSourceRequestId: z.string().nullable().optional(),
  defaultPayload: z.record(z.string(), z.unknown()).optional(),
  sourceSystem: z.enum(["LOCAL", "FLUIG", "LOCAL_FLUIG", "PRE_CADASTRO_FLUIG"]).optional(),
  syncStatus: z.enum(["NAO_SINCRONIZADO", "SINCRONIZADO", "PENDENTE_REVISAO", "ERRO_SYNC"]).optional(),
  branchIds: z.array(z.string().uuid()).optional(),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

function canUpdateSuppliers(actor: AppActor) {
  return canActorAccessPage(actor, "fornecedores") && (writeRoles.has(actor.role) || canActorPerformPageAction(actor, "fornecedores", "canUpdate"));
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canActorAccessPage(actor, "fornecedores")) {
      return jsonError("Usuario sem permissao para consultar fornecedores.", 403);
    }

    const supplier = await readSupplier(actor, id);
    if (!supplier) return jsonError("Fornecedor nao encontrado.", 404);
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao consultar fornecedor.", 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canUpdateSuppliers(actor)) {
      return jsonError("Usuario sem permissao para editar fornecedor.", 403);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = supplierPatchSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados do fornecedor invalidos.");
    }

    const supplier = await updateSupplier(actor, id, parsed.data as Partial<SupplierInput>);
    if (!supplier) return jsonError("Fornecedor nao encontrado.", 404);
    return NextResponse.json({ success: true, supplier });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao editar fornecedor.", 500);
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    const actor = await resolveCurrentAppUser();
    if (!canUpdateSuppliers(actor)) {
      return jsonError("Usuario sem permissao para excluir fornecedor.", 403);
    }

    const result = await deleteSupplier(actor, id);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao excluir fornecedor.", 500);
  }
}
