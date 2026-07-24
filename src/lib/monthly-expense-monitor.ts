export type MonthlyExpenseSourceRow = {
  id: string;
  fluig_request_id: string | null;
  supplier_name: string | null;
  supplier_cnpj: string | null;
  branch_code: string | null;
  branch_label: string | null;
  expense_nature: string | null;
  amount_cents: number | null;
  status: string | null;
  normalized_status: string | null;
  opened_at: string | null;
  last_synced_at: string | null;
};

export type MonthlyExpenseMonthStatus = {
  month: string;
  status: "LANCADA" | "PENDENTE" | "SEM_HISTORICO";
  launchCount: number;
  amountCents: number;
  fluigRequestIds: string[];
  latestOpenedAt: string | null;
};

export type MonthlyExpenseProfile = {
  id: string;
  supplierName: string;
  supplierCnpj: string | null;
  branchCode: string;
  branchLabel: string;
  expenseNature: string;
  category: string;
  detection: "NATUREZA_RECORRENTE" | "HISTORICO_MENSAL";
  firstSeenMonth: string;
  lastSeenMonth: string;
  occurrenceCount: number;
  observedMonthCount: number;
  selectedMonth: MonthlyExpenseMonthStatus;
  history: MonthlyExpenseMonthStatus[];
  latestFluigRequestId: string | null;
  latestStatus: string | null;
};

export type MonthlyExpenseBranchSummary = {
  branchCode: string;
  branchLabel: string;
  expected: number;
  launched: number;
  pending: number;
  compliancePercent: number;
};

export type MonthlyExpenseDashboard = {
  selectedMonth: string;
  availableMonths: string[];
  profiles: MonthlyExpenseProfile[];
  branches: MonthlyExpenseBranchSummary[];
  metrics: {
    expected: number;
    launched: number;
    pending: number;
    branchesWithPending: number;
    compliancePercent: number;
  };
};

const strongMonthlyNaturePatterns: Array<{ pattern: string; category: string }> = [
  { pattern: "AGUA E ESGOTO", category: "Água e esgoto" },
  { pattern: "ENERGIA ELETRICA", category: "Energia elétrica" },
  { pattern: "LINKS E TELEFONIA", category: "Internet e telefonia" },
  { pattern: "INTERNET", category: "Internet e telefonia" },
  { pattern: "TELEFON", category: "Internet e telefonia" },
  { pattern: "ALUGUEL", category: "Aluguel" },
  { pattern: "CONDOMIN", category: "Condomínio" },
  { pattern: "SISTEMA ERP", category: "Sistemas e software" },
  { pattern: "SOFTWARE", category: "Sistemas e software" },
  { pattern: "LICENCA", category: "Licenças" },
  { pattern: "PLANO DE SAUDE", category: "Plano de saúde" },
  { pattern: "SEGURO", category: "Seguros" },
];

function normalize(value: unknown) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function digits(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

export function isFreightTransferExpense(nature: string | null | undefined) {
  const value = normalize(nature);
  return (
    value.startsWith("4010210") ||
    value.includes("FRETE TRANSFERENCIA DE PRODUTOS") ||
    (value.includes("FRETE") && value.includes("DANFE"))
  );
}

function monthlyNatureCategory(nature: string | null | undefined) {
  const value = normalize(nature);
  return strongMonthlyNaturePatterns.find((item) => value.includes(item.pattern))?.category || null;
}

export function isMonthlyExpensePattern(input: {
  nature: string | null | undefined;
  occurrenceCount: number;
  monthCounts: number[];
}) {
  if (isFreightTransferExpense(input.nature) || !input.monthCounts.length) return false;
  if (monthlyNatureCategory(input.nature)) return input.monthCounts.length >= 2;
  const averagePerMonth = input.occurrenceCount / input.monthCounts.length;
  return input.monthCounts.length >= 3 && averagePerMonth <= 2.5 && Math.max(...input.monthCounts) <= 4;
}

function rowTimestamp(row: MonthlyExpenseSourceRow) {
  return row.opened_at || row.last_synced_at;
}

function monthKey(value: string | null | undefined) {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})/.exec(value);
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[1]}-${match[2]}` : null;
}

function addMonths(month: string, delta: number) {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, monthNumber - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthDistance(from: string, to: string) {
  const [fromYear, fromMonth] = from.split("-").map(Number);
  const [toYear, toMonth] = to.split("-").map(Number);
  return (toYear - fromYear) * 12 + toMonth - fromMonth;
}

function monthRange(endMonth: string, length: number) {
  return Array.from({ length }, (_, index) => addMonths(endMonth, index - length + 1));
}

function profileKey(row: MonthlyExpenseSourceRow) {
  const supplier = digits(row.supplier_cnpj) || normalize(row.supplier_name);
  const branch = normalize(row.branch_code || row.branch_label);
  const nature = normalize(row.expense_nature);
  return supplier && branch && nature ? `${supplier}:${branch}:${nature}` : null;
}

function monthStatus(
  month: string,
  firstSeenMonth: string,
  rows: MonthlyExpenseSourceRow[]
): MonthlyExpenseMonthStatus {
  if (month < firstSeenMonth) {
    return {
      month,
      status: "SEM_HISTORICO",
      launchCount: 0,
      amountCents: 0,
      fluigRequestIds: [],
      latestOpenedAt: null,
    };
  }
  const launches = rows
    .filter((row) => monthKey(rowTimestamp(row)) === month)
    .sort((left, right) => String(rowTimestamp(right) || "").localeCompare(String(rowTimestamp(left) || "")));
  return {
    month,
    status: launches.length ? "LANCADA" : "PENDENTE",
    launchCount: launches.length,
    amountCents: launches.reduce((sum, row) => sum + Number(row.amount_cents || 0), 0),
    fluigRequestIds: launches.map((row) => row.fluig_request_id).filter((id): id is string => Boolean(id)),
    latestOpenedAt: rowTimestamp(launches[0] || ({} as MonthlyExpenseSourceRow)) || null,
  };
}

export function buildMonthlyExpenseDashboard(
  rows: MonthlyExpenseSourceRow[],
  input: { selectedMonth: string; currentMonth: string; historyLength?: number }
): MonthlyExpenseDashboard {
  const historyLength = Math.min(Math.max(input.historyLength || 6, 3), 12);
  const months = monthRange(input.selectedMonth, historyLength);
  const grouped = new Map<string, MonthlyExpenseSourceRow[]>();

  for (const row of rows) {
    const rowMonth = monthKey(rowTimestamp(row));
    const key = profileKey(row);
    if (!key || !rowMonth || rowMonth > input.currentMonth || isFreightTransferExpense(row.expense_nature)) continue;
    grouped.set(key, [...(grouped.get(key) || []), row]);
  }

  const profiles = Array.from(grouped.entries())
    .map(([id, groupRows]) => {
      const sorted = [...groupRows].sort((left, right) =>
        String(rowTimestamp(left) || "").localeCompare(String(rowTimestamp(right) || ""))
      );
      const latest = sorted[sorted.length - 1];
      const observedMonths = new Set(sorted.map((row) => monthKey(rowTimestamp(row))).filter(Boolean) as string[]);
      const firstSeenMonth = [...observedMonths].sort()[0];
      const lastSeenMonth = [...observedMonths].sort().at(-1)!;
      const category = monthlyNatureCategory(latest.expense_nature);
      const countsByMonth = new Map<string, number>();
      for (const row of sorted) {
        const month = monthKey(rowTimestamp(row));
        if (month) countsByMonth.set(month, (countsByMonth.get(month) || 0) + 1);
      }
      const historicalMonthly =
        monthDistance(firstSeenMonth, lastSeenMonth) >= 2 &&
        isMonthlyExpensePattern({
          nature: latest.expense_nature,
          occurrenceCount: sorted.length,
          monthCounts: [...countsByMonth.values()],
        });
      const isActive = monthDistance(lastSeenMonth, input.currentMonth) <= 6;
      if ((!category && !historicalMonthly) || !isActive) return null;

      const history = months.map((month) => monthStatus(month, firstSeenMonth, sorted));
      const selectedMonth = history.find((item) => item.month === input.selectedMonth)!;
      return {
        id,
        supplierName: latest.supplier_name?.trim() || "Fornecedor não identificado",
        supplierCnpj: latest.supplier_cnpj?.trim() || null,
        branchCode: latest.branch_code?.trim() || latest.branch_label?.trim() || "Sem código",
        branchLabel: latest.branch_label?.trim() || latest.branch_code?.trim() || "Filial não identificada",
        expenseNature: latest.expense_nature?.trim() || "Natureza não identificada",
        category: category || "Recorrência mensal",
        detection: category ? "NATUREZA_RECORRENTE" : "HISTORICO_MENSAL",
        firstSeenMonth,
        lastSeenMonth,
        occurrenceCount: sorted.length,
        observedMonthCount: observedMonths.size,
        selectedMonth,
        history,
        latestFluigRequestId: latest.fluig_request_id,
        latestStatus: latest.normalized_status || latest.status,
      } satisfies MonthlyExpenseProfile;
    })
    .filter((profile): profile is MonthlyExpenseProfile => Boolean(profile))
    .sort((left, right) => {
      if (left.selectedMonth.status !== right.selectedMonth.status) {
        return left.selectedMonth.status === "PENDENTE" ? -1 : 1;
      }
      return `${left.branchCode}:${left.supplierName}`.localeCompare(`${right.branchCode}:${right.supplierName}`, "pt-BR");
    });

  const branchGroups = new Map<string, MonthlyExpenseProfile[]>();
  for (const profile of profiles) {
    branchGroups.set(profile.branchCode, [...(branchGroups.get(profile.branchCode) || []), profile]);
  }
  const branches = Array.from(branchGroups.entries())
    .map(([branchCode, branchProfiles]) => {
      const launched = branchProfiles.filter((profile) => profile.selectedMonth.status === "LANCADA").length;
      const pending = branchProfiles.filter((profile) => profile.selectedMonth.status === "PENDENTE").length;
      const expected = launched + pending;
      return {
        branchCode,
        branchLabel: branchProfiles[0].branchLabel,
        expected,
        launched,
        pending,
        compliancePercent: expected ? Math.round((launched / expected) * 100) : 100,
      };
    })
    .sort((left, right) => right.pending - left.pending || left.branchCode.localeCompare(right.branchCode));

  const launched = profiles.filter((profile) => profile.selectedMonth.status === "LANCADA").length;
  const pending = profiles.filter((profile) => profile.selectedMonth.status === "PENDENTE").length;
  const expected = launched + pending;
  return {
    selectedMonth: input.selectedMonth,
    availableMonths: monthRange(input.currentMonth, 12).reverse(),
    profiles,
    branches,
    metrics: {
      expected,
      launched,
      pending,
      branchesWithPending: branches.filter((branch) => branch.pending > 0).length,
      compliancePercent: expected ? Math.round((launched / expected) * 100) : 100,
    },
  };
}
