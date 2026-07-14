import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";
import { listExpenseAuthorizations } from "@/lib/db/expense-authorization-repository";
import { expenseAuthorizationStatuses } from "@/lib/expense-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const statusSchema = z.enum(expenseAuthorizationStatuses);

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const url = new URL(request.url);
    const rawStatus = url.searchParams.get("status");
    const status = rawStatus ? statusSchema.safeParse(rawStatus) : null;
    if (status && !status.success) {
      return NextResponse.json({ success: false, error: "Status de ADF invalido." }, { status: 400 });
    }

    const authorizations = await listExpenseAuthorizations(actor, {
      status: status?.success ? status.data : null,
      query: url.searchParams.get("q"),
    });
    return NextResponse.json({
      success: true,
      authorizations,
      permissions: {
        canUpdate: canActorPerformPageAction(actor, "adfs", "canUpdate"),
        canApprove: canActorPerformPageAction(actor, "adfs", "canApprove"),
      },
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar ADFs." },
      { status: 500 }
    );
  }
}
