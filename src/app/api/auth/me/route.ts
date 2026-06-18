import { NextResponse } from "next/server";
import { appAuthErrorResponse } from "@/lib/auth-response";
import { resolveCurrentAppUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const actor = await resolveCurrentAppUser({ requireApproved: false });
    const approved = actor.active && actor.approvalStatus === "APPROVED";

    return NextResponse.json({
      success: true,
      approved,
      profile: {
        id: actor.id,
        email: actor.email,
        displayName: actor.displayName,
        role: actor.role,
        active: actor.active,
        approvalStatus: actor.approvalStatus,
        branches: actor.branches,
        branchCodes: actor.branchCodes,
        isAdmin: actor.isAdmin,
      },
    });
  } catch (error) {
    const authResponse = appAuthErrorResponse(error);
    if (authResponse) return authResponse;

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Falha ao consultar usuario atual.",
      },
      { status: 500 }
    );
  }
}
