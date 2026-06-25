/* eslint-disable @typescript-eslint/no-require-imports */
const { loginWithBrowser } = require("./api/session");

function extractCurrentUserId(payload, rawText) {
  const content = payload && typeof payload === "object" ? payload.content : null;
  const candidates = [
    content,
    content && typeof content === "object" ? content.currentUserId : null,
    content && typeof content === "object" ? content.userId : null,
    content && typeof content === "object" ? content.userCode : null,
    content && typeof content === "object" ? content.login : null,
    payload && typeof payload === "object" ? payload.currentUserId : null,
    payload && typeof payload === "object" ? payload.userId : null,
    payload && typeof payload === "object" ? payload.userCode : null,
    payload && typeof payload === "object" ? payload.login : null,
    rawText,
  ];

  for (const candidate of candidates) {
    if (candidate == null || typeof candidate === "object") continue;
    const value = String(candidate).replace(/^"+|"+$/g, "").trim();
    if (value && !["guest", "anonymous", "null", "undefined"].includes(value.toLowerCase())) {
      return value;
    }
  }

  return null;
}

async function probeAuthenticatedSession(page) {
  const result = await page.evaluate(async () => {
    const endpoint = "/portal/api/rest/wcm/rest/admin/location/getCurrentUserId";
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

  const currentUserId = extractCurrentUserId(result.payload, result.text);
  if (!currentUserId) {
    throw new Error("Fluig respondeu, mas nao confirmou um usuario autenticado.");
  }

  return {
    authenticated: true,
    currentUserId,
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
