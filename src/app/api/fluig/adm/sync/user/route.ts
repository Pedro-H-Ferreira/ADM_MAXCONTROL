import { NextResponse } from "next/server";
import { z } from "zod";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";
import { createKnownOpenSyncJobs } from "@/app/api/fluig/adm/sync/_helpers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  module: z.enum(["pagamentos", "compras", "manutencao", "fornecedores", "all", "auto"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  try {
    const actor = await resolveCurrentAppUser();
    const body = await request.json().catch(() => ({}));
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return jsonError(parsed.error.issues[0]?.message || "Payload invalido.");
    }

    const [openTasks, myRequests] = await Promise.all([
      createKnownOpenSyncJobs({
        actor,
        module: parsed.data.module,
        operation: "sync_user_open_tasks",
        syncType: "open_tasks",
        limit: parsed.data.limit,
      }),
      createKnownOpenSyncJobs({
        actor,
        module: parsed.data.module,
        operation: "sync_user_open_requests",
        syncType: "my_requests",
        limit: parsed.data.limit,
      }),
    ]);

    return NextResponse.json({
      success: true,
      openTasks,
      myRequests,
      jobs: [...openTasks.jobs, ...myRequests.jobs],
      skipped: [...openTasks.skipped, ...myRequests.skipped],
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;
    return jsonError(error instanceof Error ? error.message : "Falha ao sincronizar usuario Fluig.", 500);
  }
}
