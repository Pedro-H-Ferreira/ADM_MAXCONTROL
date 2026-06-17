const requiredClientEnv = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
] as const;

export function getPublicEnv() {
  const values = {
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
    supabaseAnonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };

  const missing = requiredClientEnv.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing public environment variables: ${missing.join(", ")}`);
  }

  return values as {
    supabaseUrl: string;
    supabaseAnonKey: string;
  };
}

export function getServerEnv() {
  return {
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    resendApiKey: process.env.RESEND_API_KEY,
    resendFromEmail: process.env.RESEND_FROM_EMAIL,
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    fluigIntegrationMode: process.env.FLUIG_INTEGRATION_MODE,
    fluigApiBaseUrl: process.env.FLUIG_API_BASE_URL || process.env.NEXT_PUBLIC_FLUIG_API_BASE_URL,
    fluigDirectRunnerRoot: process.env.FLUIG_DIRECT_RUNNER_ROOT,
    fluigOperationConfirmationRequired: process.env.FLUIG_OPERATION_CONFIRMATION_REQUIRED,
    fluigTaskUserId: process.env.FLUIG_TASK_USER_ID,
  };
}
