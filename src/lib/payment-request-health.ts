export type PaymentRequestHealthLevel =
  | "outside_competence"
  | "overdue"
  | "due_soon"
  | "ok"
  | "no_due_date";

export type PaymentRequestHealth = {
  level: PaymentRequestHealthLevel;
  label: string;
  description: string;
};

const dayMs = 24 * 60 * 60 * 1000;

function parseCalendarDate(value: string | null | undefined) {
  const normalized = String(value || "").trim();
  if (!normalized) return null;

  const brazilianDate = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (brazilianDate) {
    const [, day, month, year] = brazilianDate;
    return {
      year: Number(year),
      month: Number(month),
      timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day)),
    };
  }

  const isoDate = normalized.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) {
    const [, year, month, day] = isoDate;
    return {
      year: Number(year),
      month: Number(month),
      timestamp: Date.UTC(Number(year), Number(month) - 1, Number(day)),
    };
  }

  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return {
    year: parsed.getFullYear(),
    month: parsed.getMonth() + 1,
    timestamp: Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate()),
  };
}

export function classifyPaymentRequestHealth(input: {
  dueDate: string | null | undefined;
  issueDate: string | null | undefined;
  referenceTime: number | Date;
  dueSoonDays?: number;
}): PaymentRequestHealth {
  const reference = input.referenceTime instanceof Date
    ? input.referenceTime
    : new Date(input.referenceTime);
  const today = {
    year: reference.getFullYear(),
    month: reference.getMonth() + 1,
    timestamp: Date.UTC(reference.getFullYear(), reference.getMonth(), reference.getDate()),
  };
  const issueDate = parseCalendarDate(input.issueDate);
  const dueDate = parseCalendarDate(input.dueDate);

  if (issueDate && issueDate.year * 12 + issueDate.month < today.year * 12 + today.month) {
    return {
      level: "outside_competence",
      label: "Fora da competência",
      description: "Nota emitida em competência anterior e ainda em andamento.",
    };
  }

  if (!dueDate) {
    return {
      level: "no_due_date",
      label: "Sem vencimento",
      description: "A solicitação não possui uma data de vencimento válida.",
    };
  }

  const daysUntilDue = Math.round((dueDate.timestamp - today.timestamp) / dayMs);
  if (daysUntilDue < 0) {
    return {
      level: "overdue",
      label: "Atrasado",
      description: `Vencido há ${Math.abs(daysUntilDue)} dia(s).`,
    };
  }

  if (daysUntilDue <= (input.dueSoonDays ?? 3)) {
    return {
      level: "due_soon",
      label: daysUntilDue === 0 ? "Vence hoje" : "Vence em breve",
      description: daysUntilDue === 0 ? "Vencimento hoje." : `Vence em ${daysUntilDue} dia(s).`,
    };
  }

  return {
    level: "ok",
    label: "Em dia",
    description: `Vencimento em ${daysUntilDue} dia(s).`,
  };
}
