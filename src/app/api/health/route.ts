import { NextResponse } from "next/server";
import { getFluigRuntimeConfig } from "@/lib/fluig/server-client";
import { getSupabaseServiceClient, getSupabaseServiceStatus } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = Date.now();
  const supabaseStatus = getSupabaseServiceStatus();
  const supabase = getSupabaseServiceClient();
  const fluig = getFluigRuntimeConfig();

  let database = {
    configured: supabaseStatus.configured,
    reachable: false,
    error: supabaseStatus.missing.join(", ") || null,
  };

  if (supabase) {
    const { error } = await supabase.from("app_user_profiles").select("id", { head: true, count: "exact" }).limit(1);
    database = {
      configured: true,
      reachable: !error,
      error: error?.message || null,
    };
  }

  const healthy = database.reachable && fluig.configured;

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      database,
      fluig: {
        configured: fluig.configured,
        mode: fluig.mode,
        missing: fluig.missing,
      },
      durationMs: Date.now() - startedAt,
    },
    { status: healthy ? 200 : 503 }
  );
}
