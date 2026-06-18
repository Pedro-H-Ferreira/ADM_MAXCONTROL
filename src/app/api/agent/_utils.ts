import { authenticateAgentToken } from "@/lib/db/app-repository";

export function readBearerToken(request: Request) {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export async function requireAgent(request: Request) {
  const token = readBearerToken(request);
  if (!token) {
    return {
      agent: null,
      error: Response.json({ success: false, error: "Token do agente ausente." }, { status: 401 }),
    };
  }

  const agent = await authenticateAgentToken(token);
  if (!agent) {
    return {
      agent: null,
      error: Response.json({ success: false, error: "Token do agente invalido." }, { status: 401 }),
    };
  }

  return {
    agent,
    error: null,
  };
}
