import { NextResponse } from "next/server";
import { createSignupUser } from "@/lib/db/app-repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SignupBody = {
  email?: string;
  password?: string;
};

function jsonError(error: string, status = 400) {
  return NextResponse.json({ success: false, error }, { status });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as SignupBody;
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");

  if (!email || !email.includes("@")) {
    return jsonError("Informe um e-mail valido.");
  }

  if (password.length < 6) {
    return jsonError("A senha precisa ter pelo menos 6 caracteres.");
  }

  try {
    const result = await createSignupUser({ email, password });

    return NextResponse.json({
      success: true,
      autoApproved: result.autoApproved,
      profile: {
        id: result.profile.id,
        email: result.profile.email,
        displayName: result.profile.displayName,
        role: result.profile.role,
        active: result.profile.active,
        approvalStatus: result.profile.approvalStatus,
      },
      message: result.autoApproved
        ? "Cadastro criado como administrador inicial. Voce ja pode entrar."
        : "Cadastro recebido. Aguarde liberacao do administrador.",
    });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Falha ao criar cadastro.", 400);
  }
}
