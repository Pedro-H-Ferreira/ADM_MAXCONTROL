import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  getExpenseAuthorization,
  updateExpenseAuthorization,
} from "@/lib/db/expense-authorization-repository";
import { expenseAuthorizationUpdateSchema } from "@/lib/expense-authorization-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ success: false, error: "ADF invalida." }, { status: 400 });
    const authorization = await getExpenseAuthorization(actor, params.data.id);
    if (!authorization) return NextResponse.json({ success: false, error: "ADF nao encontrada." }, { status: 404 });
    return NextResponse.json({ success: true, authorization });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar ADF." },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ success: false, error: "ADF invalida." }, { status: 400 });
    const parsed = expenseAuthorizationUpdateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Dados da ADF invalidos." },
        { status: 400 }
      );
    }
    const authorization = await updateExpenseAuthorization(actor, params.data.id, parsed.data);
    return NextResponse.json({ success: true, authorization });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao atualizar ADF." },
      { status: 500 }
    );
  }
}
