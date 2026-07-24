import { describe, expect, it } from "vitest";
import {
  buildMonthlyExpenseDashboard,
  isFreightTransferExpense,
  type MonthlyExpenseSourceRow,
} from "@/lib/monthly-expense-monitor";

function row(
  id: string,
  openedAt: string,
  overrides: Partial<MonthlyExpenseSourceRow> = {}
): MonthlyExpenseSourceRow {
  return {
    id,
    fluig_request_id: id,
    supplier_name: "13130 - NEOENERGIA DISTRIBUICAO BRASILIA S A",
    supplier_cnpj: "07522669000192",
    branch_code: "1017",
    branch_label: "1017 - 1017-CD",
    expense_nature: "5030103 - ENERGIA ELETRICA - REDE GERAL",
    amount_cents: 100_00,
    status: "Em andamento",
    normalized_status: "em_andamento",
    opened_at: openedAt,
    last_synced_at: openedAt,
    ...overrides,
  };
}

describe("monitor de contas mensais", () => {
  it("exclui explicitamente frete de transferencia de produtos e DANFE", () => {
    expect(isFreightTransferExpense("4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE")).toBe(true);
    const freightRows = Array.from({ length: 12 }, (_, index) =>
      row(`frete-${index}`, `2026-${String((index % 3) + 4).padStart(2, "0")}-10T10:00:00Z`, {
        supplier_name: "TALISMA TRANSPORTE E LOGISTICA LTDA",
        supplier_cnpj: "40441256000159",
        expense_nature: "4010210 - FRETE TRANSFERENCIA DE PRODUTOS - DANFE",
      })
    );

    expect(
      buildMonthlyExpenseDashboard(freightRows, {
        selectedMonth: "2026-07",
        currentMonth: "2026-07",
      }).profiles
    ).toHaveLength(0);
  });

  it("acompanha agua, energia e internet mesmo com historico inicial curto", () => {
    const dashboard = buildMonthlyExpenseDashboard(
      [
        row("energia-maio", "2026-05-10T10:00:00Z"),
        row("energia-junho", "2026-06-10T10:00:00Z"),
        row("agua-junho", "2026-06-12T10:00:00Z", {
          supplier_name: "COMPANHIA DE SANEAMENTO",
          supplier_cnpj: "0082024000137",
          expense_nature: "5030101 - AGUA E ESGOTO",
        }),
      ],
      { selectedMonth: "2026-07", currentMonth: "2026-07" }
    );

    expect(dashboard.profiles).toHaveLength(2);
    expect(dashboard.metrics).toMatchObject({ expected: 2, launched: 0, pending: 2, branchesWithPending: 1 });
    expect(dashboard.profiles.every((profile) => profile.selectedMonth.status === "PENDENTE")).toBe(true);
  });

  it("reconhece outra despesa de baixa frequencia em tres meses como recorrente", () => {
    const dashboard = buildMonthlyExpenseDashboard(
      [
        row("abril", "2026-04-05T10:00:00Z", { expense_nature: "5049999 - SERVICO RECORRENTE" }),
        row("maio", "2026-05-05T10:00:00Z", { expense_nature: "5049999 - SERVICO RECORRENTE" }),
        row("junho", "2026-06-05T10:00:00Z", { expense_nature: "5049999 - SERVICO RECORRENTE" }),
      ],
      { selectedMonth: "2026-07", currentMonth: "2026-07" }
    );

    expect(dashboard.profiles[0]).toMatchObject({
      detection: "HISTORICO_MENSAL",
      selectedMonth: { status: "PENDENTE" },
    });
  });

  it("mostra lancamento e historico dos meses anteriores", () => {
    const dashboard = buildMonthlyExpenseDashboard(
      [
        row("maio", "2026-05-10T10:00:00Z"),
        row("junho", "2026-06-10T10:00:00Z"),
        row("julho", "2026-07-10T10:00:00Z", { amount_cents: 250_00 }),
      ],
      { selectedMonth: "2026-07", currentMonth: "2026-07" }
    );
    const profile = dashboard.profiles[0];

    expect(profile.selectedMonth).toMatchObject({
      status: "LANCADA",
      launchCount: 1,
      amountCents: 250_00,
      fluigRequestIds: ["julho"],
    });
    expect(profile.history.find((item) => item.month === "2026-04")?.status).toBe("SEM_HISTORICO");
    expect(dashboard.metrics.compliancePercent).toBe(100);
  });
});
