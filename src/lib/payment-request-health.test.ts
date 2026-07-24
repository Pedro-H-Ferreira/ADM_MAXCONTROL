import { describe, expect, it } from "vitest";
import { classifyPaymentRequestHealth } from "@/lib/payment-request-health";

const referenceTime = new Date(2026, 7, 15, 10, 0, 0);

describe("classifyPaymentRequestHealth", () => {
  it("prioriza notas fora da competência mesmo quando também estão vencidas", () => {
    expect(classifyPaymentRequestHealth({
      issueDate: "30/06/2026",
      dueDate: "10/07/2026",
      referenceTime,
    }).level).toBe("outside_competence");
  });

  it("marca como atrasado quando o vencimento já passou na competência atual", () => {
    expect(classifyPaymentRequestHealth({
      issueDate: "01/08/2026",
      dueDate: "14/08/2026",
      referenceTime,
    }).level).toBe("overdue");
  });

  it("diferencia vencimento próximo de solicitação em dia", () => {
    expect(classifyPaymentRequestHealth({
      issueDate: "01/08/2026",
      dueDate: "18/08/2026",
      referenceTime,
    }).level).toBe("due_soon");
    expect(classifyPaymentRequestHealth({
      issueDate: "01/08/2026",
      dueDate: "25/08/2026",
      referenceTime,
    }).level).toBe("ok");
  });

  it("aceita datas ISO e informa quando não há vencimento", () => {
    expect(classifyPaymentRequestHealth({
      issueDate: "2026-08-01",
      dueDate: null,
      referenceTime,
    }).level).toBe("no_due_date");
  });
});
