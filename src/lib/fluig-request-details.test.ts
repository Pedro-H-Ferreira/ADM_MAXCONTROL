import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { __test } = require("../../scripts/fluig/requestDetails.js") as {
  __test: {
    normalizeAttachments: (payload: unknown) => Array<Record<string, unknown>>;
    normalizeFormFields: (payload: unknown) => Record<string, string>;
    normalizeHistory: (payload: unknown) => Array<Record<string, unknown>>;
  };
};

describe("detalhes da solicitacao Fluig", () => {
  it("normaliza formulario, anexos e historico retornados pelo Fluig", () => {
    expect(__test.normalizeFormFields({
      formFields: [
        { name: "nNotaFiscal", value: "3737" },
        { name: "valorNF", value: "1.105,92" },
      ],
    })).toEqual({ nNotaFiscal: "3737", valorNF: "1.105,92" });

    expect(__test.normalizeAttachments({ items: [{ attachmentSequence: 4, documentName: "NF-3737.pdf", size: 2048 }] }))
      .toEqual([expect.objectContaining({ sequence: "4", name: "NF-3737.pdf", size: 2048 })]);

    expect(__test.normalizeHistory({ content: [{
      movementSequence: 30,
      title: "Compras Administrativo",
      activity: "Analisar e Cotar Solicitacao de Compra",
      choosedActivity: "Cotacao",
      movementDate: "25/06/2026 16:35:14",
      observation: "Anexar aprovacao extra orcamentaria.",
    }] })).toEqual([expect.objectContaining({
      sequence: "30",
      user: "Compras Administrativo",
      activity: "Analisar e Cotar Solicitacao de Compra",
      destination: "Cotacao",
      observation: "Anexar aprovacao extra orcamentaria.",
    })]);

    expect(__test.normalizeHistory({ items: [{
      type: "observation",
      movementSequence: 31,
      state: { stateName: "Cotacao" },
      targetState: { stateName: "Nota Aprovada" },
      user: { name: "Compras Administrativo" },
      observationDescription: "Cotacao validada.",
      date: "2026-06-25T16:35:14-03:00",
    }] })).toEqual([expect.objectContaining({
      sequence: "31",
      user: "Compras Administrativo",
      activity: "Cotacao",
      destination: "Nota Aprovada",
      observation: "Cotacao validada.",
    })]);

    expect(__test.normalizeFormFields({ items: [{ formFields: { nNotaFiscal: "4844" } }] }))
      .toEqual({ nNotaFiscal: "4844" });
  });
});
