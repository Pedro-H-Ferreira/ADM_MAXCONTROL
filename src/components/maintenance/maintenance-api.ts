export async function maintenanceRequest<T>(input: RequestInfo | URL, init?: RequestInit, fallback = "Falha na operacao.") {
  const response = await fetch(input, init);
  const payload = await response.json().catch(() => ({})) as { success?: boolean; error?: string };
  if (!response.ok || payload.success === false) {
    throw new Error(payload.error || fallback);
  }
  return payload as T;
}

export function maintenanceMoney(cents: number | null | undefined) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(cents || 0) / 100);
}

export function maintenanceDate(value: string | null | undefined, withTime = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return withTime
    ? date.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })
    : date.toLocaleDateString("pt-BR");
}

export function maintenanceLabel(value: string | null | undefined) {
  return String(value || "-").replaceAll("_", " ").toLocaleLowerCase("pt-BR").replace(/(^|\s)\S/g, (letter) => letter.toLocaleUpperCase("pt-BR"));
}
