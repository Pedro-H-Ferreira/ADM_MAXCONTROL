import { describe, expect, it } from "vitest";
import { parseFiscalPdfText, parseFiscalXml } from "@/lib/fiscal-document";

describe("fiscal document extraction", () => {
  it("extrai emitente, destinatario, valores e datas de uma NFe XML", () => {
    const result = parseFiscalXml(`
      <nfeProc>
        <NFe>
          <infNFe>
            <ide><nNF>98765</nNF><dhEmi>2026-07-20T10:30:00-03:00</dhEmi></ide>
            <emit><CNPJ>12.345.678/0001-95</CNPJ><xNome>Fornecedor Exemplo Ltda</xNome></emit>
            <dest><CNPJ>11.222.333/0001-81</CNPJ><xNome>Filial 1017</xNome></dest>
            <total><ICMSTot><vNF>1234.56</vNF></ICMSTot></total>
            <cobr><dup><dVenc>2026-08-20</dVenc></dup></cobr>
          </infNFe>
        </NFe>
      </nfeProc>
    `);

    expect(result).toMatchObject({
      sourceType: "xml",
      supplierName: "Fornecedor Exemplo Ltda",
      supplierCnpj: "12.345.678/0001-95",
      takerName: "Filial 1017",
      takerCnpj: "11.222.333/0001-81",
      invoiceNumber: "98765",
      issueDate: "2026-07-20",
      dueDate: "2026-08-20",
      amountCents: 123456,
    });
  });

  it("extrai os campos reconheciveis do texto de uma DANFE PDF", () => {
    const result = parseFiscalPdfText(`
      EMITENTE
      RAZAO SOCIAL: Fornecedor PDF Ltda
      CNPJ: 12.345.678/0001-95
      DESTINATARIO
      RAZAO SOCIAL: Filial 1035
      CNPJ: 11.222.333/0001-81
      NUMERO DA NOTA FISCAL: 4567
      DATA DE EMISSAO: 21/07/2026
      VENCIMENTO: 20/08/2026
      VALOR TOTAL DA NOTA: R$ 2.345,67
    `);

    expect(result).toMatchObject({
      supplierCnpj: "12.345.678/0001-95",
      takerCnpj: "11.222.333/0001-81",
      invoiceNumber: "4567",
      issueDate: "2026-07-21",
      dueDate: "2026-08-20",
      amountCents: 234567,
    });
  });
});
