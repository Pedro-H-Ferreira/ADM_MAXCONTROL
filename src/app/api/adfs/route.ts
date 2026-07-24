import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { canActorPerformPageAction, resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  createExpenseAuthorization,
  listExpenseAuthorizations,
} from "@/lib/db/expense-authorization-repository";
import { expenseAuthorizationStatuses } from "@/lib/expense-authorization";
import { expenseAuthorizationCreateSchema } from "@/lib/expense-authorization-validation";

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
        canCreate: canActorPerformPageAction(actor, "adfs", "canCreate"),
        canUpdate: canActorPerformPageAction(actor, "adfs", "canUpdate"),
        canApprove: canActorPerformPageAction(actor, "adfs", "canApprove"),
      },
      branches: actor.branches.map((branch) => ({
        id: branch.id,
        code: branch.code,
        label: branch.fluigLabel || branch.name,
      })),
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

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const parsed = expenseAuthorizationCreateSchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { success: false, error: parsed.error.issues[0]?.message || "Dados da nova ADF invalidos." },
        { status: 400 }
      );
    }
    const authorization = await createExpenseAuthorization(actor, parsed.data);
    return NextResponse.json({ success: true, authorization }, { status: 201 });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao criar ADF." },
      { status: 500 }
    );
  }
}
