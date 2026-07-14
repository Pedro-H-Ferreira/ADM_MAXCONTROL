import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { enqueueExpenseAuthorizationAttachment } from "@/lib/db/expense-authorization-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, context: RouteContext) {
  try {
    const actor = await resolveCurrentAppUser();
    const params = paramsSchema.safeParse(await context.params);
    if (!params.success) return NextResponse.json({ success: false, error: "ADF invalida." }, { status: 400 });
    const result = await enqueueExpenseAuthorizationAttachment(actor, params.data.id);
    return NextResponse.json({ success: true, ...result }, { status: 202 });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao anexar ADF no Fluig." },
      { status: 500 }
    );
  }
}
