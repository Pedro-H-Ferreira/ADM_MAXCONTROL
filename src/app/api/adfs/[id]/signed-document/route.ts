import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  createSignedExpenseAuthorizationDownload,
  uploadSignedExpenseAuthorization,
} from "@/lib/db/expense-authorization-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ success: false, error: "ADF invalida." }, { status: 400 });
    return NextResponse.redirect(await createSignedExpenseAuthorizationDownload(actor, params.data.id));
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao abrir PDF assinado." },
      { status: 500 }
    );
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ success: false, error: "ADF invalida." }, { status: 400 });
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return NextResponse.json({ success: false, error: "Selecione o PDF assinado." }, { status: 400 });
    }
    const authorization = await uploadSignedExpenseAuthorization(actor, params.data.id, file);
    return NextResponse.json({ success: true, authorization });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao receber PDF assinado." },
      { status: 500 }
    );
  }
}
