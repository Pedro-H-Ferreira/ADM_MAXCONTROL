import { NextResponse } from "next/server";
import { listUsersWithBranches, resolveCurrentAppUser, upsertAppUser, type AppRole } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UserAccessBody = {
  id?: string;
  email?: string | null;
  displayName?: string;
  role?: AppRole;
  fluigUsername?: string | null;
  fluigUserId?: string | null;
  homeBranchId?: string | null;
  branchIds?: string[];
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function GET() {
  const actor = await resolveCurrentAppUser();
  if (!actor.isAdmin) {
    return jsonError("Somente administradores podem consultar usuarios e filiais.", 403);
  }

  const payload = await listUsersWithBranches();
  return NextResponse.json({
    success: true,
    actor: {
      id: actor.id,
      role: actor.role,
      isAdmin: actor.isAdmin,
    },
    ...payload,
  });
}

export async function POST(request: Request) {
  const actor = await resolveCurrentAppUser();
  if (!actor.isAdmin) {
    return jsonError("Somente administradores podem alterar usuarios.", 403);
  }

  const body = (await request.json().catch(() => ({}))) as UserAccessBody;
  if (!body.displayName?.trim()) {
    return jsonError("Nome do usuario e obrigatorio.");
  }

  const user = await upsertAppUser({
    id: body.id,
    email: body.email,
    displayName: body.displayName,
    role: body.role || "LEITURA",
    fluigUsername: body.fluigUsername,
    fluigUserId: body.fluigUserId,
    homeBranchId: body.homeBranchId,
    branchIds: body.branchIds || [],
  });

  return NextResponse.json({
    success: true,
    user,
  });
}
