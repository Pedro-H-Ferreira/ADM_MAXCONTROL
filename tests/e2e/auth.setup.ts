import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type FullConfig } from "@playwright/test";
import { loadEnvConfig } from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

type CookieWrite = {
  name: string;
  value: string;
  options: {
    domain?: string;
    expires?: Date;
    httpOnly?: boolean;
    maxAge?: number;
    path?: string;
    sameSite?: boolean | "lax" | "strict" | "none";
    secure?: boolean;
  };
};

function sameSite(value: CookieWrite["options"]["sameSite"]): "Strict" | "Lax" | "None" | undefined {
  if (value === true || value === "strict") return "Strict";
  if (value === "none") return "None";
  if (value === "lax") return "Lax";
  return undefined;
}

export default async function authSetup(config: FullConfig) {
  loadEnvConfig(process.cwd());

  const storageState = String(config.projects[0]?.use.storageState || "output/playwright/.auth/admin.json");
  if (process.env.E2E_STORAGE_STATE) return;

  const email = process.env.E2E_USER_EMAIL?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const baseURL = String(config.projects[0]?.use.baseURL || "http://127.0.0.1:3000");

  if (!email) throw new Error("Configure E2E_USER_EMAIL com um usuario aprovado para executar os testes Playwright.");
  if (!supabaseUrl || !anonKey || !serviceRoleKey) {
    throw new Error("Variaveis Supabase ausentes para preparar a sessao E2E.");
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${baseURL}/dashboard` },
  });
  if (linkError || !linkData.properties.hashed_token) {
    throw new Error(linkError?.message || "Nao foi possivel gerar o acesso E2E.");
  }

  const authClient = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: authData, error: authError } = await authClient.auth.verifyOtp({
    type: "magiclink",
    token_hash: linkData.properties.hashed_token,
  });
  if (authError || !authData.session) throw new Error(authError?.message || "Sessao E2E nao criada.");

  const writes = new Map<string, CookieWrite>();
  const ssrClient = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll: () => [],
      setAll: (cookies) => {
        for (const cookie of cookies) writes.set(cookie.name, cookie as CookieWrite);
      },
    },
  });
  const { error: sessionError } = await ssrClient.auth.setSession({
    access_token: authData.session.access_token,
    refresh_token: authData.session.refresh_token,
  });
  if (sessionError) throw new Error(sessionError.message);

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies(
    [...writes.values()]
      .filter((cookie) => !cookie.options.maxAge || cookie.options.maxAge > 0)
      .map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        url: baseURL,
        httpOnly: cookie.options.httpOnly,
        secure: baseURL.startsWith("https:") || cookie.options.secure,
        sameSite: sameSite(cookie.options.sameSite),
        expires: cookie.options.expires
          ? Math.floor(cookie.options.expires.getTime() / 1000)
          : cookie.options.maxAge
            ? Math.floor(Date.now() / 1000) + cookie.options.maxAge
            : undefined,
      }))
  );

  const page = await context.newPage();
  await page.goto(`${baseURL}/dashboard`, { waitUntil: "domcontentloaded" });
  if (new URL(page.url()).pathname === "/login") {
    throw new Error(`O usuario E2E ${email} nao conseguiu acessar o painel.`);
  }

  await fs.mkdir(path.dirname(storageState), { recursive: true });
  await context.storageState({ path: storageState });
  await browser.close();
}
