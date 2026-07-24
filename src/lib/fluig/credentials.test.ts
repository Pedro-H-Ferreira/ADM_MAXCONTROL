import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const serviceState = vi.hoisted(() => ({ client: null as unknown }));

vi.mock("@/lib/supabase/service", () => ({
  getSupabaseServiceClient: () => serviceState.client,
}));

import { readFluigCredentials, saveFluigCredentials } from "@/lib/fluig/credentials";

const userId = "11111111-1111-4111-8111-111111111111";

describe("Fluig user credential encryption", () => {
  let stored: Record<string, unknown> | null;

  beforeEach(() => {
    stored = null;
    process.env.FLUIG_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

    serviceState.client = {
      from(table: string) {
        if (table !== "fluig_user_credentials") throw new Error(`Unexpected table ${table}`);
        const builder = {
          select: () => builder,
          eq: () => builder,
          maybeSingle: async () => ({ data: stored, error: null }),
          upsert: async (payload: Record<string, unknown>) => {
            stored = { ...payload };
            return { error: null };
          },
        };
        return builder;
      },
    };
  });

  afterEach(() => {
    delete process.env.FLUIG_CREDENTIALS_ENCRYPTION_KEY;
  });

  it("round-trips username and password without persisting plaintext", async () => {
    await saveFluigCredentials({
      userId,
      username: "administrativo",
      password: "senha-com-espacos  ",
      updatedByUserId: userId,
    });

    expect(stored?.username_ciphertext).toMatch(/^v1:/);
    expect(stored?.password_ciphertext).toMatch(/^v1:/);
    expect(JSON.stringify(stored)).not.toContain("administrativo");
    expect(JSON.stringify(stored)).not.toContain("senha-com-espacos");
    await expect(readFluigCredentials(userId)).resolves.toEqual({
      username: "administrativo",
      password: "senha-com-espacos  ",
    });
  });

  it("binds ciphertext to the configured encryption key", async () => {
    await saveFluigCredentials({
      userId,
      username: "administrativo",
      password: "segredo",
      updatedByUserId: userId,
    });
    process.env.FLUIG_CREDENTIALS_ENCRYPTION_KEY = Buffer.alloc(32, 8).toString("base64");

    await expect(readFluigCredentials(userId)).rejects.toThrow();
  });
});
