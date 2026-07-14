/* eslint-disable @typescript-eslint/no-require-imports */
const { loginWithBrowser } = require("./api/session");

function extractCurrentUser(payload, rawText) {
  const content = payload && typeof payload === "object" ? payload.content : null;
  if (content && typeof content === "object" && content.code) {
    return {
      id: content.id == null ? null : String(content.id),
      code: String(content.code).trim(),
      login: String(content.login || "").trim() || null,
      email: String(content.email || "").trim() || null,
      fullName: String(content.fullName || "").trim() || null,
    };
  }

  const fallback = String(rawText || "").replace(/^"+|"+$/g, "").trim();
  return fallback ? { id: null, code: fallback, login: null, email: null, fullName: null } : null;
}

async function probeAuthenticatedSession(page) {
  const result = await page.evaluate(async () => {
    const endpoint = "/api/public/2.0/users/getCurrent";
    const response = await fetch(endpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers: {
        accept: "application/json, text/plain, */*",
      },
    });
    const text = await response.text();
    let payload = null;

    try {
      payload = text ? JSON.parse(text) : null;
    } catch {
      payload = null;
    }

    return {
      endpoint,
      ok: response.ok,
      status: response.status,
      contentType: response.headers.get("content-type"),
      text: text.slice(0, 500),
      payload,
    };
  });

  if (!result.ok) {
    throw new Error(`Fluig recusou a verificacao da sessao autenticada (HTTP ${result.status}).`);
  }

  const currentUser = extractCurrentUser(result.payload, result.text);
  if (!currentUser?.code) {
    throw new Error("Fluig respondeu, mas nao confirmou um usuario autenticado.");
  }

  return {
    authenticated: true,
    currentUserId: currentUser.code,
    currentUser,
    probeEndpoint: result.endpoint,
    probeStatus: result.status,
    probeContentType: result.contentType,
  };
}

async function main() {
  let session;

  try {
    session = await loginWithBrowser({ headless: true });
    const probe = await probeAuthenticatedSession(session.page);
    console.log(
      `FLUIG_HEALTH_CHECK_RESULT ${JSON.stringify({
        ok: true,
        ...probe,
        checkedAt: new Date().toISOString(),
      })}`
    );
  } finally {
    await session?.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
