import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listFluigRequestsForActor } from "@/lib/db/fluig-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  module: z.enum(["pagamentos", "compras", "manutencao", "fornecedores"]),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  search: z.string().trim().max(200).nullable(),
  status: z.string().trim().max(80).nullable(),
  branch: z.string().trim().max(80).nullable(),
  nature: z.string().trim().max(200).nullable(),
  open: z.enum(["true", "false"]).nullable(),
  overdue: z.enum(["true", "false"]).nullable(),
  errorOnly: z.enum(["true", "false"]).nullable(),
  mine: z.enum(["true", "false"]).nullable(),
});

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = schema.safeParse({
      module: url.searchParams.get("module"),
      page: url.searchParams.get("page") || 1,
      pageSize: url.searchParams.get("pageSize") || 30,
      search: url.searchParams.get("q"),
      status: url.searchParams.get("status"),
      branch: url.searchParams.get("branch"),
      nature: url.searchParams.get("nature"),
      open: url.searchParams.get("open"),
      overdue: url.searchParams.get("overdue"),
      errorOnly: url.searchParams.get("errorOnly"),
      mine: url.searchParams.get("mine"),
    });
    if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error.issues[0]?.message || "Filtros invalidos." }, { status: 400 });
    const actor = await resolveCurrentAppUser();
    const data = await listFluigRequestsForActor({
      ...parsed.data,
      actor,
      open: parsed.data.open == null ? null : parsed.data.open === "true",
      overdue: parsed.data.overdue === "true",
      errorOnly: parsed.data.errorOnly === "true",
      mine: parsed.data.mine === "true",
    });
    return NextResponse.json({ success: true, ...data });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json({ success: false, error: error instanceof Error ? error.message : "Falha ao listar solicitacoes Fluig." }, { status: 500 });
  }
}
