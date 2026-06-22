import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createSupplier, listSuppliers, type SupplierInput } from "@/lib/db/suppliers-repository";
import { resolveCurrentAppUser, type AppActor } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const writeRoles = new Set(["ADMIN_MASTER", "ADMIN", "ADMINISTRATIVO"]);

const supplierSchema = z.object({
  cnpj: z.string().nullable().optional(),
  razaoSocial: z.string().trim().min(1, "Razao social e obrigatoria."),
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

function canWriteSuppliers(actor: AppActor) {
  return writeRoles.has(actor.role);
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const payload = await listSuppliers(actor, {
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      status: url.searchParams.get("status"),
      sourceSystem: url.searchParams.get("sourceSystem"),
      syncStatus: url.searchParams.get("syncStatus"),
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 25),
    });

    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar fornecedores.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!canWriteSuppliers(actor)) {
      return jsonError("Usuario sem permissao para criar fornecedor.", 403);
    }

    const body = await request.json().catch(() => ({}));
    const parsed = supplierSchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Dados do fornecedor invalidos.");
    }

    const supplier = await createSupplier(actor, parsed.data as SupplierInput);
    return NextResponse.json({ success: true, supplier }, { status: 201 });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao criar fornecedor.", 500);
  }
}
