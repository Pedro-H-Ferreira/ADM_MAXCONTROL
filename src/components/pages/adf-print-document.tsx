"use client";

/* eslint-disable @next/next/no-img-element */

import { ArrowLeft, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  expenseAuthorizationStatusLabels,
  formatAuthorizationMoney,
  type ExpenseAuthorizationRecord,
} from "@/lib/expense-authorization";

const brandLogoUrl = "https://diaadiaatacadista.com.br/diaadia/img/logo-atcadao-dia-a-dia.webp";

function formatDate(value: string | null) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? value : new Intl.DateTimeFormat("pt-BR").format(parsed);
}

function safe(value: string | null | undefined) {
  return value?.trim() || "—";
}

function formatQuantity(value: number) {
  return new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 }).format(value);
}

function Field({ label, value, className = "" }: { label: string; value: React.ReactNode; className?: string }) {
  return (
    <div data-adf-field className={`min-h-11 border-b border-r border-slate-300 px-2.5 py-1.5 ${className}`}>
      <p className="text-[8px] font-semibold uppercase tracking-[0.08em] text-slate-500">{label}</p>
      <div className="mt-0.5 text-[10px] font-medium leading-4 text-slate-950">{value || "—"}</div>
    </div>
  );
}

function SectionTitle({ number, children }: { number: string; children: React.ReactNode }) {
  return (
    <div className="adf-section-title flex items-center gap-2 bg-slate-900 px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-white">
      <span className="grid size-4 place-items-center rounded-sm bg-white text-[8px] text-slate-900">{number}</span>
      {children}
    </div>
  );
}

export function AdfPrintDocument({ authorization }: { authorization: ExpenseAuthorizationRecord }) {
  const budgetPercent =
    authorization.budgetDeviationPercent == null
      ? authorization.budgetPlannedCents
        ? ((authorization.budgetDeviationCents || 0) / authorization.budgetPlannedCents) * 100
        : null
      : authorization.budgetDeviationPercent;
  const hasPurchaseItems = authorization.module === "compras" && authorization.items.length > 0;
  const sourceFields = authorization.sourceFields;
  const referenceFields: Array<[string, string | null | undefined]> =
    authorization.module === "pagamentos"
      ? [
          ["Nota fiscal", authorization.invoiceNumber || sourceFields.nNotaFiscal],
          ["Emissao da NF", authorization.issueDate || sourceFields.dataEmissaoNF],
          ["Vencimento", authorization.invoiceDueDate || sourceFields.vencPagNota],
          ["Forma de pagamento", sourceFields.formaPagamento || authorization.paymentMethod],
        ]
      : [
          ["Data do pedido", sourceFields.dataPedido],
          ["Modelo do processo", authorization.sourceRequestId],
          ["Itens da compra", authorization.items.length ? String(authorization.items.length) : null],
          [
            "Referencia / cotacao",
            sourceFields.numeroCotacao || sourceFields.referenciaCotacao || sourceFields.cotacao || sourceFields.observacao,
          ],
        ];
  const beneficiarySection = hasPurchaseItems ? "3" : "2";
  const paymentSection = hasPurchaseItems ? "4" : "3";
  const budgetSection = hasPurchaseItems ? "5" : "4";
  const trackingSection = hasPurchaseItems ? "6" : "5";

  return (
    <div className="adf-print-overlay fixed inset-0 z-[100] overflow-y-auto bg-slate-100 text-slate-950">
      <style jsx global>{`
        @page { size: A4 portrait; margin: 8mm; }
        @media print {
          html, body { background: #fff !important; }
          body > * { visibility: hidden !important; }
          .adf-print-overlay, .adf-print-overlay * { visibility: visible !important; }
          .adf-print-overlay { position: absolute !important; inset: 0 !important; overflow: visible !important; background: #fff !important; }
          .adf-print-actions { display: none !important; }
          .adf-paper { box-shadow: none !important; margin: 0 auto !important; width: 194mm !important; min-height: 279mm !important; }
          * { print-color-adjust: exact !important; -webkit-print-color-adjust: exact !important; }
        }
        .adf-paper--purchase { padding: 4mm !important; }
        .adf-paper--purchase .adf-header-cell { min-height: 56px !important; }
        .adf-paper--purchase [data-adf-field] { min-height: 34px !important; padding-top: 3px !important; padding-bottom: 3px !important; }
        .adf-paper--purchase .adf-section { margin-top: 5px !important; }
        .adf-paper--purchase .adf-section-title { padding-top: 3px !important; padding-bottom: 3px !important; }
        .adf-paper--purchase .adf-signatures { margin-top: 20px !important; }
      `}</style>

      <div className="adf-print-actions sticky top-0 z-10 flex items-center justify-between border-b bg-white/95 px-5 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => window.history.back()}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          Voltar ao controle
        </Button>
        <div className="text-center">
          <p className="text-sm font-semibold">Pre-visualizacao da ADF</p>
          <p className="text-xs text-muted-foreground">Formato A4 pronto para assinatura</p>
        </div>
        <Button onClick={() => window.print()}>
          <Printer className="size-4" aria-hidden="true" />
          Imprimir ou salvar PDF
        </Button>
      </div>

      <main className={`adf-paper mx-auto my-6 min-h-[279mm] w-[194mm] bg-white p-[7mm] shadow-xl ${hasPurchaseItems ? "adf-paper--purchase" : ""}`}>
        <header className="grid grid-cols-[148px_1fr_178px] items-center border border-slate-300">
          <div className="adf-header-cell flex min-h-[68px] items-center justify-center border-r border-slate-300 px-3">
            <img src={brandLogoUrl} alt="Atacadao Dia a Dia" className="h-auto w-[118px] object-contain" />
          </div>
          <div className="px-4 text-center">
            <p className="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-500">Documento administrativo</p>
            <h1 className="mt-1 text-[14px] font-bold uppercase leading-5">
              Autorizacao de Despesa
              <span className="block">Extra-Orcamentaria</span>
            </h1>
          </div>
          <div className="adf-header-cell min-h-[68px] border-l border-slate-300 text-[9px]">
            <div className="border-b border-slate-300 px-2.5 py-1.5">
              <p className="text-[7px] font-semibold uppercase text-slate-500">Numero da ADF</p>
              <p className="font-bold">{authorization.documentNumber}</p>
            </div>
            <div className="grid grid-cols-2">
              <div className="border-r border-slate-300 px-2.5 py-1.5">
                <p className="text-[7px] font-semibold uppercase text-slate-500">Emissao</p>
                <p className="font-semibold">{formatDate(authorization.issueDate)}</p>
              </div>
              <div className="px-2.5 py-1.5">
                <p className="text-[7px] font-semibold uppercase text-slate-500">Status</p>
                <p className="font-semibold">{expenseAuthorizationStatusLabels[authorization.status]}</p>
              </div>
            </div>
          </div>
        </header>

        <div className="mt-2 grid grid-cols-4 border-l border-t border-slate-300">
          <Field
            label="Origem"
            value={
              authorization.creationSource === "DOCUMENTO_FISCAL"
                ? `${authorization.module === "pagamentos" ? "Pagamento" : "Compra"} por PDF / XML`
                : authorization.creationSource === "MANUAL"
                  ? `${authorization.module === "pagamentos" ? "Pagamento" : "Compra"} manual`
                  : authorization.module === "pagamentos"
                    ? "Lancamento de pagamento"
                    : "Compra / cotacao"
            }
          />
          <Field label="Solicitacao Fluig" value={safe(authorization.fluigRequestId)} />
          <Field label="Filial" value={safe(authorization.branchLabel || authorization.branchCode)} />
          <Field label="Centro de custo" value={safe(authorization.costCenter)} />
        </div>

        <div className="grid grid-cols-4 border-l border-slate-300">
          {referenceFields.map(([label, value]) => (
            <Field key={label} label={label} value={safe(value)} />
          ))}
        </div>

        <section className="adf-section mt-2 border border-slate-300">
          <SectionTitle number="1">Identificacao e classificacao da despesa</SectionTitle>
          <div className="grid grid-cols-3 border-l border-t border-slate-300">
            <Field label="Tipo de despesa" value={safe(authorization.expenseType)} />
            <Field label="Conta de despesa" value={safe(authorization.expenseAccount)} />
            <Field label="Conta financeira / contabil" value={safe(authorization.financialAccount)} />
            <Field label="Objetivo e justificativa" value={safe(authorization.description)} className="col-span-3 min-h-[58px]" />
            <Field label="Valor total" value={formatAuthorizationMoney(authorization.amountCents)} />
            <Field label="Valor por extenso" value={safe(authorization.amountWords)} className="col-span-2" />
          </div>
        </section>

        {hasPurchaseItems ? (
          <section className="adf-section mt-2 border border-slate-300">
            <SectionTitle number="2">Itens e valores da compra / cotacao</SectionTitle>
            <div className="grid grid-cols-[28px_minmax(0,1fr)_86px_82px_82px] border-l border-t border-slate-300 bg-slate-50 text-[7px] font-semibold uppercase tracking-[0.06em] text-slate-500">
              <div className="border-b border-r border-slate-300 px-2 py-1">Item</div>
              <div className="border-b border-r border-slate-300 px-2 py-1">Produto ou servico</div>
              <div className="border-b border-r border-slate-300 px-2 py-1">Quantidade</div>
              <div className="border-b border-r border-slate-300 px-2 py-1">Unitario</div>
              <div className="border-b border-r border-slate-300 px-2 py-1">Total</div>
            </div>
            {authorization.items.slice(0, 5).map((item) => (
              <div key={item.id} className="grid grid-cols-[28px_minmax(0,1fr)_86px_82px_82px] border-l border-slate-300 text-[8px] leading-3.5">
                <div className="border-b border-r border-slate-300 px-2 py-1.5 text-center font-semibold">{item.lineNumber}</div>
                <div className="border-b border-r border-slate-300 px-2 py-1.5 font-medium">{item.description}</div>
                <div className="border-b border-r border-slate-300 px-2 py-1.5">{formatQuantity(item.quantity)} {item.unit}</div>
                <div className="border-b border-r border-slate-300 px-2 py-1.5">{formatAuthorizationMoney(item.unitPriceCents)}</div>
                <div className="border-b border-r border-slate-300 px-2 py-1.5 font-semibold">{formatAuthorizationMoney(item.totalCents)}</div>
              </div>
            ))}
            {authorization.items.length > 5 ? (
              <p className="px-2.5 py-1 text-[7px] text-slate-500">
                Mais {authorization.items.length - 5} item(ns) permanecem registrados no lancamento ADM.
              </p>
            ) : null}
          </section>
        ) : null}

        <section className="adf-section mt-2 border border-slate-300">
          <SectionTitle number={beneficiarySection}>Beneficiario</SectionTitle>
          <div className="grid grid-cols-4 border-l border-t border-slate-300">
            <Field label="Categoria" value={safe(authorization.beneficiaryCategory)} />
            <Field label="Nome / razao social" value={safe(authorization.beneficiaryName || authorization.supplierName)} className="col-span-2" />
            <Field label="CPF / CNPJ" value={safe(authorization.beneficiaryTaxId || authorization.supplierTaxId)} />
            <Field label="Telefone" value={safe(authorization.beneficiaryPhone)} />
            <Field label="Solicitante" value={safe(authorization.requesterName)} className="col-span-2" />
            <Field label="Funcao" value={safe(authorization.requesterRole)} />
          </div>
        </section>

        <section className="adf-section mt-2 border border-slate-300">
          <SectionTitle number={paymentSection}>Dados para pagamento</SectionTitle>
          <div className="grid grid-cols-5 border-l border-t border-slate-300">
            <Field label="Forma de pagamento" value={safe(authorization.paymentMethod)} />
            <Field label="Banco" value={safe(authorization.bankName)} />
            <Field label="Operacao" value={safe(authorization.bankOperation)} />
            <Field label="Agencia" value={safe(authorization.bankAgency)} />
            <Field label="Conta" value={safe(authorization.bankAccount)} />
            <Field label="Chave PIX" value={safe(authorization.pixKey)} className="col-span-5" />
          </div>
        </section>

        <section className="adf-section mt-2 border border-slate-300">
          <SectionTitle number={budgetSection}>Controle orcamentario</SectionTitle>
          <div className="grid grid-cols-4 border-l border-t border-slate-300">
            <Field label="Orcamento mensal" value={formatAuthorizationMoney(authorization.budgetPlannedCents)} />
            <Field label="Realizado no mes" value={formatAuthorizationMoney(authorization.budgetRealizedCents)} />
            <Field label="Desvio orcamentario" value={formatAuthorizationMoney(authorization.budgetDeviationCents)} />
            <Field label="Desvio percentual" value={budgetPercent == null || !Number.isFinite(budgetPercent) ? "Nao calculado" : `${budgetPercent.toFixed(2).replace(".", ",")}%`} />
          </div>
        </section>

        <section className="adf-section mt-2 border border-slate-300">
          <SectionTitle number={trackingSection}>Informacoes adicionais e rastreabilidade</SectionTitle>
          <div className="grid grid-cols-3 border-l border-t border-slate-300">
            <Field label="Informacoes adicionais" value={safe(authorization.additionalInfo)} className="col-span-3 min-h-[58px]" />
            <Field label="Enviada para assinatura" value={formatDate(authorization.sentForSignatureAt)} />
            <Field label="Assinada / retornada" value={formatDate(authorization.signedDocumentReceivedAt)} />
            <Field label="Entregue" value={formatDate(authorization.deliveredAt)} />
            <Field label="Localizacao atual" value={safe(authorization.physicalLocation)} />
            <Field label="Entregue para" value={safe(authorization.deliveredTo)} />
            <Field label="Anexada no Fluig" value={formatDate(authorization.attachedToFluigAt)} />
          </div>
        </section>

        <section className="mt-3 border border-slate-300 px-4 py-3">
          <p className="text-[8px] leading-4 text-slate-600">
            Declaro que as informacoes apresentadas nesta autorizacao correspondem a necessidade administrativa indicada,
            com documentacao de suporte disponivel para conferencia. A realizacao da despesa depende da autorizacao abaixo.
          </p>
          <div className="adf-signatures mt-9 grid grid-cols-2 gap-12 text-center text-[9px]">
            <div>
              <div className="border-t border-slate-700 pt-1 font-semibold">Solicitante / responsavel</div>
              <div className="mt-1 text-[8px] text-slate-500">Nome, assinatura e data</div>
            </div>
            <div>
              <div className="border-t border-slate-700 pt-1 font-semibold">Autorizacao da Diretoria</div>
              <div className="mt-1 text-[8px] text-slate-500">Nome, assinatura e data</div>
            </div>
          </div>
        </section>

        <footer className="mt-3 flex items-center justify-between border-t border-slate-300 pt-2 text-[7px] uppercase tracking-[0.08em] text-slate-500">
          <span>Modelo ADF ADM MaxControl · Revisao 01</span>
          <span>{authorization.documentNumber} · Pagina 1 de 1</span>
          <span>Documento controlado</span>
        </footer>
      </main>
    </div>
  );
}
