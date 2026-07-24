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
      documentType: "nfe",
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
      documentType: "nfe",
      supplierCnpj: "12.345.678/0001-95",
      takerCnpj: "11.222.333/0001-81",
      invoiceNumber: "4567",
      issueDate: "2026-07-21",
      dueDate: "2026-08-20",
      amountCents: 234567,
    });
  });

  it("reconhece uma NFS-e nacional e separa prestador e tomador", () => {
    const result = parseFiscalPdfText(`
      DANFSe Documento Auxiliar da NFS-e
      Número da NFS-e 1564
      Competência da NFS-e 23/07/2026
      Data e Hora da emissão da NFS-e 23/07/2026 17:40:20
      EMITENTE DA NFS-e Prestador do Serviço
      CNPJ / CPF / NIF 49.437.823/0001-78
      Nome / Nome Empresarial RONIS DE AGUIAR VIEIRA
      TOMADOR DO SERVIÇO
      CNPJ / CPF / NIF 17.457.404/0014-26
      Nome / Nome Empresarial ATACADAO DIA A DIA S.A
      Vl. do Serviço: R$ 640,00
      Vencimento da nota fiscal: 30/07/2026
    `);

    expect(result).toMatchObject({
      documentType: "nfse",
      supplierCnpj: "49.437.823/0001-78",
      takerCnpj: "17.457.404/0014-26",
      invoiceNumber: "1564",
      issueDate: "2026-07-23",
      dueDate: "2026-07-30",
      amountCents: 64000,
    });
  });

  it("reconhece CT-e/DACTE e o valor da prestacao", () => {
    const result = parseFiscalPdfText(`
      CNPJ: 40.441.256/0001-59 DACTE
      Documento Auxiliar do Conhecimento de Transporte Eletrônico
      MODELO SÉRIE NÚMERO FL DATA E HORA EMISSÃO
      57 001 000.033.254 1/1 RODOVIÁRIO 18/07/2026 18:52:23
      TOMADOR DO SERVIÇO CNPJ/CPF: 17.457.404/0039-84
      VALOR A RECEBER VALOR TOTAL DO SERVIÇO 5.700,00 5.700,00
    `);

    expect(result).toMatchObject({
      documentType: "cte",
      supplierCnpj: "40.441.256/0001-59",
      takerCnpj: "17.457.404/0039-84",
      invoiceNumber: "33254",
      issueDate: "2026-07-18",
      amountCents: 570000,
    });
  });

  it("reconhece fatura de locacao com data de dois digitos", () => {
    const result = parseFiscalPdfText(`
      DISKTRANS COMERCIAL LTDA. CNPJ: 66.616.970/0001-24
      FATURA DE LOCAÇÃO DE BENS MÓVEIS
      CNPJ: 17.457.404/0009-69
      Número: 659851 Data Emissão: 01/07/26 Data Vencto: 05/08/26
      TOTAL (R$) 1.050,00
    `);

    expect(result).toMatchObject({
      documentType: "invoice",
      supplierCnpj: "66.616.970/0001-24",
      takerCnpj: "17.457.404/0009-69",
      invoiceNumber: "659851",
      issueDate: "2026-07-01",
      dueDate: "2026-08-05",
      amountCents: 105000,
    });
  });

  it("avisa quando o PDF e apenas uma imagem sem texto pesquisavel", () => {
    const result = parseFiscalPdfText("-- 1 of 1 --");

    expect(result.documentType).toBe("unknown");
    expect(result.warnings).toContain(
      "Este PDF parece ser uma imagem digitalizada e nao possui texto pesquisavel. Envie o XML ou um PDF com texto, ou preencha os campos manualmente."
    );
  });
});
