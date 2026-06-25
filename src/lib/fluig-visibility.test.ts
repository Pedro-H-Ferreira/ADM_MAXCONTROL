import { describe, expect, it } from "vitest";
import {
  buildFluigActorPostgrestFilter,
  filterFluigRowsForActor,
  fluigActorIdentityValues,
  isFluigRowVisibleForActor,
  type FluigVisibilityActor,
} from "@/lib/fluig-visibility";

const actor: FluigVisibilityActor = {
  id: "69b503e0-dc95-47f9-a635-680551d10e65",
  isAdmin: false,
  branchCodes: ["1017", "1060"],
  fluigUsername: "administrativo@dvaatacados.com.br",
  fluigUserId: "00130",
  email: "usuario@dvaatacados.com.br",
};

describe("Fluig visibility", () => {
  it("considera todas as identidades Fluig do usuario", () => {
    expect(fluigActorIdentityValues(actor)).toEqual([
      "administrativo@dvaatacados.com.br",
      "00130",
      "usuario@dvaatacados.com.br",
    ]);
  });

  it("permite filial, criador e dono da sincronizacao", () => {
    expect(isFluigRowVisibleForActor(actor, { branch_code: "1017" })).toBe(true);
    expect(isFluigRowVisibleForActor(actor, { created_by_user_id: actor.id })).toBe(true);
    expect(isFluigRowVisibleForActor(actor, { sync_owner_user_id: actor.id })).toBe(true);
  });

  it("reconhece usuario e codigo Fluig mesmo quando ambos existem no perfil", () => {
    expect(isFluigRowVisibleForActor(actor, { fluig_requester_login: "administrativo@dvaatacados.com.br" })).toBe(true);
    expect(isFluigRowVisibleForActor(actor, { fluig_requester_code: "00130" })).toBe(true);
    expect(isFluigRowVisibleForActor(actor, { requester: "Solicitante 00130 - Administrativo CD" })).toBe(true);
  });

  it("rejeita solicitacao sem relacao com usuario ou filial", () => {
    expect(
      isFluigRowVisibleForActor(actor, {
        branch_code: "9999",
        sync_owner_user_id: "b52f8e16-760c-4e8d-8ccf-bc67950a31e4",
        fluig_requester_login: "outro@dvaatacados.com.br",
      })
    ).toBe(false);
  });

  it("gera filtro PostgREST equivalente ao filtro defensivo", () => {
    const filter = buildFluigActorPostgrestFilter(actor);

    expect(filter).toContain(`created_by_user_id.eq.${actor.id}`);
    expect(filter).toContain(`sync_owner_user_id.eq.${actor.id}`);
    expect(filter).toContain('branch_code.in.("1017","1060")');
    expect(filter).toContain('fluig_requester_login.ilike."administrativo@dvaatacados.com.br"');
    expect(filter).toContain('fluig_requester_code.ilike."00130"');
  });

  it("filtra uma colecao sem perder registros sincronizados pelo usuario", () => {
    const rows = [
      { id: "branch", branch_code: "1060" },
      { id: "owner", sync_owner_user_id: actor.id },
      { id: "other", branch_code: "9999" },
    ];

    expect(filterFluigRowsForActor(actor, rows).map((row) => row.id)).toEqual(["branch", "owner"]);
  });
});
