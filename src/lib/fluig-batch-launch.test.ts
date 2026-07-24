import { describe, expect, it } from "vitest";
import {
  batchFiscalDocumentKey,
  groupBatchFiscalFiles,
  type BatchFiscalDocument,
} from "@/lib/fluig-batch-launch";

function document(overrides: Partial<BatchFiscalDocument> = {}): BatchFiscalDocument {
  return {
    sourceType: "pdf",
    supplierName: "Fornecedor Teste",
    supplierCnpj: "00.801.587/0001-38",
    takerName: "Filial 1017",
    takerCnpj: "11.111.111/0001-11",
    invoiceNumber: "1592",
    issueDate: "2026-07-20",
    dueDate: "2026-07-30",
    amountCents: 42200,
    description: "Pagamento NF 1592",
    warnings: [],
    ...overrides,
  };
}

describe("groupBatchFiscalFiles", () => {
  it("agrupa PDF e XML da mesma nota pelo fornecedor e número", () => {
    const groups = groupBatchFiscalFiles([
      {
        attachment: { name: "nf-1592.pdf", mimeType: "application/pdf", size: 10, dataBase64: "YQ==" },
        document: document(),
        match: { source: "pdf" },
      },
      {
        attachment: { name: "nf-1592.xml", mimeType: "application/xml", size: 20, dataBase64: "Yg==" },
        document: document({ sourceType: "xml", description: "Descrição completa do XML" }),
        match: { source: "xml" },
      },
    ]);

    expect(groups).toHaveLength(1);
    expect(groups[0].attachments.map((item) => item.name)).toEqual(["nf-1592.pdf", "nf-1592.xml"]);
    expect(groups[0].document).toMatchObject({
      sourceType: "xml",
      description: "Descrição completa do XML",
    });
    expect(groups[0].match).toEqual({ source: "xml" });
  });

  it("mantém notas iguais de fornecedores diferentes separadas", () => {
    const groups = groupBatchFiscalFiles([
      {
        attachment: { name: "a.xml", mimeType: "application/xml", size: 10, dataBase64: "YQ==" },
        document: document({ sourceType: "xml", supplierCnpj: "00801587000138" }),
        match: null,
      },
      {
        attachment: { name: "b.xml", mimeType: "application/xml", size: 10, dataBase64: "Yg==" },
        document: document({ sourceType: "xml", supplierCnpj: "40441256000159" }),
        match: null,
      },
    ]);

    expect(groups).toHaveLength(2);
  });

  it("usa o arquivo como chave quando a nota não pôde ser identificada", () => {
    expect(batchFiscalDocumentKey(document({ supplierCnpj: null, supplierName: null, invoiceNumber: null }), "sem-dados.pdf"))
      .toBe("arquivo:sem-dados.pdf");
  });
});
