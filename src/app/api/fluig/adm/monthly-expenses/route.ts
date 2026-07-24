import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { readMonthlyExpenseDashboardForActor } from "@/lib/db/fluig-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);

function currentMonthInSaoPaulo() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
}

export async function GET(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const currentMonth = currentMonthInSaoPaulo();
    const parsed = monthSchema.safeParse(new URL(request.url).searchParams.get("month") || currentMonth);
    if (!parsed.success || parsed.data > currentMonth) {
      return NextResponse.json({ success: false, error: "Competencia mensal invalida." }, { status: 400 });
    }
    const dashboard = await readMonthlyExpenseDashboardForActor({
      actor,
      selectedMonth: parsed.data,
      currentMonth,
    });
    return NextResponse.json({ success: true, dashboard });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Falha ao consultar contas mensais." },
      { status: 500 }
    );
  }
}
