import crypto from "node:crypto";
import { getSupabaseServiceClient } from "@/lib/supabase/service";

const cipherVersion = "v1";
const keyLength = 32;

export type FluigUserCredentials = {
  username: string;
  password: string;
};

function encryptionKey() {
  const configured = String(process.env.FLUIG_CREDENTIALS_ENCRYPTION_KEY || "").trim();
  if (!configured) {
    throw new Error("FLUIG_CREDENTIALS_ENCRYPTION_KEY nao configurada na VPS.");
  }

  const key = /^[a-f\d]{64}$/i.test(configured)
    ? Buffer.from(configured, "hex")
    : Buffer.from(configured, "base64");
  if (key.length !== keyLength) {
    throw new Error("FLUIG_CREDENTIALS_ENCRYPTION_KEY deve conter exatamente 32 bytes em base64 ou hexadecimal.");
  }
  return key;
}

function additionalData(userId: string, field: "username" | "password") {
  return Buffer.from(`adm-maxcontrol:fluig:${userId}:${field}`, "utf8");
}

function encryptCredential(userId: string, field: "username" | "password", value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  cipher.setAAD(additionalData(userId, field));
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [cipherVersion, iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(":");
}

function decryptCredential(userId: string, field: "username" | "password", value: string) {
  const [version, ivValue, tagValue, encryptedValue] = value.split(":");
  if (version !== cipherVersion || !ivValue || !tagValue || !encryptedValue) {
    throw new Error("Credencial Fluig possui formato de criptografia invalido.");
  }

  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAAD(additionalData(userId, field));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

function serviceClient() {
  const client = getSupabaseServiceClient();
  if (!client) throw new Error("Supabase service role nao configurado no servidor.");
  return client;
}

export async function listFluigCredentialUserIds() {
  const { data, error } = await serviceClient().from("fluig_user_credentials").select("user_id");
  if (error) throw error;
  return new Set((data || []).map((row) => String(row.user_id)));
}

export async function hasFluigCredentials(userId: string) {
  const { data, error } = await serviceClient()
    .from("fluig_user_credentials")
    .select("user_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function readFluigCredentials(userId: string): Promise<FluigUserCredentials> {
  const { data, error } = await serviceClient()
    .from("fluig_user_credentials")
    .select("username_ciphertext,password_ciphertext")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error("Credenciais Fluig nao cadastradas para este usuario.");
  }

  return {
    username: decryptCredential(userId, "username", String(data.username_ciphertext)),
    password: decryptCredential(userId, "password", String(data.password_ciphertext)),
  };
}

export async function saveFluigCredentials(input: {
  userId: string;
  username: string;
  password?: string;
  updatedByUserId: string;
}) {
  const username = input.username.trim();
  if (!username) throw new Error("Usuario Fluig e obrigatorio para salvar a credencial.");

  const client = serviceClient();
  const { data: current, error: readError } = await client
    .from("fluig_user_credentials")
    .select("password_ciphertext")
    .eq("user_id", input.userId)
    .maybeSingle();
  if (readError) throw readError;

  const password = input.password;
  if ((!password || password.length === 0) && !current) {
    throw new Error("Senha Fluig e obrigatoria no primeiro cadastro da credencial.");
  }

  const payload = {
    user_id: input.userId,
    username_ciphertext: encryptCredential(input.userId, "username", username),
    password_ciphertext: password
      ? encryptCredential(input.userId, "password", password)
      : String(current?.password_ciphertext || ""),
    cipher_version: 1,
    updated_by_user_id: input.updatedByUserId,
    last_tested_at: null,
    last_test_status: null,
    last_test_error: null,
    updated_at: new Date().toISOString(),
  };
  const { error } = await client.from("fluig_user_credentials").upsert(payload, { onConflict: "user_id" });
  if (error) throw error;
}

export async function deleteFluigCredentials(userId: string) {
  const { error } = await serviceClient().from("fluig_user_credentials").delete().eq("user_id", userId);
  if (error) throw error;
}

export async function recordFluigCredentialTest(input: {
  userId: string;
  success: boolean;
  errorMessage?: string | null;
}) {
  const { error } = await serviceClient()
    .from("fluig_user_credentials")
    .update({
      last_tested_at: new Date().toISOString(),
      last_test_status: input.success ? "success" : "error",
      last_test_error: input.success ? null : input.errorMessage?.slice(0, 1000) || "Falha ao autenticar no Fluig.",
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", input.userId);
  if (error) throw error;
}
