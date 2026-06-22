import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { createBranch, listAdminBranches, type BranchInput } from "@/lib/db/branches-repository";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
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

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return jsonError("Somente administradores podem consultar o cadastro completo de filiais.", 403);
    }

    const url = new URL(request.url);
    const activeParam = url.searchParams.get("active");
    const payload = await listAdminBranches({
      search: url.searchParams.get("q") || url.searchParams.get("search"),
      active: activeParam == null ? null : parseBoolean(activeParam, true),
      page: Number(url.searchParams.get("page") || 1),
      pageSize: Number(url.searchParams.get("pageSize") || 50),
    });

    return NextResponse.json({ success: true, ...payload });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao listar filiais.", 500);
  }
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    if (!actor.isAdmin) {
      return jsonError("Somente administradores podem criar filiais.", 403);
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
