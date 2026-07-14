import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import {
  getExpenseAuthorization,
  updateExpenseAuthorization,
} from "@/lib/db/expense-authorization-repository";
import { expenseAuthorizationStatuses } from "@/lib/expense-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const paramsSchema = z.object({ id: z.string().uuid() });
const nullableText = z.string().trim().max(5000).nullable().optional();
const nonnegativeMoney = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional();
const updateSchema = z.object({
  status: z.enum(expenseAuthorizationStatuses).optional(),
  issueDate: z.iso.date().optional(),
  expenseType: nullableText,
  description: z.string().trim().min(1).max(5000).optional(),
  expenseAccount: nullableText,
  financialAccount: nullableText,
  costCenter: nullableText,
  amountCents: nonnegativeMoney,
  amountWords: nullableText,
  beneficiaryCategory: nullableText,
  beneficiaryName: nullableText,
  beneficiaryTaxId: nullableText,
  beneficiaryPhone: nullableText,
  paymentMethod: nullableText,
  bankName: nullableText,
  bankOperation: nullableText,
  bankAgency: nullableText,
  bankAccount: nullableText,
  pixKey: nullableText,
  requesterName: nullableText,
  requesterRole: nullableText,
  budgetPlannedCents: nonnegativeMoney,
  budgetRealizedCents: nonnegativeMoney,
  budgetDeviationCents: z.number().int().min(Number.MIN_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  budgetDeviationPercent: z.number().min(-999999).max(999999).nullable().optional(),
  additionalInfo: nullableText,
  physicalLocation: nullableText,
  deliveredTo: nullableText,
});

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
    const parsed = updateSchema.safeParse(await request.json().catch(() => ({})));
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
