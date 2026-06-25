export type FluigVisibilityActor = {
  id: string;
  isAdmin: boolean;
  branchCodes: string[];
  fluigUsername?: string | null;
  fluigUserId?: string | null;
  email?: string | null;
};

export type FluigVisibilityRow = {
  branch_code?: string | null;
  created_by_user_id?: string | null;
  sync_owner_user_id?: string | null;
  fluig_requester_login?: string | null;
  fluig_requester_code?: string | null;
  requester?: string | null;
};

function normalizedIdentity(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function fluigActorIdentityValues(actor: FluigVisibilityActor) {
  return Array.from(
    new Set(
      [actor.fluigUsername, actor.fluigUserId, actor.email]
        .map(normalizedIdentity)
        .filter(Boolean)
    )
  );
}

export function isFluigRowVisibleForActor(actor: FluigVisibilityActor | null | undefined, row: FluigVisibilityRow) {
  if (!actor || actor.isAdmin) return true;

  const rowBranch = String(row.branch_code || "").trim();
  if (rowBranch && actor.branchCodes.includes(rowBranch)) return true;
  if (row.created_by_user_id === actor.id || row.sync_owner_user_id === actor.id) return true;

  const identities = fluigActorIdentityValues(actor);
  if (!identities.length) return false;

  const requesterLogin = normalizedIdentity(row.fluig_requester_login);
  const requesterCode = normalizedIdentity(row.fluig_requester_code);
  if (identities.includes(requesterLogin) || identities.includes(requesterCode)) return true;

  const requester = normalizedIdentity(row.requester);
  return identities.some((identity) => requester.includes(identity));
}

function quotePostgrestValue(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function safeRequesterIdentity(value: string) {
  const trimmed = value.trim();
  return /^[a-z0-9@.+-]+$/i.test(trimmed) ? trimmed : null;
}

export function buildFluigActorPostgrestFilter(actor: FluigVisibilityActor | null | undefined) {
  if (!actor || actor.isAdmin) return null;

  const conditions = [
    `created_by_user_id.eq.${actor.id}`,
    `sync_owner_user_id.eq.${actor.id}`,
  ];
  const branchCodes = Array.from(new Set(actor.branchCodes.map((code) => code.trim()).filter(Boolean)));
  if (branchCodes.length) {
    conditions.push(`branch_code.in.(${branchCodes.map(quotePostgrestValue).join(",")})`);
  }

  for (const identity of fluigActorIdentityValues(actor)) {
    const safeIdentity = safeRequesterIdentity(identity);
    if (!safeIdentity) continue;
    const quotedIdentity = quotePostgrestValue(safeIdentity);
    conditions.push(`fluig_requester_login.ilike.${quotedIdentity}`);
    conditions.push(`fluig_requester_code.ilike.${quotedIdentity}`);
    conditions.push(`requester.ilike.${quotePostgrestValue(`*${safeIdentity}*`)}`);
  }

  return conditions.join(",");
}

export function filterFluigRowsForActor<T extends FluigVisibilityRow>(
  actor: FluigVisibilityActor | null | undefined,
  rows: T[]
) {
  return rows.filter((row) => isFluigRowVisibleForActor(actor, row));
}
